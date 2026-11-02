export class ExecutorError extends Error {
  constructor(code, message = code) { super(message); this.name = 'ExecutorError'; this.code = code; }
}
export function requireThat(condition, code, message) {
  if (!condition) throw new ExecutorError(code, message);
}
