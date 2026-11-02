// Paused jobs may run only after an explicit resume; the runner historically
// accepts paused state, while autonomous dispatch and CLI waiting stop on it.
const stopped = new Set(['completed', 'cancelled', 'needs_decision', 'failed']);
const active = new Set(['queued', 'running', 'waiting', 'reconciling', 'paused']);
export const isJobStatus = status => stopped.has(status) || active.has(status);
export const runnerStopped = status => stopped.has(status);
export const requiresIntervention = status => runnerStopped(status) || status === 'paused';
export const canResume = status => !['completed', 'cancelled'].includes(status);

// A supervisor owns one cooperative slot. The slice is checked between nodes;
// it must never interrupt a mutation merely to enforce fairness.
export const supervisedSliceMs = 30000;
export const warmWaitMs = 30000;
export const supervisorPollMs = 1000;

export function readyToDispatch(state, now, cancelRequested = false) {
  if (requiresIntervention(state.status)) return false;
  if (cancelRequested || state.inFlight) return true;
  return state.status !== 'waiting' || !state.wakeAt || state.wakeAt <= now;
}

export function shouldYieldWait(state, now) {
  return state.status === 'waiting' && !state.inFlight && state.wakeAt - now >= warmWaitMs;
}

export function nextPollAt(node, waitStartedAt, now) {
  const next = now + (node.pollMs ?? 1000);
  return node.timeoutMs ? Math.min(next, waitStartedAt + node.timeoutMs) : next;
}

export function dispatchOrder(a, b) {
  const first = a.updatedAt || a.createdAt || '';
  const second = b.updatedAt || b.createdAt || '';
  return first.localeCompare(second) || a.id.localeCompare(b.id);
}
