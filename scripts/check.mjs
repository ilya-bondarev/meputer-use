import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let count = 0;
for (const directory of ['src', 'scripts','routines']) {
  for (const name of readdirSync(join(root, directory),{recursive:true}).filter(n => n.endsWith('.mjs'))) {
    const result = spawnSync(process.execPath, ['--check', join(root, directory, name)], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr);
    count++;
  }
}
console.log(`Syntax checked: ${count} files.`);
