import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { DesktopSession } from '../desktop.mjs';
import { FirefoxClient } from '../firefox.mjs';
import { evaluate, select } from '../services/interface/index.mjs';
import { ExecutorError, requireThat } from '../errors.mjs';
import { JobStore } from '../persistence/jobs.mjs';
import { runnerStopped, jobDigest as digest, requireOutputSize, setJobOutput, bindOutputs, matchesConnector, shouldYieldWait, nextPollAt, warmWaitMs } from '../services/jobs/index.mjs';
import { createConnectors } from '../connectors.mjs';
import { readPage } from '../pages.mjs';

export class JobRunner {
  constructor({ store = new JobStore(), sessionFactory, browserFactory, connectorFactory, stopFile = resolve(import.meta.dirname, '../../local/STOP') } = {}) {
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
  async run(id, { signal, sliceMs = Infinity, yieldOnWait = false } = {}) {
    const release = await this.store.lock(id); let session; let state; let browser;let connectors;
    try {
      state = await this.store.read(id);
      const job = await this.store.definition(id);
      requireThat(state.planHash === digest(job), 'JOB_CHANGED');
      if (runnerStopped(state.status)) return state;
      const began = Date.now(); let visited = false;
      // A supervised worker can return at a durable wait boundary; a standalone
      // worker retains the previous behavior and waits for its own wake-up.
      const getSession = () => session ||= this.sessionFactory(job.allowedProcesses);
      const getBrowser = async () => {
        requireThat(job.allowedProcesses.some(p=>['*','firefox'].includes(p.toLowerCase())),'PROCESS_NOT_ALLOWED');
        if(!browser) { browser=this.browserFactory(); try {await browser.start();}catch(error){browser.close();browser=null;throw error;} }
        return browser;
      };
      const getConnectors=()=>connectors||=(this.connectorFactory?this.connectorFactory():createConnectors({mode:'execute',session:getSession(),allowedProcesses:job.allowedProcesses,journal:this.store.receiptJournal()}));
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
      while (!runnerStopped(state.status)) {
        if (this.store.cancelRequested(id) || signal?.aborted) { state.status = 'cancelled'; await commit(); break; }
        if (existsSync(this.stopFile)) { state.status = 'paused'; state.reason = 'STOP_REQUESTED'; await commit(); break; }
        if (visited && Date.now() - began >= sliceMs) { await commit(); return state; }
        if (yieldOnWait && shouldYieldWait(state, Date.now())) return state;
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
            if(node.durationMs>=warmWaitMs) {
              await connectors?.close();connectors=null;
              if(session) { await session.close(); session=null; }
            }
            if(state.wakeAt===undefined||state.status!=='waiting') {state.wakeAt ??= Date.now() + node.durationMs; state.status = 'waiting'; await commit();}
            if (yieldOnWait && shouldYieldWait(state, Date.now())) return state;
            if (Date.now() < state.wakeAt) { await delay(Math.min(1000, state.wakeAt - Date.now())); continue; }
            await advance(node); continue;
          }
          if (node.type === 'wait') {
            state.waitStartedAt ??= Date.now();
            if (state.wakeAt && Date.now() < state.wakeAt) {
              if (state.status !== 'waiting') { state.status = 'waiting'; await commit(); }
              if (yieldOnWait && shouldYieldWait(state, Date.now())) return state;
              await delay(Math.min(1000, state.wakeAt - Date.now())); continue;
            }
            if (await check(node.when)) { await advance(node); continue; }
            if (node.timeoutMs && Date.now() - state.waitStartedAt >= node.timeoutMs) {
              if (node.onTimeout) { await advance(node, node.onTimeout); continue; }
              throw new ExecutorError('CONDITION_TIMEOUT');
            }
            state.status = 'waiting'; state.wakeAt = nextPollAt(node, state.waitStartedAt, Date.now()); await commit(); continue;
          }
          if (node.type === 'branch') { await advance(node, await check(node.when) ? node.yes : node.no); continue; }
          if (node.type === 'finish') { state.status = 'completed'; await commit(); break; }
          if(node.type==='page') {
            state.inFlight={node:node.id,at:new Date().toISOString()};state.status='running';await commit();
            const result=await readPage(getSession(),node,{signal,userIdleMs:job.userIdleMs??3000,cancelFile:this.store.cancellationPath(id)});
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
            await connectors?.close(); connectors=null;
            await session?.close().catch(()=>{}); session=null;browser?.close();browser=null;
            await delay(250);continue;
          }
          if (!state.inFlight && ['INPUT_BUSY','BACKEND_TIMEOUT','BACKEND_CLOSED','USER_INTERFERENCE','WINDOW_NOT_UNIQUE','WINDOW_GONE','ACTIVATION_DENIED','USER_ACTIVE','DESKTOP_UNAVAILABLE','ECONNREFUSED','FIREFOX_DISCONNECTED','FIREFOX_TIMEOUT'].includes(error.code)) {
            await connectors?.close(); connectors=null;
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
    } finally {
      // Releasing the job lock must not depend on successful adapter cleanup.
      try { await connectors?.close(); }
      finally {
        try { if (browser) { try { await browser.end(); } catch { browser.close(); } } }
        finally {
          try { await session?.close(); }
          finally {
            try {
              // A runner can return to an embedding process that remains alive.
              // Release its dispatch hint while still holding the job lock.
              if (state?.workerPid === process.pid) {
                delete state.workerPid;
                await this.store.save(state);
              }
            } finally { await release(); }
          }
        }
      }
    }
  }
}
