import { open, readFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { requireThat, ExecutorError } from '../errors.mjs';
import { writeJsonAtomic as atomic, lockFile } from './files.mjs';
import { validateJob } from '../job-validation.mjs';
import { jobDigest as digest, canResume, validateCheckpoint } from '../services/jobs/index.mjs';
import { createConnectorJournal } from './connector-journal.mjs';

export const defaultJobRoot = resolve(import.meta.dirname, '../../local/jobs');
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
  async definition(id) { return validateJob(JSON.parse(await readFile(this.path(id, 'job.json'), 'utf8'))); }
  async read(id) { return validateCheckpoint(JSON.parse(await readFile(this.path(id), 'utf8')), id); }
  async save(state) { validateCheckpoint(state, state.id); state.updatedAt = new Date().toISOString(); await atomic(this.path(state.id), state); }
  cancellationPath(id) { return this.path(id, 'CANCEL'); }
  cancelRequested(id) { return existsSync(this.cancellationPath(id)); }
  receiptJournal() { return createConnectorJournal(join(this.root, '__connector-requests')); }
  async scan() {
    await mkdir(this.root, { recursive: true });
    const jobs = [], issues = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('__')) continue;
      const id = entry.name;
      try {
        const s = await this.read(id);
        jobs.push({ id, goal: s.goal, status: s.status, node: s.node, wakeAt: s.wakeAt,
          workerPid: s.workerPid, inFlight: !!s.inFlight, createdAt: s.createdAt, updatedAt: s.updatedAt });
      } catch (error) {
        // Report the identifier and code, never parse errors containing user data.
        issues.push({ id, code: error.code || 'INVALID_CHECKPOINT' });
      }
    }
    return { jobs, issues };
  }
  async list() {
    const { jobs, issues } = await this.scan();
    if (issues.length) {
      const error = new ExecutorError('JOB_STORE_UNREADABLE', 'One or more job checkpoints could not be read. Use scan for identifiers and error codes.');
      error.issues = issues;
      throw error;
    }
    return jobs;
  }
  async lockSupervisor() {
    await mkdir(join(this.root, '__supervisor'), { recursive: true });
    return this.lock('__supervisor');
  }
  async heartbeat(value) {
    await atomic(this.path('__supervisor', 'heartbeat.json'), value);
  }
  async cancel(id) { const f = await open(this.path(id, 'CANCEL'), 'a'); await f.close(); return { id, cancelRequested: true }; }
  async resume(id) {
    const release = await this.lock(id);
    try {
      const state = await this.read(id);
      requireThat(canResume(state.status), 'JOB_TERMINAL');
      // Keep inFlight. Resume performs reconciliation, never erases uncertainty.
      state.status = 'queued'; delete state.reason; await this.save(state); return state;
    } finally { await release(); }
  }
  async lock(id) {
    return lockFile(this.path(id, 'worker.lock'), 'JOB_ALREADY_RUNNING');
  }
}
