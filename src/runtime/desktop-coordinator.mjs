import { requireThat } from '../errors.mjs';

// Each bridge has one outstanding native request. Keep a bridge bound to one
// window and serialize its operations, while allowing other windows to read.
export class DesktopCoordinator {
  constructor(createSession, { maxSessions = 8 } = {}) {
    this.createSession = createSession;
    this.maxSessions = maxSessions;
    this.control = createSession();
    this.controlTail = Promise.resolve();
    this.focusTail = Promise.resolve();
    this.entries = new Map();
    this.retired = new Set();
  }
  retire(session) {
    const closing = session.close();
    this.retired.add(closing);
    closing.then(() => this.retired.delete(closing), () => {});
  }
  queue(tail, operation) {
    const result = tail.then(operation);
    return [result, result.catch(() => {})];
  }
  controlRun(operation) {
    const [result, tail] = this.queue(this.controlTail, async () => {
      try { return await operation(this.control); }
      catch (error) {
        if (['BACKEND_TIMEOUT', 'BACKEND_CLOSED'].includes(error.code)) {
          this.retire(this.control);
          this.control = this.createSession();
        }
        throw error;
      }
    });
    this.controlTail = tail;
    return result;
  }
  focusRun(operation) {
    const [result, tail] = this.queue(this.focusTail, operation);
    this.focusTail = tail;
    return result;
  }
  async resolve(selector) {
    requireThat(selector && Object.keys(selector).length, 'INVALID_WINDOW_SELECTOR');
    // The session's bind checks this identity and every extra selector field.
    if (Number.isInteger(selector.id) && Number.isInteger(selector.processId)) return selector;
    const windows = await this.controlRun(session => session.windows());
    const matches = windows.filter(w => Object.entries(selector).every(([key, value]) => w[key] === value));
    requireThat(matches.length === 1, 'WINDOW_NOT_UNIQUE', `Matching windows: ${matches.length}`);
    return matches[0];
  }
  async run(selector, { focus = false, signal } = {}, operation) {
    const window = await this.resolve(selector);
    signal?.throwIfAborted();
    const key = `${window.id}:${window.processId}`;
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxSessions) {
        const idle = [...this.entries].find(([, candidate]) => candidate.users === 0);
        requireThat(idle, 'SESSION_LIMIT', 'All desktop sessions are busy.');
        this.entries.delete(idle[0]);
        this.retire(idle[1].session);
      }
      // Reserve synchronously: concurrent resolves must share one window queue.
      entry = { session: this.createSession(), tail: Promise.resolve(), users: 0 };
      this.entries.set(key, entry);
    }
    entry.users++;
    const invoke = async () => {
      signal?.throwIfAborted();
      requireThat(!entry.broken, 'BACKEND_CLOSED', 'Bridge failed; queued operation was not executed.');
      try {
        await entry.session.bind({ ...selector, id: window.id, processId: window.processId });
        signal?.throwIfAborted();
        return await operation(entry.session, window);
      } catch (error) {
        if (['BACKEND_TIMEOUT', 'BACKEND_CLOSED'].includes(error.code)) entry.broken = true;
        throw error;
      }
    };
    const [result, tail] = this.queue(entry.tail, () => focus ? this.focusRun(invoke) : invoke());
    entry.tail = tail;
    try { return await result; }
    finally {
      entry.users--;
      if (entry.broken && entry.users === 0 && this.entries.get(key) === entry) {
        this.entries.delete(key);
        this.retire(entry.session);
      }
    }
  }
  async close() {
    await Promise.all([this.controlTail, this.focusTail, ...[...this.entries.values()].map(entry => entry.tail)]);
    await Promise.all([this.control.close(), ...this.retired, ...[...this.entries.values()].map(entry => entry.session.close())]);
    this.entries.clear();
  }
}
