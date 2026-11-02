import { open, readFile, rename, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { existsSync, statSync } from 'node:fs';
import { DesktopSession } from './desktop.mjs';
import { FirefoxClient } from './firefox.mjs';
import { validatePlan } from './executor.mjs';
import { evaluate, select, validateCondition, validateSelector } from './selectors.mjs';
import { ExecutorError, requireThat } from './errors.mjs';
import { writeJsonAtomic as atomic, lockFile } from './persistence/files.mjs';
import { requireOutputSize, setJobOutput } from './job-outputs.mjs';
import {createConnectors} from './connectors.mjs';
import {createConnectorJournal} from './connector-journal.mjs';
import {validateConnectorCall,validateConnectorCondition,bindOutputs,matchesConnector} from './connector-workflows.mjs';
import {readPage,validatePageRequest} from './pages.mjs';

export const defaultJobRoot = resolve(import.meta.dirname, '../local/jobs');
const terminal = new Set(['completed', 'cancelled', 'needs_decision', 'failed']);
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function condition(c) {
  requireThat(c && typeof c === 'object', 'INVALID_JOB_CONDITION');
  if (c.file) { requireThat(isAbsolute(c.file) && (!('minBytes' in c) || Number.isSafeInteger(c.minBytes) && c.minBytes >= 0), 'INVALID_JOB_CONDITION'); return; }
  if (c.browser) { requireThat(typeof c.browser.script === 'string' && c.browser.script.length > 0 && c.browser.script.length <= 100000, 'INVALID_JOB_CONDITION'); return; }
  if (c.connector) {validateConnectorCondition(c.connector);return;}
  requireThat(c.window && Object.keys(c.window).length && Object.keys(c.window).every(k => ['id', 'processId', 'processName', 'title'].includes(k)), 'INVALID_JOB_CONDITION');
  requireThat(typeof c.exists === 'boolean' || c.ui, 'INVALID_JOB_CONDITION');
  if (c.ui) validateCondition(c.ui);
}
export function validateJob(job) {
  requireThat(job?.version === 1 && typeof job.goal === 'string' && job.goal.length > 0 && job.goal.length <= 4096, 'INVALID_JOB');
  requireThat(Array.isArray(job.allowedProcesses) && job.allowedProcesses.every(p => typeof p === 'string' && p.length), 'INVALID_JOB');
  requireThat(Array.isArray(job.nodes) && job.nodes.length > 0 && job.nodes.length <= 1000, 'INVALID_JOB');
  const ids = new Set();
  for (const n of job.nodes) {
    requireThat(typeof n.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(n.id) && !ids.has(n.id), 'INVALID_JOB_NODE'); ids.add(n.id);
    requireThat(['ui', 'desktop', 'page', 'browser', 'connector', 'wait', 'sleep', 'branch', 'collect', 'finish'].includes(n.type), 'INVALID_JOB_NODE');
    if(n.type==='page')validatePageRequest(n);
    if(n.type==='connector'||n.type==='page') {
      if(n.type==='connector')validateConnectorCall(n.call);
      if(n.key)requireThat(/^[a-zA-Z0-9_-]{1,100}$/.test(n.key)&&!['__proto__','constructor','prototype'].includes(n.key),'INVALID_OUTPUT_KEY');
    }
    if (['ui', 'desktop', 'page', 'collect'].includes(n.type)) condition({ window: n.window, exists: true });
    if (n.type === 'ui') { validatePlan(n.plan); requireThat(n.plan.steps.length === 1, 'ONE_DURABLE_ACTION_PER_NODE'); }
    if (n.type === 'desktop') { requireThat(['click','key','type','move','drag','wheel','close_window','activate'].includes(n.operation), 'INVALID_OPERATION'); condition(n.expect); }
    if (n.type === 'browser') {
      requireThat(['evaluate','navigate','switch'].includes(n.operation), 'INVALID_OPERATION'); condition(n.expect);
      if(n.operation==='evaluate') requireThat(typeof n.script==='string'&&n.script.length>0&&n.script.length<=100000,'INVALID_SCRIPT');
      if(n.operation==='navigate') requireThat(typeof n.url==='string'&&/^https?:\/\//.test(n.url),'INVALID_URL');
      if(n.operation==='switch') requireThat(typeof n.handle==='string'&&n.handle.length>0,'INVALID_HANDLE');
      if(n.key) requireThat(/^[a-zA-Z0-9_-]{1,100}$/.test(n.key)&&!['__proto__','constructor','prototype'].includes(n.key),'INVALID_OUTPUT_KEY');
      if('readOnly' in n) requireThat(typeof n.readOnly==='boolean','INVALID_JOB_NODE');
    }
    if (['wait', 'branch'].includes(n.type)) condition(n.when);
    if (n.type === 'wait') {
      if ('timeoutMs' in n) requireThat(Number.isSafeInteger(n.timeoutMs) && n.timeoutMs > 0, 'INVALID_TIMEOUT');
      if ('pollMs' in n) requireThat(Number.isInteger(n.pollMs) && n.pollMs >= 100 && n.pollMs <= 3600000, 'INVALID_TIMEOUT');
    }
    if (n.type === 'sleep') requireThat(Number.isSafeInteger(n.durationMs) && n.durationMs >= 0 && n.durationMs <= 365 * 86400000, 'INVALID_TIMEOUT');
    if (n.type === 'collect') { requireThat(typeof n.key === 'string' && /^[a-zA-Z0-9_-]+$/.test(n.key), 'INVALID_JOB_NODE'); validateSelector(n.selector); }
    if (n.replay !== undefined) requireThat(n.replay === 'idempotent', 'INVALID_REPLAY_POLICY');
    if ('verifyTimeoutMs' in n) requireThat(Number.isInteger(n.verifyTimeoutMs)&&n.verifyTimeoutMs>=0&&n.verifyTimeoutMs<=60000,'INVALID_TIMEOUT');
    if ('parameters' in n) requireThat(n.parameters&&typeof n.parameters==='object'&&!Array.isArray(n.parameters),'INVALID_PARAMETERS');
    if ('before' in n) condition(n.before);
  }
  for (const n of job.nodes) for (const key of ['next', 'yes', 'no', 'onTimeout']) if (n[key] !== undefined) requireThat(ids.has(n[key]), 'INVALID_TRANSITION');
  requireThat(!job.start || ids.has(job.start), 'INVALID_TRANSITION');
  if ('maxTransitions' in job) requireThat(Number.isSafeInteger(job.maxTransitions) && job.maxTransitions > 0, 'INVALID_JOB');
  if ('userIdleMs' in job) requireThat(Number.isInteger(job.userIdleMs)&&job.userIdleMs>=0&&job.userIdleMs<=3600000,'INVALID_JOB');
  return job;
}
export class JobStore {
  constructor(root = defaultJobRoot) { this.root = resolve(root); }
  path(id, file = 'state.json') { requireThat(/^[a-zA-Z0-9_-]{1,100}$/.test(id), 'INVALID_JOB_ID'); return join(this.root, id, file); }
  async create(job) {
    validateJob(job); const id = randomUUID(); await mkdir(join(this.root, id), { recursive: true });
    await atomic(this.path(id, 'job.json'), job);
    await atomic(this.path(id), { id, goal: job.goal, planHash: digest(job), status: 'queued', node: job.start || job.nodes[0].id,
      transitions: 0, outputs: {}, history: [], createdAt: new Date().toISOString() });
    return this.read(id);
  }
  async read(id) { return JSON.parse(await readFile(this.path(id), 'utf8')); }
  async save(state) { state.updatedAt = new Date().toISOString(); await atomic(this.path(state.id), state); }
  async list() {
    await mkdir(this.root, { recursive: true }); const result = [];
    for (const id of await readdir(this.root)) { try { const s = await this.read(id); result.push({ id, goal: s.goal, status: s.status, node: s.node, wakeAt: s.wakeAt, workerPid: s.workerPid }); } catch { } }
    return result;
  }
  async cancel(id) { const f = await open(this.path(id, 'CANCEL'), 'a'); await f.close(); return { id, cancelRequested: true }; }
  async resume(id) {
    const release = await this.lock(id);
    try {
      const state = await this.read(id);
      requireThat(!['completed','cancelled'].includes(state.status), 'JOB_TERMINAL');
      // Keep inFlight. Resume performs reconciliation, never erases uncertainty.
      state.status = 'queued'; delete state.reason; await this.save(state); return state;
    } finally { await release(); }
  }
  async lock(id) {
    return lockFile(this.path(id, 'worker.lock'), 'JOB_ALREADY_RUNNING');
  }
}
export class JobRunner {
  constructor({ store = new JobStore(), sessionFactory, browserFactory, connectorFactory, stopFile = resolve(import.meta.dirname, '../local/STOP') } = {}) {
    this.store = store; this.stopFile = stopFile;
    this.sessionFactory = sessionFactory || (allowedProcesses => new DesktopSession({ mode: 'execute', allowedProcesses, stopFile }));
    this.browserFactory = browserFactory || (() => new FirefoxClient({timeoutMs:30000}));
    this.connectorFactory=connectorFactory;
  }
  async test(c, session, browserProvider) {
    if (c.file) { try { return statSync(c.file).size >= (c.minBytes || 0); } catch { return false; } }
    if (c.browser) return await (await browserProvider()).evaluate(c.browser.script,c.browser.args||[]) === true;
    const matches = (await session.windows()).filter(w => Object.entries(c.window).every(([k, v]) => w[k] === v));
    if (!c.ui) return c.exists ? matches.length === 1 : matches.length === 0;
    if (matches.length !== 1) return false;
    await session.bind({ id: matches[0].id });
    return evaluate(await session.observe({ ...c.observe, includeValues: true }), c.ui) === true;
  }
  async run(id, { signal, sliceMs = Infinity } = {}) {
    const release = await this.store.lock(id); let session; let state; let browser;let connectors;
    try {
      const job = validateJob(JSON.parse(await readFile(this.store.path(id, 'job.json'), 'utf8')));
      state = await this.store.read(id);
      requireThat(state.planHash === digest(job), 'JOB_CHANGED');
      if (terminal.has(state.status)) return state;
      const began = Date.now(); let visited = false;
      // Native process is lazy: long sleeps keep only the small Node worker.
      const getSession = () => session ||= this.sessionFactory(job.allowedProcesses);
      const getBrowser = async () => {
        requireThat(job.allowedProcesses.some(p=>['*','firefox'].includes(p.toLowerCase())),'PROCESS_NOT_ALLOWED');
        if(!browser) { browser=this.browserFactory(); try {await browser.start();}catch(error){browser.close();browser=null;throw error;} }
        return browser;
      };
      const getConnectors=()=>connectors||=(this.connectorFactory?this.connectorFactory():createConnectors({mode:'execute',session:getSession(),allowedProcesses:job.allowedProcesses,journal:createConnectorJournal(join(this.store.root,'__connector-requests'))}));
      const check = async c => {
        if(!c.connector)return this.test(c,c.file||c.browser?null:getSession(),getBrowser);
        const call=bindOutputs(c.connector.call,state.outputs),runtime=getConnectors();
        requireThat(runtime.describe(call).operation.readOnly,'MUTATING_WAIT_FORBIDDEN');
        const result=await runtime.invoke(call,{signal});return matchesConnector(result.output,c.connector);
      };
      const commit = async () => { state.workerPid = process.pid; await this.store.save(state); };
      await commit();
      const advance = async (node, next) => {
        state.history.push({ node: node.id, at: new Date().toISOString(), outcome: 'verified' });
        if (state.history.length > 200) state.history.shift();
        state.transitions++; state.node = next ?? node.next ?? job.nodes[job.nodes.indexOf(node) + 1]?.id;
        delete state.inFlight; delete state.wakeAt; delete state.waitStartedAt; delete state.reason;
        state.status = state.node ? 'running' : 'completed'; await commit();
      };
      while (!terminal.has(state.status)) {
        if (existsSync(this.store.path(id, 'CANCEL')) || signal?.aborted) { state.status = 'cancelled'; await commit(); break; }
        if (existsSync(this.stopFile)) { state.status = 'paused'; state.reason = 'STOP_REQUESTED'; await commit(); break; }
        if (visited && Date.now() - began >= sliceMs) { await commit(); return state; }
        visited = true;
        requireThat(state.transitions < (job.maxTransitions ?? 100000), 'TRANSITION_LIMIT');
        const node = job.nodes.find(n => n.id === state.node); requireThat(node, 'INVALID_CHECKPOINT');
        const reconciling=!!state.inFlight;
        try {
        if(node.type==='connector') {
          const runtime=getConnectors(),call=bindOutputs(node.call,state.outputs);
          const operation=runtime.describe(call).operation;requireThat(operation.durable,'UNVERIFIABLE_DURABLE_OPERATION');
          if(node.before&&!state.inFlight)requireThat(await check(node.before),'PRECONDITION_FAILED');
          if(!operation.readOnly&&!state.inFlight) {state.inFlight={node:node.id,at:new Date().toISOString()};state.status='running';await commit();}
          const result=await runtime.invoke({...call,requestId:'job_'+digest([id,node.id,state.transitions]).slice(0,48)},{signal});
          requireThat(['verified','observed'].includes(result.output?.taskStatus),'UI_PLAN_UNVERIFIED');
          if(node.key)setJobOutput(state.outputs,node.key,result.output);
          await advance(node);continue;
        }
        if (state.inFlight) {
          // The write-ahead record survives crashes between delivery and ack.
          const expected = node.type === 'ui' ? { window: node.window, ui: node.plan.steps[0].expect, observe: node.plan.observe } : node.expect;
          if (expected && await check(expected)) {
            if(node.key && node.type==='browser') {
              if('output' in state.inFlight) state.outputs[node.key]=state.inFlight.output;
              else if(node.replay==='idempotent') {delete state.inFlight;}
              else {state.status='needs_decision';state.reason='MISSING_ACTION_OUTPUT';await commit();break;}
              if(!state.inFlight) continue;
            }
            await advance(node); continue;
          }
          if (node.replay !== 'idempotent') { state.status = 'needs_decision'; state.reason = 'UNVERIFIED_IN_FLIGHT_ACTION'; await commit(); break; }
          delete state.inFlight;
        }
          if (state.status === 'waiting' && state.reason && state.wakeAt > Date.now()) { await delay(Math.min(1000,state.wakeAt-Date.now())); continue; }
          if (node.type === 'sleep') {
            // Only genuinely long waits release the host. Short UI settling
            // delays must retain the warmed accessibility provider.
            if(node.durationMs>=30000) {
              await connectors?.close();connectors=null;
              if(session) { await session.close(); session=null; }
            }
            if(state.wakeAt===undefined||state.status!=='waiting') {state.wakeAt ??= Date.now() + node.durationMs; state.status = 'waiting'; await commit();}
            if (Date.now() < state.wakeAt) { await delay(Math.min(1000, state.wakeAt - Date.now())); continue; }
            await advance(node); continue;
          }
          if (node.type === 'wait') {
            state.waitStartedAt ??= Date.now();
            if (state.wakeAt && Date.now() < state.wakeAt) { await delay(Math.min(1000, state.wakeAt - Date.now())); continue; }
            if (await check(node.when)) { await advance(node); continue; }
            if (node.timeoutMs && Date.now() - state.waitStartedAt >= node.timeoutMs) {
              if (node.onTimeout) { await advance(node, node.onTimeout); continue; }
              throw new ExecutorError('CONDITION_TIMEOUT');
            }
            state.status = 'waiting'; state.wakeAt = Date.now() + (node.pollMs ?? 1000); await commit(); continue;
          }
          if (node.type === 'branch') { await advance(node, await check(node.when) ? node.yes : node.no); continue; }
          if (node.type === 'finish') { state.status = 'completed'; await commit(); break; }
          if(node.type==='page') {
            state.inFlight={node:node.id,at:new Date().toISOString()};state.status='running';await commit();
            const result=await readPage(getSession(),node,{signal,userIdleMs:job.userIdleMs??3000,cancelFile:this.store.path(id,'CANCEL')});
            if(node.key)setJobOutput(state.outputs,node.key,result);
            await advance(node);continue;
          }
          if(node.before) requireThat(await check(node.before),'PRECONDITION_FAILED');
          if(node.type==='browser') {
            if(!node.readOnly) {
              const desktop=getSession(); const health=await desktop.backend.hello();
              requireThat(health.interactiveDesktop,'DESKTOP_UNAVAILABLE');
              requireThat(health.inputIdleMs>=(job.userIdleMs??3000),'USER_ACTIVE');
            }
            const client=await getBrowser();
            state.inFlight={node:node.id,at:new Date().toISOString()}; state.status='running'; await commit();
            let output;
            if(node.operation==='evaluate') output=await client.evaluate(node.script,node.args||[]);
            else if(node.operation==='navigate') output=await client.navigate(node.url);
            else output=await client.switchTo(node.handle);
            if(node.key) {requireOutputSize(output??null);state.inFlight.output=output??null;await commit();}
            const until=Date.now()+(node.verifyTimeoutMs??5000);
            while(!(await check(node.expect))) {requireThat(Date.now()<until,'POSTCONDITION_TIMEOUT');await delay(250);}
            if(node.key) setJobOutput(state.outputs,node.key,output);
            await advance(node); continue;
          }
          const desktop = getSession(); await desktop.bind(node.window);
          if (node.type === 'collect') {
            const observation = await desktop.observe({ ...node.observe, includeValues: true });
            requireThat(!observation.truncated, 'INCOMPLETE_OBSERVATION');
            setJobOutput(state.outputs,node.key,select(observation, node.selector).map(e => ({ name: e.name, role: e.role, value: e.value })));
            await advance(node); continue;
          }
          if (desktop.backend?.hello) {
            const health = await desktop.backend.hello();
            requireThat(health.interactiveDesktop, 'DESKTOP_UNAVAILABLE');
            requireThat(health.inputIdleMs >= (job.userIdleMs ?? 3000), 'USER_ACTIVE');
          }
          await desktop.activate();
          const frame = node.type === 'desktop' && node.operation !== 'activate' ? await desktop.frame() : null;
          state.inFlight = { node: node.id, at: new Date().toISOString() }; state.status = 'running'; await commit();
          if (node.type === 'ui') {
            const result = await desktop.executor.run(node.plan);
            if (result.status !== 'completed') {
              if (result.status !== 'uncertain') delete state.inFlight;
              throw new ExecutorError(result.status === 'uncertain' ? 'ACTION_UNVERIFIED' : result.reason || 'ACTION_UNVERIFIED');
            }
          } else {
            await desktop.action(node.operation, { ...node.parameters, ...(frame ? { frameId: frame.frameId } : {}) });
            const until = Date.now() + (node.verifyTimeoutMs ?? 5000);
            while (!(await check(node.expect))) { requireThat(Date.now() < until, 'POSTCONDITION_TIMEOUT'); await delay(250); }
          }
          await advance(node);
        } catch (error) {
          if(error.code==='CANCELLED'||error.name==='AbortError') {state.status='cancelled';state.reason='CANCELLED';await commit();break;}
          if(error.code==='STOP_REQUESTED') {state.status='paused';state.reason=error.code;await commit();break;}
          // Page's idle gate runs before navigation. Waiting for the user to
          // finish is not uncertain delivery and must not require an agent.
          if(node.type==='page'&&error.code==='USER_ACTIVE')delete state.inFlight;
          if(node.type==='connector'&&error.safeToRetry)delete state.inFlight;
          if (node.type!=='connector'&&!reconciling&&['INPUT_BUSY','READ_ONLY','STOP_REQUESTED','USER_INTERFERENCE','STALE_FRAME','STALE_SNAPSHOT','OCCLUDED_TARGET','WINDOW_GONE','DESKTOP_UNAVAILABLE'].includes(error.code)) delete state.inFlight;
          if(state.inFlight&&['BACKEND_TIMEOUT','BACKEND_CLOSED','FIREFOX_TIMEOUT','FIREFOX_DISCONNECTED','ECONNREFUSED','ACTION_UNVERIFIED','ACTION_INTERRUPTED','WINDOW_GONE','WINDOW_NOT_UNIQUE'].includes(error.code)) {
            state.status='reconciling'; state.reason=error.code; await commit();
            await session?.close().catch(()=>{}); session=null;browser?.close();browser=null;
            await delay(250);continue;
          }
          if (!state.inFlight && ['INPUT_BUSY','BACKEND_TIMEOUT','BACKEND_CLOSED','USER_INTERFERENCE','WINDOW_NOT_UNIQUE','WINDOW_GONE','ACTIVATION_DENIED','USER_ACTIVE','DESKTOP_UNAVAILABLE','ECONNREFUSED','FIREFOX_DISCONNECTED','FIREFOX_TIMEOUT'].includes(error.code)) {
            await session?.close().catch(() => {}); session = null;
            browser?.close(); browser=null;
            state.status = 'waiting'; state.reason = error.code; state.wakeAt = Date.now() + 2000; await commit();
            await delay(1000); continue;
          }
          state.status = state.inFlight||error.code==='NEEDS_DECISION' ? 'needs_decision' : 'failed'; state.reason = error.code || 'JOB_ERROR'; await commit();
        }
      }
      return state;
    } catch (error) {
      if (state) { state.status = state.inFlight ? 'needs_decision' : 'failed'; state.reason = error.code || 'JOB_ERROR'; await this.store.save(state); return state; }
      throw error;
    } finally { await connectors?.close();if(browser){try{await browser.end();}catch{browser.close();}} await session?.close().catch(() => {}); await release(); }
  }
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
