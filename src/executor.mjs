import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { ExecutorError, requireThat } from './errors.mjs';
import { select, identity, evaluate, validateSelector, validateCondition } from './selectors.mjs';

const actions = new Set(['invoke', 'set_value', 'select', 'toggle', 'expand', 'collapse']);
const stepKeys = new Set(['id', 'op', 'selector', 'value', 'expect', 'before', 'skipIf', 'timeoutMs']);
const snapshotKeys = new Set(['maxElements', 'maxDepth', 'budgetMs', 'includeValues', 'scope', 'activeDocument']);
export function validatePlan(plan) {
  requireThat(plan && plan.version === 1 && typeof plan.goal === 'string' && plan.goal.length > 0 && plan.goal.length <= 4096, 'INVALID_PLAN');
  requireThat(Object.keys(plan).every(k => ['version', 'goal', 'steps', 'observe'].includes(k)), 'INVALID_PLAN');
  requireThat(Array.isArray(plan.steps) && plan.steps.length > 0 && plan.steps.length <= 64, 'INVALID_PLAN');
  if (plan.observe) {
    requireThat(typeof plan.observe === 'object' && Object.keys(plan.observe).every(k => snapshotKeys.has(k)), 'INVALID_OBSERVATION');
    if (plan.observe.scope) {
      requireThat(Object.keys(plan.observe.scope).every(k => ['name', 'automationId'].includes(k)), 'INVALID_SCOPE');
      validateSelector(plan.observe.scope);
    }
    for (const [key, min, max] of [['maxElements', 1, 1000], ['maxDepth', 0, 30], ['budgetMs', 50, 10000]]) {
      if (key in plan.observe) requireThat(Number.isInteger(plan.observe[key]) && plan.observe[key] >= min && plan.observe[key] <= max, 'INVALID_OBSERVATION');
    }
    if ('includeValues' in plan.observe) requireThat(typeof plan.observe.includeValues === 'boolean', 'INVALID_OBSERVATION');
    if ('activeDocument' in plan.observe) requireThat(typeof plan.observe.activeDocument === 'boolean', 'INVALID_OBSERVATION');
  }
  const ids = new Set();
  for (const step of plan.steps) {
    requireThat(step && typeof step.id === 'string' && step.id.length > 0 && step.id.length <= 100 && !ids.has(step.id), 'INVALID_STEP_ID');
    ids.add(step.id);
    requireThat(Object.keys(step).every(k => stepKeys.has(k)), 'INVALID_STEP');
    requireThat(actions.has(step.op) || ['assert', 'wait'].includes(step.op), 'INVALID_OPERATION');
    if (actions.has(step.op)) validateSelector(step.selector);
    // Every mutation needs observable postconditions; DONE alone is not evidence.
    validateCondition(step.expect);
    if (step.before) validateCondition(step.before);
    if (step.skipIf) validateCondition(step.skipIf);
    if (step.op === 'set_value') requireThat(typeof step.value === 'string' && step.value.length <= 100000, 'INVALID_VALUE');
    else requireThat(!('value' in step), 'INVALID_VALUE');
    if ('timeoutMs' in step) requireThat(Number.isInteger(step.timeoutMs) && step.timeoutMs >= 0 && step.timeoutMs <= 30000, 'INVALID_TIMEOUT');
  }
  return plan;
}
const hash = plan => createHash('sha256').update(JSON.stringify(plan)).digest('hex');

