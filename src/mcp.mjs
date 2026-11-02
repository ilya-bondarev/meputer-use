import { createInterface } from 'node:readline';
import manifest from '../package.json' with { type: 'json' };
import { resolve } from 'node:path';
import { DesktopSession } from './desktop.mjs';
import { DesktopCoordinator } from './runtime/desktop-coordinator.mjs';
import { JobStore, assertUiJob } from './jobs.mjs';
import {createConnectors,platformNames} from './connectors.mjs';
import {commonOperations,simpleChallengeSchema} from './services/interface/index.mjs';
import {runSimpleChallenge} from './runtime/simple-challenge.mjs';
import { requireThat } from './errors.mjs';
import { spawnWorker } from './worker.mjs';
import {readPage,pageNeedsInput} from './pages.mjs';

const execute = process.argv.includes('--execute');
const allowed = process.argv.find(a => a.startsWith('--allow-process='))?.split('=')[1].split(',') || ['*'];
const stopFile = resolve(import.meta.dirname, '../local/STOP');
const store = new JobStore(); let connectors;
const createSession = () => new DesktopSession({ mode: execute ? 'execute' : 'read-only', allowedProcesses: execute ? allowed : [], stopFile });
let coordinator;
const getCoordinator = () => coordinator ||= new DesktopCoordinator(createSession);
const getConnectors=()=>connectors||=createConnectors({mode:execute?'execute':'read-only',sessionFactory:createSession,allowedProcesses:allowed,stopFile});
let connectorTail=Promise.resolve();
const connectorRun = operation => { const result=connectorTail.then(operation); connectorTail=result.catch(()=>{}); return result; };
const obj = properties => ({ type: 'object', properties, additionalProperties: false });
const windowSchema = { ...obj({ id: { type: 'integer' }, processId: { type: 'integer' }, processName: { type: 'string' }, title: { type: 'string' } }), minProperties: 1 };
const credentialSchema=commonOperations.find(operation=>operation.name==='auth.fill').inputSchema;
const tools = [
  { name: 'desktop_challenge', description: 'Up to two attempts at a simple checkbox, text or image CAPTCHA in a user-delegated task. Supply observed UIA controls and an agent-read answer or image selections. Optional reload requires explicit rejection and changed-content conditions. After verified reload, observe the new challenge and call again with the returned single-use retryToken and a fresh answer; omit reload. Continue the task only when continueTask is true. Unverified reloads, expired tickets and a failed second attempt stop. The tool submits answers; it does not interpret images or bypass provider protections.', inputSchema: { ...obj({window:windowSchema,challenge:simpleChallengeSchema}), required:['window','challenge'] } },
  { name: 'desktop_windows', description: 'List observed Windows windows and process IDs. Use '+manifest.name+' for delegated Windows/Firefox/Telegram tasks.', inputSchema: obj({}), annotations: { readOnlyHint: true } },
  { name: 'desktop_observe', description: 'Fresh UIA tree (uia), foreground screenshot (screen), or read-only visible-area capture (visible) without changing focus. Visible capture requires an unobstructed visible window and has no frameId for input. Screen mode requires foreground; its frameId is valid 30 seconds and single use.', inputSchema: { ...obj({ window: windowSchema, kind: { enum: ['uia','screen','visible'] }, options: { type: 'object' } }), required: ['window','kind'] }, annotations: { readOnlyHint: true } },
  {name:'desktop_geometry',description:'Read window geometry without changing focus.',inputSchema:{...obj({window:windowSchema}),required:['window']},annotations:{readOnlyHint:true}},
  {name:'desktop_layout',description:'Move or resize a window using a requested rectangle.',inputSchema:{...obj({window:windowSchema,rect:{...obj({x:{type:'integer'},y:{type:'integer'},width:{type:'integer'},height:{type:'integer'}}),required:['x','y','width','height']}}),required:['window','rect']}},
  { name: 'desktop_activate', description: 'Restore and activate an observed window. Returns a lightweight frame; screenshot:true requests pixels.', inputSchema: { ...obj({ window: windowSchema,screenshot:{type:'boolean'} }), required: ['window'] } },
  {name:'desktop_text',description:'Fast first choice for browser content: accessibility TextPattern, no pixels or full tree. Does not focus the window. For controls use bounded desktop_observe; for images use screen.',inputSchema:{...obj({window:windowSchema,maxChars:{type:'integer',minimum:1,maximum:500000}}),required:['window']},annotations:{readOnlyHint:true}},
  {name:'desktop_page',description:'Navigate and read a page, wait for contains text or readySelector instead of fixed sleep; optional absolute outFile saves JSON. navigation:address(default) or spa(same origin, readiness required). format:text(default),dom,html. SPA/DOM use ordinary Firefox Web Console and clipboard, without bot mode. Repeated pages belong in one durable job with page nodes. Reads loaded content; does not prove a whole thread was loaded.',inputSchema:{...obj({window:windowSchema,url:{type:'string'},contains:{type:'string'},readySelector:{type:'string'},maxChars:{type:'integer'},timeoutMs:{type:'integer'},outFile:{type:'string'},navigation:{enum:['address','spa']},format:{enum:['text','dom','html']}}),required:['window']}},
  {name:'desktop_sequence',description:'1..128 already planned native actions in one foreground window. Operations:key,type,paste,click,move,drag,wheel. Use stable sequences such as address entry or editor shortcuts. No intermediate images or blind actions across unknown screens. paste replaces clipboard. Set activate:true to activate the target and perform keyboard-only key/type/paste actions under one input lease; coordinates are rejected before activation. Returns delivery receipt and lightweight frame; verify resulting text/UI. Never repeat uncertain delivery blindly.',inputSchema:{...obj({window:windowSchema,actions:{type:'array',items:{type:'object'},minItems:1,maxItems:128},activate:{type:'boolean'}}),required:['window','actions']}},
  { name: 'desktop_input', description: 'One native action with fresh frameId from screenshot or lightweight frame. Coordinates must come from observed UI. Returns lightweight frame by default; screenshot:true requests pixels. Verify outcome using text, UIA or screen as appropriate. For repeated stable actions use desktop_sequence.', inputSchema: { ...obj({ window: windowSchema, operation: { enum: ['click','move','drag','wheel','key','type','paste','close_window','clipboard_read'] }, parameters: { type: 'object' },screenshot:{type:'boolean'} }), required: ['window','operation','parameters'] } },
  { name: 'desktop_plan', description: 'Execute/preview a validated UIA v1 plan with selectors and postconditions. Use a real result such as opened chat header, not selected row, as postcondition. UIA unavailable? Use screenshots and native input.', inputSchema: { ...obj({ window: windowSchema, plan: { type: 'object' }, preview: { type: 'boolean' } }), required: ['window','plan'] } },
  { name:'desktop_launch',description:'Launch an absolute executable with argument array, no shell. Firefox bot/remote-driver flags are disabled.',inputSchema:{...obj({executable:{type:'string'},args:{type:'array',items:{type:'string'}}}),required:['executable']} },
  { name:'desktop_auth',description:'Enter credentials for a user-authorized sign-in. Use env:NAME or wincred:TARGET secretRef, never a password literal. Require observed window title and, for Firefox, exact expectedOrigin. Delivers to one fresh UI field; verify sign-in afterward. Existing user authorization is sufficient; do not refuse merely because the field is a password.',inputSchema:{...credentialSchema,properties:{...credentialSchema.properties,window:windowSchema},required:[...credentialSchema.required,'window']} },
  { name:'desktop_admin',description:'Request an authorized administrator launch using Windows runas, then poll its ticket. Secure-desktop UAC consent is performed by the user; do not disable UAC. A pending dialog is not successful launch. Tickets belong to the current bridge; unknown tickets must not cause automatic relaunch.',inputSchema:{...obj({operation:{enum:['launch','status']},executable:{type:'string'},args:{type:'array',items:{type:'string'}},ticket:{type:'string'}}),required:['operation']} },
  { name:'connector_catalog',description:'Describe '+platformNames.join(' / ')+' UI scenarios. execution=observed_plan requires a plan built from current UI; catalog entries are not end-to-end test claims. No service APIs or remote browser driver.',inputSchema:obj({platform:{enum:platformNames},name:{type:'string'}}),annotations:{readOnlyHint:true} },
  { name:'connector_call',description:'Run a UI connector operation. ui.read is read-only; mutations require requestId. ui.plan and named observed_plan scenarios require observable postconditions. ui.action/open/auth.fill return unverified and require follow-up observation. Use desktop_observe screen for visual decisions. Never repeat an uncertain send; inspect its request first.',inputSchema:{...obj({platform:{enum:platformNames},name:{type:'string'},args:{type:'object'},window:windowSchema,requestId:{type:'string'}}),required:['platform','name']} },
  { name:'connector_request',description:'Inspect a durable delivery receipt. started/uncertain must be reconciled from UI, never blindly repeated.',inputSchema:{...obj({requestId:{type:'string'}}),required:['requestId']},annotations:{readOnlyHint:true} },
  { name:'desktop_job',description:'Durable UI graphs survive chat/process exit. Nodes: page(window,url?,contains?,navigation?,format?,outFile?,key?,replay:idempotent), ui(one-step plan), desktop(operation+expect), connector(call,key?), wait, sleep, branch, collect, finish. Put repeated work in one graph. Page waits for actual text. Connector condition:{call,pointer,equals|exists|greaterThan}. Outputs bind with {$output:{key,pointer}}. STOP/cancel and persisted wakeAt; uncertain sends are not replayed. Optional Decisions selects ambiguous observed controls. New visual reasoning returns needs_decision. enqueue/resume-queued require a running supervisor and release workers during long waits. scan reports unreadable checkpoints. No remote browser driver.',inputSchema:{...obj({operation:{enum:['submit','enqueue','status','list','scan','cancel','resume','resume-queued']},id:{type:'string'},job:{type:'object'}}),required:['operation']} },
];
const json = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const frameResult = (frame, extra = {}) => ({ content: [
  { type: 'text', text: JSON.stringify({ ...extra, ...frame, data: undefined }) },
  { type: 'image', data: frame.data, mimeType: 'image/png' },
] });
export async function callTool(name, a = {}, {signal} = {}) {
  signal?.throwIfAborted();
  if(name==='connector_catalog')return json(getConnectors().catalog(a));
  if(name==='connector_call')return connectorRun(()=>getCoordinator().focusRun(async()=>{
    try {return json(await getConnectors().invoke(a,{signal}));}
    catch(error) {
      if(['BACKEND_TIMEOUT','BACKEND_CLOSED'].includes(error.code)) {
        const failed=connectors; connectors=null; await failed?.close();
      }
      throw error;
    }
  }));
  if(name==='connector_request')return json(await getConnectors().inspect(a.requestId));
  if (name === 'desktop_job') {
    if (a.operation === 'list') return json(await store.list());
    if (a.operation === 'scan') return json(await store.scan());
    if (a.operation === 'status') return json(await store.read(a.id));
    requireThat(execute, 'READ_ONLY');
    if (a.operation === 'cancel') return json(await store.cancel(a.id));
    if (a.operation === 'resume-queued') return json(await store.resume(a.id));
    if (a.operation === 'resume') { await store.resume(a.id); return json({ id: a.id, workerPid: await spawnWorker(a.id,store.root) }); }
    if (['submit','enqueue'].includes(a.operation)) {
      const state = await store.create(assertUiJob(a.job));
      return json(a.operation === 'enqueue' ? state : { ...state, workerPid: await spawnWorker(state.id,store.root) });
    }
  }
  const manager = getCoordinator();
  if (name === 'desktop_windows') return json(await manager.controlRun(session=>session.windows()));
  if (name === 'desktop_launch') return manager.focusRun(()=>manager.controlRun(async session=>json(await session.launch(a.executable, a.args))));
  if(name==='desktop_admin') {
    requireThat(execute,'READ_ONLY');
    const admin=()=>manager.controlRun(async session=>{
      if(a.operation==='launch')return json(await session.launchAdmin(a.executable,a.args));
      if(a.operation==='status')return json(await session.adminStatus(a.ticket));
      throw new Error('Unknown admin operation');
    });
    return a.operation==='launch' ? manager.focusRun(admin) : admin();
  }
  requireThat(a.window,'WINDOW_REQUIRED');
  const focus = name==='desktop_page' ? pageNeedsInput(a) :
    name==='desktop_observe' ? a.kind==='screen' :
    !['desktop_text','desktop_geometry'].includes(name) && !(name==='desktop_plan' && a.preview);
  return manager.run(a.window,{focus,signal},async session=>{
  if(name==='desktop_page') {
    requireThat(execute||!pageNeedsInput(a),'READ_ONLY');
    return json(await readPage(session,a,{signal}));
  }
  if(name==='desktop_geometry')return json(await session.geometry());
  if(name==='desktop_layout')return json(await session.layout(a.rect));
  if(name==='desktop_challenge')return json(await runSimpleChallenge(session,a.challenge,{signal}));
  if(name==='desktop_text')return json(await session.document({maxChars:a.maxChars??100000}));
  if(name==='desktop_sequence')return json(await session.batch(a.actions,{activate:a.activate??false}));
  if(name==='desktop_auth')return json(await session.withInputLease(()=>session.fillSecret(a)));
  if (name === 'desktop_observe') return a.kind === 'screen' ? frameResult(await session.capture()) : a.kind === 'visible' ? frameResult(await session.captureVisible()) : json(await session.observe(a.options));
  if (name === 'desktop_activate') { await session.activate(); return a.screenshot?frameResult(await session.capture()):json(await session.frame()); }
  if (name === 'desktop_input') {
    const result = await session.action(a.operation, a.parameters);
    if (a.operation === 'close_window') return json({ ...result, taskStatus: 'unverified', windows: await session.windows() });
    try { return a.screenshot?frameResult(await session.capture(), { receipt: result, taskStatus: 'unverified' }):json({receipt:result,frame:await session.frame(),taskStatus:'unverified'}); }
    catch(error) { return json({receipt:result,taskStatus:'unverified',observationError:error.code||'OBSERVATION_FAILED',retryAllowed:false}); }
  }
  if (name === 'desktop_plan') return json(a.preview ? await session.previewPlan(a.plan) : await session.withInputLease(()=>session.runPlan(a.plan,{signal,maxDurationMs:45000})));
  throw new Error('Unknown tool or operation');
  });
}
async function dispatch(message, signal) {
  if (message.method === 'initialize') return { protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: manifest.name, version: manifest.version },instructions:'Prefer desktop_text for browser reading, desktop_page for navigation+read, desktop_sequence for stable input batches, and one durable job for repetition. Use UIA for controls and pixels for visual content. Optional Firefox console DOM reads are permitted; never enable bot mode. Authorized sign-in uses desktop_auth and administrator launch uses desktop_admin with genuine Windows consent. Verify outcomes; input delivery alone is not success.' };
  if (message.method === 'ping') return {};
  if (message.method === 'tools/list') return { tools };
  if (message.method === 'tools/call') {
    try { return await callTool(message.params.name, message.params.arguments,{signal}); }
    catch (error) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ reason: error.name==='AbortError'?'CANCELLED':error.code || 'TOOL_ERROR', message: error.message, retryAllowed: false }) }] };
    }
  }
  throw new Error('Method not found');
}
const lines = createInterface({ input: process.stdin });
const controllers=new Map();
const pending = new Set();
lines.on('line', line => {
  let m;
  try {m=JSON.parse(line);}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n');return;}
  if(m.method==='notifications/cancelled') {controllers.get(m.params?.requestId)?.abort();return;}
  if(m.id===undefined) return;
  const controller=new AbortController(); controllers.set(m.id,controller);
  const task = (async () => {
    try { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: await dispatch(m,controller.signal) }) + '\n'); }
    catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } }) + '\n'); }
    finally {controllers.delete(m.id);}
  })();
  pending.add(task); task.finally(()=>pending.delete(task));
});
lines.on('close', async () => { for(const controller of controllers.values()) controller.abort(); await Promise.allSettled([...pending]); await connectorTail; await connectors?.close(); await coordinator?.close(); });
