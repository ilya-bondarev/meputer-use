// Opt-in observation benchmark. It never activates, resizes, or types into windows.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { StdioMcpClient } from '../src/adapters/mcp-client.mjs';

const args = process.argv.slice(2);
if (!args.includes('--live')) throw Error('Pass --live and at least two --window=HWND:PID arguments.');
if (args.some(arg => !/^(--live|--window=\d+:\d+|--rounds=\d+|--out=.+)$/.test(arg))) throw Error('Unknown benchmark argument.');
const windows = args.filter(arg => arg.startsWith('--window=')).map(arg => {
  const [id, processId] = arg.slice(9).split(':').map(Number);
  if (![id, processId].every(value => Number.isSafeInteger(value) && value > 0)) throw Error('Invalid HWND:PID.');
  return { id, processId };
});
if (windows.length < 2 || windows.length > 8 || new Set(windows.map(w => `${w.id}:${w.processId}`)).size !== windows.length) {
  throw Error('Use two to eight distinct windows.');
}
const rounds = Number(args.find(arg => arg.startsWith('--rounds='))?.slice(9) ?? 5);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw Error('Rounds must be 1..20.');
const root = resolve(import.meta.dirname, '..');
const output = resolve(args.find(arg => arg.startsWith('--out='))?.slice(6) ?? resolve(root, 'reports/window-observations.json'));
const client = new StdioMcpClient({ command: process.execPath, args: ['src/mcp.mjs'], cwd: root });
async function observe(window) {
  const result = await client.callTool('desktop_observe', { window, kind: 'visible' });
  if (result.isError) {
    const detail = JSON.parse(result.content.find(item => item.type === 'text').text);
    throw Error(detail.reason);
  }
  if (!result.content.some(item => item.type === 'image')) throw Error('Missing screenshot.');
}
async function batch(parallel) {
  const start = performance.now();
  if (parallel) {
    const results = await Promise.allSettled(windows.map(observe));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  } else {
    for (const window of windows) await observe(window);
  }
  return Math.round((performance.now() - start) * 100) / 100;
}
try {
  await client.start();
  const coldMs = await batch(true);
  const sequentialMs = [], parallelMs = [];
  // Alternate order so warming or changing desktop load does not favor one mode.
  for (let round = 0; round < rounds; round++) {
    for (const parallel of round % 2 ? [true, false] : [false, true]) {
      (parallel ? parallelMs : sequentialMs).push(await batch(parallel));
    }
  }
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const report = {
    at: new Date().toISOString(), kind: 'MCP visible captures; no input or model reasoning',
    windows: windows.length, rounds, coldMs, sequentialMs, parallelMs,
    sequentialMedianMs: median(sequentialMs), parallelMedianMs: median(parallelMs),
    speedup: median(sequentialMs) / median(parallelMs),
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await client.close(); }
