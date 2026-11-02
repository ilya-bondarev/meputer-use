import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { buildSimpleChallengePlan, buildChallengeReloadPlan, challengeMayReload,
  challengeOutcome, challengeRetryContext, challengeRetryExpiry, challengeConditions, evaluate } from '../services/interface/index.mjs';
import { createConnectorJournal } from '../persistence/connector-journal.mjs';
import { requireThat } from '../errors.mjs';

// The observer supplies a new answer after reload. Existing durable receipts
// bound that continuation to one delivery, including across CLI process restarts.
export async function runSimpleChallenge(session, request, { signal, journal, now = Date.now } = {}) {
  let plan = buildSimpleChallengePlan(request);
  requireThat(session.mode === 'execute', 'READ_ONLY');
  signal?.throwIfAborted();
  const receipts = journal ?? createConnectorJournal(resolve(import.meta.dirname, '../../local/challenge-requests'));
  try {
    const execute = attempt => session.withInputLease(async () => {
      signal?.throwIfAborted();
      const result = await session.runPlan(plan, { signal });
      const output = challengeOutcome(result, attempt);
      if (!request.reload || !challengeMayReload(result)) return output;
      const reloadResult = await session.runPlan(buildChallengeReloadPlan(request), { signal });
      if (reloadResult.status !== 'completed') return { ...output, reloadResult };
      const snapshot = await session.observe({ ...request.observe, includeValues: true });
      requireThat(!snapshot.truncated && !snapshot.inputChangedDuringRead, 'INCOMPLETE_OBSERVATION');
      signal?.throwIfAborted();
      const { completed, refreshed } = challengeConditions(request);
      if (evaluate(snapshot, completed) === true) {
        return { ...challengeOutcome(reloadResult, attempt), result, reloadResult };
      }
      if (evaluate(snapshot, refreshed) !== true) return { ...output, reloadResult };
      const retryToken = randomUUID();
      const context = challengeRetryContext(session.window, request.passed);
      const expiresAt = challengeRetryExpiry(now());
      await receipts.execute(retryToken + '-ready', { platform: 'interface', name: 'challenge.reload', args: context },
        async () => ({ context, expiresAt, refreshed }));
      return { ...output, reloadResult, taskStatus: 'needs_observation', retryAllowed: true,
        retryToken, expiresAt, next: 'Observe the refreshed challenge and supply a new answer with retryToken; omit reload.' };
    });
    if (!request.retryToken) return await execute(1);
    const ready = await receipts.inspect(request.retryToken + '-ready');
    const context = challengeRetryContext(session.window, request.passed);
    requireThat(ready.status === 'completed' && isDeepStrictEqual(ready.output.context, context), 'CHALLENGE_RETRY_CONTEXT_CHANGED');
    requireThat(Number.isFinite(ready.output.expiresAt) && now() < ready.output.expiresAt, 'CHALLENGE_RETRY_EXPIRED');
    plan = buildSimpleChallengePlan(request, ready.output.refreshed);
    const receipt = await receipts.execute(request.retryToken,
      { platform: 'interface', name: 'challenge.retry', args: context }, () => execute(2));
    if (receipt.replayed) return { taskStatus: 'needs_decision', continueTask: false,
      retryAllowed: false, attempt: 2, reason: 'CHALLENGE_RETRY_ALREADY_USED' };
    return receipt.output;
  } finally { if (!journal) receipts.close(); }
}
