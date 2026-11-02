import { readFile } from 'node:fs/promises';
import { JobStore, JobRunner, assertUiJob } from './jobs.mjs';
import { spawnWorker } from './worker.mjs';
import { setPriority, constants } from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {build as readPages} from '../routines/read-pages.mjs';
try {setPriority(0,constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
const [command, value, root] = process.argv.slice(2);
const store = new JobStore(root);
if (command) {
  try {
    let result;
    if (command === 'submit') { result = await store.create(assertUiJob(JSON.parse(await readFile(value, 'utf8')))); result.workerPid = await spawnWorker(result.id,store.root); }
    else if(command==='pages') {result=await store.create(assertUiJob(readPages(JSON.parse(await readFile(value,'utf8')))));result.workerPid=await spawnWorker(result.id,store.root);}
    else if(command==='wait') {
      const until=Date.now()+45000;
      do {
        const state=await store.read(value);
        result={id:state.id,status:state.status,node:state.node,reason:state.reason,wakeAt:state.wakeAt,transitions:state.transitions,outputs:state.outputs};
        if(['completed','cancelled','failed','needs_decision','paused'].includes(state.status))break;
        await delay(500);
      }while(Date.now()<until);
    }
    else if (command === 'work') result = await new JobRunner({ store }).run(value);
    else if (command === 'resume') { await store.resume(value); result = { id: value, workerPid: await spawnWorker(value,store.root) }; }
    else if (command === 'status') result = await store.read(value);
    else if (command === 'list') result = await store.list();
    else if (command === 'cancel') result = await store.cancel(value);
    else throw new Error('submit/pages FILE | wait/work/resume/status/cancel ID | list [unused] [ROOT]');
    console.log(JSON.stringify(result, null, 2));
  } catch (e) { console.error(JSON.stringify({ error: e.code || e.message })); process.exitCode = 1; }
}
