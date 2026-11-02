import { requireThat } from '../../errors.mjs';
import { isJobStatus } from './lifecycle.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);

// Validate at the storage boundary before a corrupt checkpoint can reach input.
// Optional fields remain optional so existing v1 checkpoints need no migration.
export function validateCheckpoint(state, id) {
  requireThat(object(state) && state.id === id && isJobStatus(state.status), 'INVALID_CHECKPOINT');
  requireThat(typeof state.planHash === 'string' && /^[a-f0-9]{64}$/.test(state.planHash), 'INVALID_CHECKPOINT');
  requireThat(Number.isSafeInteger(state.transitions) && state.transitions >= 0, 'INVALID_CHECKPOINT');
  requireThat(object(state.outputs) && Array.isArray(state.history), 'INVALID_CHECKPOINT');
  for (const key of ['createdAt', 'updatedAt']) {
    if (state[key] !== undefined) requireThat(typeof state[key] === 'string', 'INVALID_CHECKPOINT');
  }
  if (state.workerPid !== undefined) requireThat(Number.isSafeInteger(state.workerPid) && state.workerPid > 0, 'INVALID_CHECKPOINT');
  if (state.waitStartedAt !== undefined) requireThat(Number.isSafeInteger(state.waitStartedAt) && state.waitStartedAt >= 0, 'INVALID_CHECKPOINT');
  if (state.wakeAt !== undefined) requireThat(Number.isSafeInteger(state.wakeAt) && state.wakeAt >= 0, 'INVALID_CHECKPOINT');
  if (state.inFlight !== undefined) requireThat(object(state.inFlight) && state.inFlight.node === state.node, 'INVALID_CHECKPOINT');
  return state;
}
