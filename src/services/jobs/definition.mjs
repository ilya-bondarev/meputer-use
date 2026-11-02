import { isAbsolute } from 'node:path';
import { requireThat } from '../../errors.mjs';
import { validatePlan, validateCondition, validateSelector, validatePageRequest } from '../interface/index.mjs';
import { validateConnectorCall, validateConnectorCondition } from './bindings.mjs';

function condition(c, platformNames) {
  requireThat(c && typeof c === 'object', 'INVALID_JOB_CONDITION');
  if (c.file) { requireThat(isAbsolute(c.file) && (!('minBytes' in c) || Number.isSafeInteger(c.minBytes) && c.minBytes >= 0), 'INVALID_JOB_CONDITION'); return; }
  if (c.browser) { requireThat(typeof c.browser.script === 'string' && c.browser.script.length > 0 && c.browser.script.length <= 100000, 'INVALID_JOB_CONDITION'); return; }
  if (c.connector) {validateConnectorCondition(c.connector, platformNames);return;}
  requireThat(c.window && Object.keys(c.window).length && Object.keys(c.window).every(k => ['id', 'processId', 'processName', 'title'].includes(k)), 'INVALID_JOB_CONDITION');
  requireThat(typeof c.exists === 'boolean' || c.ui, 'INVALID_JOB_CONDITION');
  if (c.ui) validateCondition(c.ui);
}
export function validateJob(job, platformNames) {
  requireThat(job?.version === 1 && typeof job.goal === 'string' && job.goal.length > 0 && job.goal.length <= 4096, 'INVALID_JOB');
  requireThat(Array.isArray(job.allowedProcesses) && job.allowedProcesses.every(p => typeof p === 'string' && p.length), 'INVALID_JOB');
  requireThat(Array.isArray(job.nodes) && job.nodes.length > 0 && job.nodes.length <= 1000, 'INVALID_JOB');
  const ids = new Set();
  for (const n of job.nodes) {
    requireThat(typeof n.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(n.id) && !ids.has(n.id), 'INVALID_JOB_NODE'); ids.add(n.id);
    requireThat(['ui', 'desktop', 'page', 'browser', 'connector', 'wait', 'sleep', 'branch', 'collect', 'finish'].includes(n.type), 'INVALID_JOB_NODE');
    if(n.type==='page')validatePageRequest(n);
    if(n.type==='connector'||n.type==='page') {
      if(n.type==='connector')validateConnectorCall(n.call, platformNames);
      if(n.key)requireThat(/^[a-zA-Z0-9_-]{1,100}$/.test(n.key)&&!['__proto__','constructor','prototype'].includes(n.key),'INVALID_OUTPUT_KEY');
    }
    if (['ui', 'desktop', 'page', 'collect'].includes(n.type)) condition({ window: n.window, exists: true }, platformNames);
    if (n.type === 'ui') { validatePlan(n.plan); requireThat(n.plan.steps.length === 1, 'ONE_DURABLE_ACTION_PER_NODE'); }
    if (n.type === 'desktop') { requireThat(['click','key','type','move','drag','wheel','close_window','activate'].includes(n.operation), 'INVALID_OPERATION'); condition(n.expect, platformNames); }
    if (n.type === 'browser') {
      requireThat(['evaluate','navigate','switch'].includes(n.operation), 'INVALID_OPERATION'); condition(n.expect, platformNames);
      if(n.operation==='evaluate') requireThat(typeof n.script==='string'&&n.script.length>0&&n.script.length<=100000,'INVALID_SCRIPT');
      if(n.operation==='navigate') requireThat(typeof n.url==='string'&&/^https?:\/\//.test(n.url),'INVALID_URL');
      if(n.operation==='switch') requireThat(typeof n.handle==='string'&&n.handle.length>0,'INVALID_HANDLE');
      if(n.key) requireThat(/^[a-zA-Z0-9_-]{1,100}$/.test(n.key)&&!['__proto__','constructor','prototype'].includes(n.key),'INVALID_OUTPUT_KEY');
      if('readOnly' in n) requireThat(typeof n.readOnly==='boolean','INVALID_JOB_NODE');
    }
    if (['wait', 'branch'].includes(n.type)) condition(n.when, platformNames);
    if (n.type === 'wait') {
      if ('timeoutMs' in n) requireThat(Number.isSafeInteger(n.timeoutMs) && n.timeoutMs > 0, 'INVALID_TIMEOUT');
      if ('pollMs' in n) requireThat(Number.isInteger(n.pollMs) && n.pollMs >= 100 && n.pollMs <= 3600000, 'INVALID_TIMEOUT');
    }
    if (n.type === 'sleep') requireThat(Number.isSafeInteger(n.durationMs) && n.durationMs >= 0 && n.durationMs <= 365 * 86400000, 'INVALID_TIMEOUT');
    if (n.type === 'collect') { requireThat(typeof n.key === 'string' && /^[a-zA-Z0-9_-]+$/.test(n.key), 'INVALID_JOB_NODE'); validateSelector(n.selector); }
    if (n.replay !== undefined) requireThat(n.replay === 'idempotent', 'INVALID_REPLAY_POLICY');
    if ('verifyTimeoutMs' in n) requireThat(Number.isInteger(n.verifyTimeoutMs)&&n.verifyTimeoutMs>=0&&n.verifyTimeoutMs<=60000,'INVALID_TIMEOUT');
    if ('parameters' in n) requireThat(n.parameters&&typeof n.parameters==='object'&&!Array.isArray(n.parameters),'INVALID_PARAMETERS');
    if ('before' in n) condition(n.before, platformNames);
  }
  for (const n of job.nodes) for (const key of ['next', 'yes', 'no', 'onTimeout']) if (n[key] !== undefined) requireThat(ids.has(n[key]), 'INVALID_TRANSITION');
  requireThat(!job.start || ids.has(job.start), 'INVALID_TRANSITION');
  if ('maxTransitions' in job) requireThat(Number.isSafeInteger(job.maxTransitions) && job.maxTransitions > 0, 'INVALID_JOB');
  if ('userIdleMs' in job) requireThat(Number.isInteger(job.userIdleMs)&&job.userIdleMs>=0&&job.userIdleMs<=3600000,'INVALID_JOB');
  return job;
}

// Old saved jobs remain readable; new entry points accept the native UI path only.
export function assertUiJob(value) {
  function visit(node) {
    if(!node||typeof node!=='object')return;
    requireThat(node.type!=='browser'&&!Object.hasOwn(node,'browser'),'BROWSER_BOT_MODE_DISABLED');
    for(const child of Object.values(node))visit(child);
  }
  visit(value);return value;
}
