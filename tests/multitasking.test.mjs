import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopCoordinator } from '../src/runtime/desktop-coordinator.mjs';

const windows = [{id:1,processId:42},{id:2,processId:42}];
function makeCoordinator(options) {
  return new DesktopCoordinator(() => ({
    windows: async () => windows,
    bind: async selector => selector,
    close: async () => {},
  }), options);
}
function gate() { let release; const promise=new Promise(r=>{ release=r; }); return { promise, release }; }

test('different window reads overlap but the same window remains serialized', async () => {
  const c=makeCoordinator(); const first=gate(); const started=gate(); const events=[];
  const a=c.run({id:1},{},async()=>{events.push('a');started.release();await first.promise;events.push('a-end');});
  await started.promise;
  const b=c.run({id:1},{},async()=>events.push('b'));
  const other=c.run({id:2},{},async()=>events.push('other'));
  await other;
  assert.deepEqual(events,['a','other']);
  first.release(); await Promise.all([a,b]);
  assert.deepEqual(events,['a','other','a-end','b']);
  await c.close();
});

test('focus operations serialize across windows and reads can progress', async () => {
  const c=makeCoordinator(); const first=gate(); const started=gate(); const events=[];
  const a=c.run({id:1},{focus:true},async()=>{events.push('a');started.release();await first.promise;});
  await started.promise;
  const b=c.run({id:2},{focus:true},async()=>events.push('b'));
  const cFocus=c.focusRun(async()=>events.push('c'));
  await c.controlRun(async()=>{});
  assert.deepEqual(events,['a']);
  first.release(); await Promise.all([a,b,cFocus]);
  assert.deepEqual(events,['a','c','b']);
  await c.close();
});

test('failed bridge stops queued actions without replay; a later request gets a fresh session', async () => {
  let created=0; const sessions=[];
  const c=new DesktopCoordinator(() => {
    const id=++created; sessions.push(id);
    return {windows:async()=>windows,bind:async()=>{},close:async()=>{}};
  });
  const blocked=gate(), started=gate(); let deliveries=0;
  const first=c.run({id:1},{focus:true},async()=>{
    deliveries++; started.release(); await blocked.promise;
    throw Object.assign(new Error('timeout'), {code:'BACKEND_TIMEOUT'});
  });
  await started.promise;
  const queued=c.run({id:1},{focus:true},async()=>{deliveries++;});
  await c.controlRun(async()=>{});
  blocked.release();
  await assert.rejects(first,{code:'BACKEND_TIMEOUT'});
  await assert.rejects(queued,{code:'BACKEND_CLOSED'});
  assert.equal(deliveries,1);
  await c.run({id:1},{},async()=>{});
  assert.equal(created,3);
  await c.close();
});

test('exact window identity skips enumeration and is checked by bind', async () => {
  const bound=[]; let enumerations=0;
  const c=new DesktopCoordinator(()=>({
    windows:async()=>{enumerations++; return windows;},
    bind:async selector=>{bound.push(selector);}, close:async()=>{},
  }));
  await c.run({id:1,processId:42,title:'expected'},{},async()=>{});
  assert.equal(enumerations,0);
  assert.deepEqual(bound,[{id:1,processId:42,title:'expected'}]);
  await c.run({id:2},{},async()=>{});
  assert.equal(enumerations,1);
  await c.close();
});
