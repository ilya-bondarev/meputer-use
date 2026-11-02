import { basename, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { NativeBackend } from './native.mjs';
import { WindowsExecutor } from './executor.mjs';
import { requireThat } from './errors.mjs';
import { select } from './selectors.mjs';
import { credentialParameters } from './credentials.mjs';
import {createDecisionClient,decisionOptions} from './decisions.mjs';

// One persistent native process shared by UIA and visual actions. No private
// Codex APIs, sockets or hidden focus assumptions.
export class DesktopSession {
  constructor({ mode = 'read-only', allowedProcesses = [], stopFile, backend, decision } = {}) {
    this.backend = backend || new NativeBackend({ mode, stopFile, timeoutMs: 15000 });
    const options=decisionOptions();
    const client=options?createDecisionClient(options):null;
    this.executor = new WindowsExecutor({ backend: this.backend, mode, allowedProcesses, stopFile,decision:decision||(client?(request=>client.pick(request)):undefined) });
    this.mode = mode;
    this.stopFile=stopFile;
    this.allowedProcesses = allowedProcesses.map(p => p.toLowerCase());
  }
  windows() { return this.executor.windows(); }
  async bind(selector) { this.window = await this.executor.bind(selector); return this.window; }
  observe(options) { return this.executor.observe(options); }
  document(options={}) { return this.backend.request('document',{...options,windowId:this.window.id,processId:this.window.processId}); }
  frame() { return this.backend.request('frame',{windowId:this.window.id,processId:this.window.processId}); }
  sequence(actions,{expectedInputTick}={}) { return this.backend.request('sequence',{windowId:this.window.id,processId:this.window.processId,actions,...(expectedInputTick===undefined?{}:{expectedInputTick})}); }
  batch(actions) {
    return this.withInputLease(async()=>{
      const receipt=await this.sequence(actions);
      try{return {receipt,frame:await this.frame(),taskStatus:'unverified'};}
      catch(error){return {receipt,observationError:error.code??'OBSERVATION_FAILED',taskStatus:'unverified',retryAllowed:false};}
    });
  }
  health() { return this.backend.hello(); }
  runPlan(plan,options) { return this.executor.run(plan,options); }
  previewPlan(plan) { return this.executor.preview(plan); }
  async withInputLease(operation) {
    await this.backend.request('lease_acquire');
    try {return await operation();} finally {await this.backend.request('lease_release');}
  }
  async fillSecret({selector,secretRef,observe,expectedWindowTitle,expectedOrigin}) {
    requireThat(this.mode==='execute','READ_ONLY');
    requireThat(this.window&&typeof expectedWindowTitle==='string'&&expectedWindowTitle===this.window.title,'CREDENTIAL_TARGET_MISMATCH');
    // Verify the browser's own address control, never a page-provided label.
    if(this.window.processName.toLowerCase()==='firefox') {
      requireThat(typeof expectedOrigin==='string'&&new URL(expectedOrigin).origin===expectedOrigin,'EXPECTED_ORIGIN_REQUIRED');
      const document=await this.observe({activeDocument:true,maxElements:1,maxDepth:0,includeValues:true,budgetMs:3000});
      requireThat(document.elements.some(e=>e.role==='Document'&&typeof e.value==='string'&&(()=>{try{return new URL(e.value).origin===expectedOrigin;}catch{return false;}})()),'CREDENTIAL_ORIGIN_MISMATCH');
    }
    const snapshot=await this.observe({...observe,includeValues:false});
    requireThat(!snapshot.truncated&&!snapshot.inputChangedDuringRead,'INCOMPLETE_OBSERVATION');
    const fields=select(snapshot,selector).filter(e=>e.role==='Edit'&&e.enabled&&!e.offscreen);
    requireThat(fields.length===1,'CREDENTIAL_FIELD_NOT_UNIQUE');
    const parameters=credentialParameters(secretRef);
    try {return await this.backend.request('secret',{windowId:this.window.id,processId:this.window.processId,ref:fields[0].ref,...parameters});}
    finally {delete parameters.value;}
  }
  async activate() {
    requireThat(this.window, 'NO_WINDOW');
    return this.backend.desktop(this.window, 'activate');
  }
  async capture() { requireThat(this.window, 'NO_WINDOW'); return this.backend.capture(this.window); }
  async action(operation, parameters) {
    requireThat(this.window, 'NO_WINDOW');
    return this.backend.desktop(this.window, operation, parameters);
  }
  async launch(executable, args = [], {administrator=false}={}) {
    requireThat(this.mode === 'execute', 'READ_ONLY');
    requireThat(typeof executable === 'string' && isAbsolute(executable), 'ABSOLUTE_PATH_REQUIRED');
    const name = basename(executable).replace(/\.exe$/i, '').toLowerCase();
    requireThat(this.allowedProcesses.includes('*') || this.allowedProcesses.includes(name), 'PROCESS_NOT_ALLOWED');
    requireThat(!(await this.backend.request('classify', { processName: name })).restricted, 'RESTRICTED_APP');
    requireThat(Array.isArray(args) && args.every(a => typeof a === 'string'), 'INVALID_ARGUMENT');
    requireThat(name!=='firefox'||!args.some(a=>/^--?(marionette|remote-debugging|remote-debugging-port)(?:=|$)/i.test(a)),'BROWSER_BOT_MODE_DISABLED');
    if(administrator)return this.backend.request('admin_launch',{executable,args});
    const child = spawn(executable, args, { windowsHide: true, detached: true, shell: false, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref(); return { processId: child.pid };
  }
  launchAdmin(executable,args=[]) {return this.launch(executable,args,{administrator:true});}
  adminStatus(ticket) {return this.backend.request('admin_status',{ticket});}
  close() { return this.backend.close(); }
}