export class WindowsExecutor {
  #backend; #window; #busy = false; #cancelled = false; #events = []; #guardInput = false; #inputTick; #observedAt = new WeakMap();
  constructor({ backend, mode = 'read-only', allowedProcesses = [], decision, minimumConfidence = 0.9, stopFile } = {}) {
    requireThat(backend && ['read-only', 'execute'].includes(mode), 'INVALID_CONFIGURATION');
    requireThat(mode !== 'execute' || (backend.mode === 'execute' && allowedProcesses.length > 0), 'EXECUTION_NOT_ENABLED');
    requireThat(Array.isArray(allowedProcesses) && allowedProcesses.every(x => typeof x === 'string' && x.length > 0), 'INVALID_CONFIGURATION');
    requireThat(Number.isFinite(minimumConfidence) && minimumConfidence >= 0 && minimumConfidence <= 1, 'INVALID_CONFIGURATION');
    this.#backend = backend;
    Object.defineProperty(this, 'mode', { value: mode, enumerable: true });
    Object.defineProperty(this, 'allowedProcesses', { value: Object.freeze(allowedProcesses.map(n => n.toLowerCase())), enumerable: true });
    this.decision = decision; this.minimumConfidence = minimumConfidence; this.stopFile = stopFile;
  }
  async #exclusive(operation) {
    requireThat(!this.#busy, 'EXECUTOR_BUSY'); this.#busy = true;
    try { return await operation(); } finally { this.#busy = false; }
  }
  #check(signal) {
    requireThat(!this.#cancelled && !signal?.aborted, 'CANCELLED');
    requireThat(!this.stopFile || !existsSync(this.stopFile), 'STOP_REQUESTED');
  }
  #record(kind, started, detail = {}) {
    this.#events.push({ kind, ms: Math.round((performance.now() - started) * 100) / 100, ...detail });
    if (this.#events.length > 1000) this.#events.shift();
  }
  stats() {
    const events = structuredClone(this.#events);
    return { events, counts: Object.fromEntries(['windows', 'observe', 'decision', 'act', 'wait'].map(k => [k, events.filter(e => e.kind === k).length])) };
  }
  cancel() { this.#cancelled = true; }
  async windows() {
    return this.#exclusive(async () => {
      const t = performance.now(); const result = await this.#backend.windows(); this.#record('windows', t); return result;
    });
  }
  async bind(selector) {
    return this.#exclusive(async () => {
      requireThat(selector && Object.keys(selector).length && Object.keys(selector).every(k => ['id', 'processId', 'processName', 'title'].includes(k)), 'INVALID_WINDOW_SELECTOR');
      const started = performance.now();
      // Query a known HWND/PID directly; keep fresh title and identity without
      // enumerating every unrelated application's windows.
      const windows = 'id' in selector && 'processId' in selector
        ? [await this.#backend.window(selector)] : await this.#backend.windows();
      this.#record('windows', started);
      const matches = windows.filter(w => Object.entries(selector).every(([k, v]) => w[k] === v));
      requireThat(matches.length === 1, 'WINDOW_NOT_UNIQUE', `Matching windows: ${matches.length}`);
      requireThat(!matches[0].restricted, 'RESTRICTED_APP');
      if (this.mode === 'execute') requireThat(this.allowedProcesses.includes('*') || this.allowedProcesses.includes(matches[0].processName.toLowerCase()), 'PROCESS_NOT_ALLOWED');
      this.#window = Object.freeze({ ...matches[0] }); return { ...this.#window };
    });
  }
  async #capture(options = {}, signal) {
    this.#check(signal); requireThat(this.#window, 'NO_WINDOW');
    const t = performance.now();
    const snapshot = await this.#backend.snapshot(this.#window, options);
    requireThat(snapshot.window.id === this.#window.id && snapshot.window.processId === this.#window.processId, 'WINDOW_CHANGED');
    this.#record('observe', t, { elements: snapshot.elements.length, truncated: snapshot.truncated, backendMs: snapshot.elapsedMs });
    if (this.#guardInput) {
      requireThat(Number.isInteger(snapshot.lastInputTick), 'INPUT_STATE_UNAVAILABLE');
      if (this.#inputTick === undefined) this.#inputTick = snapshot.lastInputTick;
      requireThat(snapshot.lastInputTick === this.#inputTick && !snapshot.inputChangedDuringRead, 'USER_INTERFERENCE',
        snapshot.inputChangedDuringRead ? 'Input changed during UIA observation' : 'Input changed between plan steps');
    }
    this.#observedAt.set(snapshot, performance.now());
    this.#check(signal); return snapshot;
  }
  async observe(options = {}) { return this.#exclusive(() => this.#capture(options)); }
  async preview(plan) {
    validatePlan(plan);
    return this.#exclusive(async () => {
      const snapshot = await this.#capture({ ...plan.observe, includeValues: true });
      return {
        status: 'preview', executed: false, mode: this.mode, snapshotId: snapshot.id, truncated: snapshot.truncated,
        note: 'All steps are matched against the current state; future states are not simulated.',
        steps: plan.steps.map(step => ({ id: step.id, op: step.op,
          matchesNow: step.selector ? select(snapshot, step.selector).length : undefined,
          postconditionNow: evaluate(snapshot, step.expect) })),
      };
    });
  }
  async #waitFor(condition, snapshot, options, timeoutMs, signal, deadline) {
    const started = performance.now();
    const until = Math.min(started + timeoutMs, deadline);
    let interval = 150;
    while (evaluate(snapshot, condition) !== true) {
      this.#check(signal);
      const left = until - performance.now();
      if (left <= 0) throw new ExecutorError('CONDITION_TIMEOUT');
      await delay(Math.min(interval, left), undefined, { signal });
      this.#check(signal);
      snapshot = await this.#capture(options, signal);
      interval = Math.min(750, interval * 1.6);
    }
    this.#record('wait', started); return snapshot;
  }
  async #resolve(step, snapshot, options, goal, signal, deadline) {
    requireThat(!snapshot.truncated, 'INCOMPLETE_OBSERVATION', 'Narrow the scope or increase the observation budget.');
    let matches = select(snapshot, step.selector).filter(e => e.enabled && !e.offscreen && !e.password && e.actions.includes(step.op));
    if (matches.length === 1) return { element: matches[0], snapshot };
    if (matches.length === 0) throw new ExecutorError(snapshot.truncated ? 'INCOMPLETE_OBSERVATION' : 'ELEMENT_NOT_FOUND');
    if (!this.decision) throw new ExecutorError('NEEDS_DECISION');
    const t = performance.now();
    let timer;
    const answer = await Promise.race([
      Promise.resolve().then(() => this.decision({ goal, operation: step.op,
        candidates: matches.map(e => ({ ref: e.ref, name: e.name, role: e.role, automationId: e.automationId })), signal })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new ExecutorError('DECISION_TIMEOUT')), Math.max(0, Math.min(10000, deadline - performance.now()))); }),
    ]).finally(() => clearTimeout(timer));
    this.#record('decision', t);
    this.#check(signal);
    requireThat(answer && Number.isFinite(answer.confidence) && answer.confidence >= this.minimumConfidence && answer.confidence <= 1, 'NEEDS_DECISION');
    const chosen = matches.find(e => e.ref === answer.ref);
    requireThat(chosen, 'INVALID_DECISION');
    const expectedIdentity = identity(snapshot, chosen);
    // Never execute a reference that crossed a model/network wait.
    snapshot = await this.#capture(options, signal);
    requireThat(!snapshot.truncated, 'INCOMPLETE_OBSERVATION');
    matches = select(snapshot, step.selector).filter(e => identity(snapshot, e) === expectedIdentity && e.enabled && !e.offscreen && !e.password && e.actions.includes(step.op));
    requireThat(matches.length === 1, 'STALE_DECISION');
    return { element: matches[0], snapshot };
  }
  async run(plan, { signal, checkpoint, maxDurationMs = 60000, reuseVerifiedObservation = true } = {}) {
    // Validate the entire plan before touching UI; an invalid later step must not follow a valid mutation.
    validatePlan(plan);
    requireThat(Number.isInteger(maxDurationMs) && maxDurationMs > 0 && maxDurationMs <= 300000, 'INVALID_TIMEOUT');
    requireThat(typeof reuseVerifiedObservation === 'boolean', 'INVALID_CONFIGURATION');
    const mutating = plan.steps.some(s => actions.has(s.op));
    requireThat(!mutating || this.mode === 'execute', 'READ_ONLY');
    const planHash = hash(plan);
    const startIndex = checkpoint?.nextStep ?? 0;
    if (checkpoint) {
      requireThat(checkpoint.status === 'verified' && checkpoint.planHash === planHash &&
        Number.isInteger(startIndex) && startIndex > 0 && startIndex <= plan.steps.length, 'INVALID_CHECKPOINT');
    }
    return this.#exclusive(async () => {
      this.#guardInput = mutating; this.#inputTick = undefined;
      const started = performance.now(); const deadline = started + maxDurationMs;
      const completed = []; let index = startIndex; let performed = false; let nextSnapshot = null;
      const options = { ...plan.observe, includeValues: true };
      try {
        if (checkpoint) {
          const current = await this.#capture(options, signal);
          requireThat(evaluate(current, plan.steps[startIndex - 1].expect) === true, 'CHECKPOINT_DIVERGED');
        }
        for (; index < plan.steps.length; index++) {
          performed = false; this.#check(signal);
          requireThat(performance.now() < deadline, 'RUN_TIMEOUT');
          const step = plan.steps[index];
          let snapshot = reuseVerifiedObservation && nextSnapshot &&
            performance.now() - this.#observedAt.get(nextSnapshot) < 1000 ? nextSnapshot : await this.#capture(options, signal);
          nextSnapshot = null;
          if (step.skipIf && evaluate(snapshot, step.skipIf) === true) {
            requireThat(evaluate(snapshot, step.expect) === true, 'SKIP_NOT_VERIFIED');
            nextSnapshot = snapshot;
            completed.push({ id: step.id, status: 'already_satisfied' }); continue;
          }
          if (step.before) requireThat(evaluate(snapshot, step.before) === true, 'PRECONDITION_FAILED');
          if (step.op === 'assert') requireThat(evaluate(snapshot, step.expect) === true, 'ASSERTION_FAILED');
          else if (step.op === 'wait') snapshot = await this.#waitFor(step.expect, snapshot, options, step.timeoutMs ?? 5000, signal, deadline);
          else {
            const resolved = await this.#resolve(step, snapshot, options, plan.goal, signal, deadline);
            snapshot = resolved.snapshot;
            if (step.before) requireThat(evaluate(snapshot, step.before) === true, 'PRECONDITION_FAILED');
            requireThat(performance.now() < deadline, 'RUN_TIMEOUT');
            this.#check(signal);
            requireThat(!snapshot.inputChangedDuringRead, 'USER_INTERFERENCE');
            const t = performance.now(); performed = true;
            try {
              const receipt = await this.#backend.act(this.#window, resolved.element, step.op, step.value);
              // UIA providers may themselves inject input. The next observation
              // starts at the acknowledged input tick, not the previous action.
              if (Number.isInteger(receipt?.lastInputTick)) this.#inputTick = receipt.lastInputTick;
            }
            catch (error) {
              if (['READ_ONLY', 'STOP_REQUESTED', 'USER_INTERFERENCE', 'STALE_SNAPSHOT', 'NOT_ACTIONABLE', 'PASSWORD_FIELD', 'RESTRICTED_APP', 'WINDOW_GONE', 'INVALID_ACTION'].includes(error.code)) performed = false;
              throw error;
            }
            this.#record('act', t, { operation: step.op });
            // First operation after an action is always a new observation.
            snapshot = await this.#capture(options, signal);
            snapshot = await this.#waitFor(step.expect, snapshot, options, step.timeoutMs ?? 5000, signal, deadline);
          }
          // Reuse only the fresh, verified post-action observation, never a
          // pre-action reference. Native identity/input/age guards still run.
          nextSnapshot = snapshot;
          completed.push({ id: step.id, status: 'verified' });
        }
        return { status: 'completed', completed, elapsedMs: Math.round(performance.now() - started),
          checkpoint: { status: 'verified', planHash, nextStep: index } };
      } catch (error) {
        const uncertain = performed;
        return { status: uncertain ? 'uncertain' : error.code === 'NEEDS_DECISION' ? 'needs_decision' : 'stopped',
          reason: error.code || (error.name === 'AbortError' ? 'CANCELLED' : 'EXECUTOR_ERROR'), step: plan.steps[index]?.id,
          ...(error.code === 'USER_INTERFERENCE' ? { detail: error.message } : {}),
          completed, elapsedMs: Math.round(performance.now() - started),
          checkpoint: { status: uncertain ? 'uncertain' : 'verified', planHash, nextStep: index },
          retryAllowed: false };
      } finally { this.#guardInput = false; this.#inputTick = undefined; }
    });
  }
}
