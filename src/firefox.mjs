import { connect } from 'node:net';
import { ExecutorError, requireThat } from './errors.mjs';

// Mozilla's public Marionette protocol. Existing profile/session; requires
// Firefox to have been started with --marionette. Loopback only, no credentials.
export class FirefoxClient {
  #socket; #buffer = Buffer.alloc(0); #next = 0; #pending = new Map(); #hello; #closed = false;
  constructor({ port = 2828, timeoutMs = 15000 } = {}) {
    requireThat(Number.isInteger(port) && port > 0 && port <= 65535, 'INVALID_PORT');
    this.timeoutMs = timeoutMs;
    this.#hello = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new ExecutorError('FIREFOX_TIMEOUT')); this.close(); }, timeoutMs);
      this.#socket = connect({ host: '127.0.0.1', port });
      this.#socket.on('error', error => { clearTimeout(timer); reject(error); this.#fail(); });
      this.#socket.on('close', () => { this.#closed=true; clearTimeout(timer); reject(new ExecutorError('FIREFOX_DISCONNECTED')); this.#fail(); });
      this.#socket.on('data', chunk => {
        this.#buffer = Buffer.concat([this.#buffer, chunk]);
        try {
          while (true) {
            const colon = this.#buffer.indexOf(58);
            if (colon < 0) { requireThat(this.#buffer.length < 12, 'PROTOCOL_ERROR'); break; }
            const length = Number(this.#buffer.subarray(0, colon).toString());
            requireThat(Number.isInteger(length) && length > 0 && length <= 16 * 1024 * 1024, 'PROTOCOL_ERROR');
            if (this.#buffer.length < colon + 1 + length) break;
            const message = JSON.parse(this.#buffer.subarray(colon + 1, colon + 1 + length));
            this.#buffer = this.#buffer.subarray(colon + 1 + length);
            if (!Array.isArray(message)) { clearTimeout(timer); resolve(message); continue; }
            const pending = this.#pending.get(message[1]);
            if (!pending) continue;
            this.#pending.delete(message[1]); clearTimeout(pending.timer);
            if (message[2]) pending.reject(new ExecutorError('FIREFOX_COMMAND_FAILED', message[2].error));
            else pending.resolve(message[3]);
          }
        } catch { this.close(); }
      });
    });
  }
  #fail() { for (const p of this.#pending.values()) { clearTimeout(p.timer); p.reject(new ExecutorError('FIREFOX_DISCONNECTED')); } this.#pending.clear(); }
  async command(name, parameters = {}) {
    requireThat(!this.#closed, 'FIREFOX_DISCONNECTED');
    await this.#hello;
    requireThat(!this.#closed, 'FIREFOX_DISCONNECTED');
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new ExecutorError('FIREFOX_TIMEOUT')); this.close(); }, this.timeoutMs);
      this.#pending.set(id, { timer, resolve, reject });
      const body = Buffer.from(JSON.stringify([0, id, name, parameters]));
      this.#socket.write(Buffer.concat([Buffer.from(`${body.length}:`), body]));
    });
  }
  async start() { return this.command('WebDriver:NewSession', { acceptInsecureCerts: false, pageLoadStrategy: 'none' }); }
  async tabs() { const result = await this.command('WebDriver:GetWindowHandles'); return result.value ?? result; }
  switchTo(handle) { return this.command('WebDriver:SwitchToWindow', { handle, focus: true }); }
  async url() { return (await this.command('WebDriver:GetCurrentURL')).value; }
  navigate(url) { requireThat(/^https?:\/\//.test(url), 'INVALID_URL'); return this.command('WebDriver:Navigate', { url }); }
  async evaluate(script, args = []) { return (await this.command('WebDriver:ExecuteScript', { script, args, newSandbox: true, sandbox: 'default', line: 1, filename: 'windows-executor', scriptTimeout: this.timeoutMs })).value; }
  // DeleteSession disconnects the protocol session; it does not issue Quit.
  async end() { try { await this.command('WebDriver:DeleteSession'); } finally { this.close(); } }
  close() { this.#closed=true; this.#socket?.destroy(); this.#fail(); }
}
