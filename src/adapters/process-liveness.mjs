// Process existence is a hint, never an ownership token or proof of identity.
export function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // Permission failures must not authorize stealing a lock or dispatching input.
    return error.code !== 'ESRCH';
  }
}
