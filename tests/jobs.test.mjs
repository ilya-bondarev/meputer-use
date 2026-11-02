import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname, basename} from 'node:path';
import {JobStore, JobRunner} from '../src/jobs.mjs';
import {createConnectorJournal} from '../src/connector-journal.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'meputer-use-jobs-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert(basename(root).startsWith('meputer-use-jobs-'));
    await rm(root, {recursive:true, force:true});
  });
  const store = new JobStore(root);
  const runner = () => new JobRunner({store, stopFile:join(root, 'STOP'),
    sessionFactory:() => { throw Error('A file wait must not start Windows'); }});
  return {root, store, runner};
}
const graph = nodes => ({version:1, goal:'Controlled recovery case', allowedProcesses:[], nodes});

test('a real worker process exits during a long sleep and another continues it', async t => {
  const {store} = await fixture(t);
  const created = await store.create(graph([{id:'pause',type:'sleep',durationMs:300000}, {id:'done',type:'finish'}]));
  const work = () => promisify(execFile)(process.execPath,
    [resolve(import.meta.dirname,'../src/job-cli.mjs'),'work-slice',created.id,store.root],
    {windowsHide:true,timeout:15000});
  await work();
  const waiting = await store.read(created.id);
  assert.equal(waiting.status,'waiting');
  assert.equal(waiting.workerPid,undefined);
  // Model time passing between independent processes without a five-minute test.
  waiting.wakeAt = Date.now() - 1;
  await store.save(waiting);
  await work();
  assert.equal((await store.read(created.id)).status,'completed');
});

test('a saved long wait releases ownership and resumes at its original wake-up', async t => {
  const {store, runner} = await fixture(t);
  t.mock.timers.enable({apis:['Date'], now:Date.now()});
  const created = await store.create(graph([{id:'pause', type:'sleep', durationMs:300000}, {id:'done', type:'finish'}]));
  await runner().run(created.id, {yieldOnWait:true});
  const waiting = await store.read(created.id);
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.workerPid, undefined, 'Returning to a live caller must release worker ownership');
  t.mock.timers.tick(300001);
  const resumed = await runner().run(created.id, {yieldOnWait:true});
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.history.filter(entry => entry.node === 'pause').length, 1);
});

test('a wait timeout is processed even when its polling interval is longer', async t => {
  const {root, store, runner} = await fixture(t);
  t.mock.timers.enable({apis:['Date'], now:Date.now()});
  const created = await store.create(graph([{id:'receipt', type:'wait', when:{file:join(root,'missing')},
    timeoutMs:5000, pollMs:60000}, {id:'done',type:'finish'}]));
  await runner().run(created.id, {sliceMs:0, yieldOnWait:true});
  t.mock.timers.tick(5001);
  const result = await runner().run(created.id, {signal:AbortSignal.timeout(2000), yieldOnWait:true});
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'CONDITION_TIMEOUT');
});

test('STOP preserves a wait and cancellation survives a fresh runner', async t => {
  const {root, store, runner} = await fixture(t);
  const created = await store.create(graph([{id:'pause',type:'sleep',durationMs:300000}]));
  await runner().run(created.id, {yieldOnWait:true});
  const wakeAt = (await store.read(created.id)).wakeAt;
  await writeFile(join(root,'STOP'), '');
  assert.equal((await runner().run(created.id, {yieldOnWait:true})).status, 'paused');
  assert.equal((await store.read(created.id)).wakeAt, wakeAt);
  await store.cancel(created.id);
  assert.equal((await runner().run(created.id, {yieldOnWait:true})).status, 'cancelled');
});

test('an uncertain mutation is reconciled after restart without a second delivery', async t => {
  const {root, store} = await fixture(t);
  const receipt = join(root, 'delivered');
  const created = await store.create(graph([{id:'send',type:'desktop',window:{id:1},operation:'click',
    parameters:{x:1,y:1},expect:{file:receipt}}]));
  const inFlight = await store.read(created.id);
  inFlight.inFlight = {node:'send',at:new Date().toISOString()};
  await store.save(inFlight);
  let deliveries = 0;
  const runner = () => new JobRunner({store, stopFile:join(root,'STOP'), sessionFactory:() => {
    deliveries++; throw Error('Reconciliation must not dispatch another action');
  }});
  const unresolved = await runner().run(created.id);
  assert.equal(unresolved.status, 'needs_decision');
  await writeFile(receipt, 'observed effect');
  await store.resume(created.id);
  assert.equal((await runner().run(created.id)).status, 'completed');
  assert.equal(deliveries, 0);
});

test('corrupt checkpoints stay visible without hiding healthy jobs', async t => {
  const {root, store} = await fixture(t);
  const good = await store.create(graph([{id:'done',type:'finish'}]));
  await mkdir(join(root,'broken'));
  await writeFile(join(root,'broken','state.json'), '{broken');
  const scan = await store.scan();
  assert.deepEqual(scan.jobs.map(job => job.id), [good.id]);
  assert.deepEqual(scan.issues, [{id:'broken',code:'INVALID_CHECKPOINT'}]);
  await assert.rejects(store.list(), {code:'JOB_STORE_UNREADABLE'});
});

test('throwing connector cleanup cannot retain the job lock', async t => {
  const {root, store} = await fixture(t);
  const created = await store.create(graph([{id:'read',type:'connector',call:{platform:'x',name:'ui.read'}}]));
  const runner = new JobRunner({store,stopFile:join(root,'STOP'), connectorFactory:() => ({
    describe:() => ({operation:{readOnly:true,durable:true}}),
    invoke:async () => ({output:{taskStatus:'observed'}}),
    close:async () => { throw Error('cleanup failed'); },
  })});
  await assert.rejects(runner.run(created.id), /cleanup failed/);
  const release = await store.lock(created.id);
  await release();
  assert.equal((await store.read(created.id)).status, 'completed');
});

test('reopened receipts replay completed results and block uncertain delivery', async t => {
  const {root} = await fixture(t);
  let deliveries = 0;
  const request = {platform:'x',name:'ui.plan',args:{}};
  let journal = createConnectorJournal(join(root,'receipts'));
  t.after(() => journal.close());
  await journal.execute('completed',request,async () => { deliveries++; return {taskStatus:'verified'}; });
  await assert.rejects(journal.execute('uncertain',request,async () => { deliveries++; throw Error('ack lost'); }), /ack lost/);
  journal.close();
  journal = createConnectorJournal(join(root,'receipts'));
  const repeated = await journal.execute('completed',request,async () => { deliveries++; });
  assert.equal(repeated.replayed, true);
  await assert.rejects(journal.execute('uncertain',request,async () => { deliveries++; }), {code:'REQUEST_UNCERTAIN'});
  assert.equal(deliveries, 2);
  journal.close();
});
