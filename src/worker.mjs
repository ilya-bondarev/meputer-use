import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
export async function spawnWorker(id, root) {
  const child = spawn(process.execPath, [resolve(import.meta.dirname, 'job-cli.mjs'), 'work', id, root], { detached: true, windowsHide: true, stdio: 'ignore', shell: false });
  await new Promise((resolveSpawn, reject) => { child.once('spawn', resolveSpawn); child.once('error', reject); });
  child.unref(); return child.pid;
}
