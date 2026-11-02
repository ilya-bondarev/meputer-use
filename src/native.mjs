import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExecutorError, requireThat } from './errors.mjs';

export class NativeBackend {
  #child; #pending; #sequence = 0; #closed = false; #lines;
  constructor({ mode = 'read-only', executable, timeoutMs = 6000, stopFile } = {}) {
    requireThat(['read-only', 'execute'].includes(mode), 'INVALID_MODE');
    requireThat(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 30000, 'INVALID_TIMEOUT');
    Object.defineProperty(this, 'mode', { value: mode, enumerable: true });
    this.timeoutMs = timeoutMs;
    const bin = resolve(dirname(fileURLToPath(import.meta.url)), '../bin');
    const binary = executable || resolve(bin, existsSync(resolve(bin,'host.json')) ? JSON.parse(readFileSync(resolve(bin,'host.json'),'utf8')).executable : 'WindowsUiaHost.exe');
    requireThat(existsSync(binary), 'NOT_BUILT', 'Run node scripts/build.mjs first.');
    const args = mode === 'execute' ? ['--allow-input'] : [];
    if (stopFile) args.push('--stop-file', resolve(stopFile));
    this.#child = spawn(binary, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
    this.#lines = createInterface({ input: this.#child.stdout });
    this.#lines.on('line', line => {
      if (line.length > 24 * 1024 * 1024) return this.#fail('PROTOCOL_ERROR');
      let message;
      try { message = JSON.parse(line); } catch { return this.#fail('PROTOCOL_ERROR'); }
      const pending = this.#pending;
      if (!pending || message.id !== pending.id) return this.#fail('PROTOCOL_ERROR');
      this.#pending = null;
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new ExecutorError(message.error.code, message.error.message));
      else pending.resolve(message.result);
    });
    this.#child.on('error', () => this.#fail('BACKEND_START_FAILED'));
    this.#child.stdin.on('error', () => this.#fail('BACKEND_CLOSED'));
    this.#child.on('exit', () => this.#fail('BACKEND_CLOSED'));
  }
  #fail(code) {
    this.#closed = true;
    if (this.#pending) {
      clearTimeout(this.#pending.timer);
      this.#pending.reject(new ExecutorError(code));
      this.#pending = null;
    }
    this.#child.kill();
  }
  request(method, parameters = {}) {
    requireThat(!this.#closed, 'BACKEND_CLOSED', 'Create a new instance; actions are not automatically replayed.');
    requireThat(!this.#pending, 'BACKEND_BUSY', 'One bridge instance handles one request at a time.');
    requireThat(['hello', 'windows', 'window', 'snapshot', 'document', 'frame', 'sequence', 'act', 'capture', 'desktop', 'classify', 'secret', 'admin_launch', 'admin_status', 'lease_acquire', 'lease_release', 'geometry', 'layout', 'capture_visible'].includes(method), 'INVALID_METHOD');
    if (['act', 'desktop', 'sequence', 'secret', 'admin_launch', 'lease_acquire', 'layout'].includes(method)) requireThat(this.mode === 'execute', 'READ_ONLY');
    return new Promise((resolveRequest, reject) => {
      const id = ++this.#sequence;
      const timer = setTimeout(() => this.#fail('BACKEND_TIMEOUT'), this.timeoutMs);
      this.#pending = { id, timer, resolve: resolveRequest, reject };
      // id/method cannot be overwritten by callers.
      this.#child.stdin.write(JSON.stringify({ ...parameters, id, method }) + '\n');
    });
  }
  async hello() { return this.request('hello'); }
  async windows() { return this.request('windows'); }
  async window(window) { return this.request('window',{windowId:window.id,processId:window.processId}); }
  async snapshot(window, options = {}) {
    return this.request('snapshot', { ...options, windowId: window.id, processId: window.processId });
  }
  async act(window, element, action, value) {
    return this.request('act', { windowId: window.id, processId: window.processId, ref: element.ref, action, ...(value === undefined ? {} : { value }) });
  }
  async capture(window) { return this.request('capture', { windowId: window.id, processId: window.processId }); }
  async geometry(window) { return this.request('geometry', { windowId: window.id, processId: window.processId }); }
  async captureVisible(window) { return this.request('capture_visible', { windowId:window.id, processId:window.processId }); }
  async layout(window, rect) {
    requireThat(rect && ['x','y','width','height'].every(key=>Number.isInteger(rect[key])), 'INVALID_BOUNDS');
    return this.request('layout', { x:rect.x, y:rect.y, width:rect.width, height:rect.height, windowId:window.id, processId:window.processId });
  }
  async desktop(window, operation, parameters = {}) {
    return this.request('desktop', { ...parameters, windowId: window.id, processId: window.processId, operation });
  }
  async close() {
    if (this.#closed) return;
    if (this.#pending) { this.#fail('CANCELLED'); return; }
    this.#closed = true;
    this.#lines.close();
    this.#child.stdin.end();
    await new Promise(resolveClose => {
      if (this.#child.exitCode !== null) return resolveClose();
      const timer = setTimeout(() => { this.#child.kill(); resolveClose(); }, 500);
      this.#child.once('exit', () => { clearTimeout(timer); resolveClose(); });
    });
  }
}
