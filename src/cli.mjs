import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setPriority, constants } from 'node:os';
import { NativeBackend, WindowsExecutor, benchmarkRead, ExecutorError } from './index.mjs';

const argv = process.argv.slice(2);
const command = argv.shift();
const flags = {};
const booleans = new Set(['execute', 'values']);
const known = new Set(['window', 'plan', 'allow-process', 'scope-id', 'samples', 'out', 'stop-file', ...booleans]);
function emit(value) { console.log(JSON.stringify(value, null, 2)); }
let backend;
try {
  try { setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL); } catch { }
  while (argv.length) {
    const key = argv.shift().replace(/^--/, '');
    if (!known.has(key) || key in flags) throw new ExecutorError('INVALID_ARGUMENT', key);
    if (booleans.has(key)) flags[key] = true;
    else { if (!argv.length || argv[0].startsWith('--')) throw new ExecutorError('INVALID_ARGUMENT', key); flags[key] = argv.shift(); }
  }
  if (!['windows', 'read', 'preview', 'run', 'bench', 'selftest'].includes(command)) {
    throw new ExecutorError('USAGE', 'windows | selftest | read/bench --window ID [--scope-id ID] | preview/run --window ID --plan FILE. Input is enabled only with run --execute --allow-process NAME.');
  }
  if (flags.execute && command !== 'run') throw new ExecutorError('INVALID_ARGUMENT', '--execute is only supported for run');
  const mode = flags.execute ? 'execute' : 'read-only';
  const allowedProcesses = flags['allow-process']?.split(',').map(x => x.trim()).filter(Boolean) || [];
  if (mode === 'execute' && !allowedProcesses.length) throw new ExecutorError('PROCESS_ALLOWLIST_REQUIRED');
  const stopFile = resolve(flags['stop-file'] || 'local/STOP');
  backend = new NativeBackend({ mode, stopFile });
  const hello = await backend.hello();
  if (command === 'selftest') { emit(hello); }
  else {
    const executor = new WindowsExecutor({ backend, mode, allowedProcesses, stopFile });
    if (command === 'windows') emit(await executor.windows());
    else {
      const id = Number(flags.window);
      if (!Number.isSafeInteger(id) || id <= 0) throw new ExecutorError('WINDOW_REQUIRED');
      await executor.bind({ id });
      const observe = { includeValues: !!flags.values, ...(flags['scope-id'] ? { scope: { automationId: flags['scope-id'] } } : {}) };
      if (command === 'read') emit(await executor.observe(observe));
      else if (command === 'bench') {
        const report = { at: new Date().toISOString(), runtime: { node: process.version, architecture: process.arch },
          startup: hello, ...(await benchmarkRead(executor, { samples: flags.samples ? Number(flags.samples) : 3, observe })) };
        report.nativeAfter = await backend.hello();
        report.nodeRssBytes = process.memoryUsage().rss;
        if (flags.out) { const path = resolve(flags.out); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
        emit(report);
      } else {
        if (!flags.plan) throw new ExecutorError('PLAN_REQUIRED');
        const plan = JSON.parse(await readFile(resolve(flags.plan), 'utf8'));
        const result = command === 'preview' ? await executor.preview(plan) : await executor.run(plan);
        emit({ ...result, metrics: executor.stats() });
        if (!['preview', 'completed'].includes(result.status)) process.exitCode = 2;
      }
    }
  }
} catch (error) {
  emit({ status: 'error', reason: error.code || 'ERROR', message: error.code ? error.message : 'Check the JSON input and command arguments.' });
  process.exitCode = 1;
} finally { await backend?.close(); }
