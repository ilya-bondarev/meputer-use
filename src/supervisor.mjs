import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { JobStore } from './jobs.mjs';
import { spawnWorker } from './worker.mjs';
import { setPriority, constants } from 'node:os';
try {setPriority(0,constants.priority.PRIORITY_BELOW_NORMAL);}catch{}

const root = process.argv[2]; const store = new JobStore(root);
const terminal = new Set(['completed','cancelled','failed','needs_decision','paused']);
const live = pid => { if (!pid) return false; try { process.kill(pid,0); return true; } catch { return false; } };
await mkdir(resolve(store.root,'__supervisor'),{recursive:true});
let release;
try { release = await store.lock('__supervisor'); } catch (e) { if(e.code==='JOB_ALREADY_RUNNING') process.exit(0); throw e; }
const controller = new AbortController();
for (const event of ['SIGINT','SIGTERM']) process.on(event,()=>controller.abort());
try {
  while (!controller.signal.aborted) {
    for (const state of await store.list()) {
      if (terminal.has(state.status) || live(state.workerPid)) continue;
      await spawnWorker(state.id,store.root);
    }
    await writeFile(resolve(store.root,'__supervisor','heartbeat.json'),JSON.stringify({pid:process.pid,at:new Date().toISOString()}));
    await delay(5000,undefined,{signal:controller.signal});
  }
} catch (e) { if(e.name!=='AbortError') throw e; }
finally { await release(); }
