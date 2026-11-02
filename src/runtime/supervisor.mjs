import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { JobStore } from '../persistence/jobs.mjs';
import { spawnWorker } from '../worker.mjs';
import { isProcessAlive as isAlive } from '../adapters/process-liveness.mjs';
import { readyToDispatch, requiresIntervention, dispatchOrder, supervisorPollMs } from '../services/jobs/index.mjs';

export async function runSupervisor({ store = new JobStore(), signal,
  stopFile = resolve(import.meta.dirname, '../../local/STOP') } = {}) {
  let release;
  try { release = await store.lockSupervisor(); }
  catch (error) { if (error.code === 'JOB_ALREADY_RUNNING') return; throw error; }
  let activePid;
  try {
    while (!signal?.aborted) {
      const { jobs, issues } = await store.scan();
      if (activePid && !isAlive(activePid)) activePid = undefined;
      // Include workers launched by older entry points or a previous supervisor.
      // The job lock remains authoritative; a PID is only a dispatch hint.
      const externalWorker = jobs.some(state => !requiresIntervention(state.status) && isAlive(state.workerPid));
      if (!activePid && !externalWorker) {
        const now = Date.now();
        const candidate = jobs.sort(dispatchOrder).find(state => {
          const cancelled = store.cancelRequested(state.id);
          return readyToDispatch(state, now, cancelled) && (cancelled || !existsSync(stopFile));
        });
        if (candidate) activePid = await spawnWorker(candidate.id, store.root, { supervised: true });
      }
      await store.heartbeat({ pid: process.pid, at: new Date().toISOString(), activePid, issues });
      await delay(supervisorPollMs, undefined, { signal });
    }
  } catch (error) { if (error.name !== 'AbortError') throw error; }
  finally { await release(); }
}
