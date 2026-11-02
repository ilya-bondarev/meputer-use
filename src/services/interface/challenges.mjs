import { validateValue } from '../../contracts.mjs';
import { validateCondition } from './selectors.mjs';
import { validatePlan } from './plans.mjs';
import { requireThat } from '../../errors.mjs';

// The agent supplies observed selectors and a transcribed answer. This contract
// does not guess answers, identify providers, or infer success from input delivery.
export const simpleChallengeSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { enum: ['checkbox', 'text', 'image'] },
    target: { type: 'object' },
    checkboxOperation: { enum: ['invoke', 'toggle', 'select'] },
    answer: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[^\\r\\n\\u0000]+$' },
    submit: { type: 'object' },
    present: { type: 'object' },
    passed: { type: 'object' },
    observe: { type: 'object' },
    timeoutMs: { type: 'integer' },
    selections: { type: 'array', minItems: 1, maxItems: 16, items: {
      type: 'object', additionalProperties: false,
      properties: { target: { type: 'object' }, operation: { enum: ['invoke', 'toggle', 'select'] }, expect: { type: 'object' } },
      required: ['target', 'operation', 'expect'],
    } },
    reload: { type: 'object', additionalProperties: false,
      properties: { target: { type: 'object' }, rejected: { type: 'object' }, refreshed: { type: 'object' } },
      required: ['target', 'rejected', 'refreshed'],
    },
    retryToken: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
  },
  required: ['kind', 'present', 'passed'],
  not: { required: ['reload', 'retryToken'] },
  oneOf: [
    { properties: { kind: { const: 'checkbox' } }, required: ['target', 'checkboxOperation'],
      not: { anyOf: [{ required: ['answer'] }, { required: ['submit'] }, { required: ['selections'] }] } },
    { properties: { kind: { enum: ['text', 'image'] } }, required: ['target', 'answer', 'submit'],
      not: { anyOf: [{ required: ['checkboxOperation'] }, { required: ['selections'] }] } },
    { properties: { kind: { const: 'image' } }, required: ['selections', 'submit'],
      not: { anyOf: [{ required: ['checkboxOperation'] }, { required: ['target'] }, { required: ['answer'] }] } },
  ],
};

export function challengeConditions(request) {
  return { completed: { all: [{ not: request.present }, request.passed] },
    ...(request.reload ? { refreshed: { all: [request.present, request.reload.refreshed, { not: request.reload.rejected }] } } : {}) };
}
const plan = (request, steps) => validatePlan({ version: 1,
  goal: 'Complete the observed challenge for the delegated user task', steps,
  ...(request.observe ? { observe: request.observe } : {}) });

export function buildSimpleChallengePlan(request, refreshed) {
  validateValue(simpleChallengeSchema, request);
  validateCondition(request.present);
  validateCondition(request.passed);
  // The unresolved challenge must clear AND the intended next UI must appear.
  const { completed } = challengeConditions(request);
  const timeoutMs = request.timeoutMs ?? 10000;
  let steps;
  if (request.kind === 'checkbox') {
    steps = [{ id: 'challenge_checkbox', op: request.checkboxOperation,
      selector: request.target, before: request.present, skipIf: completed,
      expect: completed, timeoutMs }];
  } else if (request.selections) {
    steps = request.selections.map((selection, index) => {
      const selectedOrCompleted = { any: [completed, selection.expect] };
      return { id: 'challenge_selection_' + index, op: selection.operation,
        selector: selection.target, before: request.present, skipIf: selectedOrCompleted,
        expect: selectedOrCompleted, timeoutMs };
    });
    steps.push({ id: 'challenge_submit', op: 'invoke', selector: request.submit,
      before: { all: [request.present, ...request.selections.map(selection => selection.expect)] },
      skipIf: completed, expect: completed, timeoutMs });
  } else {
    const filled = { selector: request.target, value: request.answer };
    const enteredOrCompleted = { any: [completed, filled] };
    steps = [
      { id: 'challenge_answer', op: 'set_value', selector: request.target,
        value: request.answer, before: request.present, skipIf: enteredOrCompleted,
        expect: enteredOrCompleted, timeoutMs },
      { id: 'challenge_submit', op: 'invoke', selector: request.submit,
        before: { all: [request.present, filled] }, skipIf: completed,
        expect: completed, timeoutMs },
    ];
  }
  // Some fields submit automatically. The final step skips only when completion
  // is actually observed, so it cannot submit an unrelated control on the next page.
  // Validate even the optional later mutation before delivering the first one.
  if (request.reload) buildChallengeReloadPlan(request);
  if (refreshed) steps.unshift({ id: 'challenge_retry_ready', op: 'assert', expect: { any: [completed, refreshed] } });
  return plan(request, steps);
}

export function buildChallengeReloadPlan(request) {
  const { completed, refreshed } = challengeConditions(request);
  return plan(request, [{ id: 'challenge_reload', op: 'invoke', selector: request.reload.target,
    before: { all: [request.present, request.reload.rejected, { not: request.reload.refreshed }] },
    skipIf: completed, expect: { any: [completed, refreshed] }, timeoutMs: request.timeoutMs ?? 10000 }]);
}

export function challengeMayReload(result) {
  return result.status === 'uncertain' && result.reason === 'CONDITION_TIMEOUT';
}

export function challengeOutcome(result, attempt) {
  const verified = result.status === 'completed';
  return { taskStatus: verified ? 'verified' : 'needs_decision',
    continueTask: verified, retryAllowed: false, attempt, result };
}

export function challengeRetryContext(window, passed) {
  requireThat(Number.isInteger(window?.id) && Number.isInteger(window?.processId), 'NO_WINDOW');
  return { window: { id: window.id, processId: window.processId, processName: window.processName ?? '', title: window.title ?? '' }, passed };
}

export function challengeRetryExpiry(now) { return now + 5 * 60 * 1000; }
