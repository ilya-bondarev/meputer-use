// Protect existing user skill contents while testing only an isolated home directory.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'executor-install-'));
const root=resolve(import.meta.dirname,'..');
const run=args=>spawnSync(process.execPath,[join(root,'scripts/install-skill.mjs'),...args],{cwd:root,env:{...process.env,CODEX_HOME:directory},encoding:'utf8',windowsHide:true});
try {
  assert.equal(run([]).status,0);
  const target=join(directory,'skills/windows-executor-ui/SKILL.md');
  await writeFile(target,'Existing user skill');
  assert.notEqual(run([]).status,0);
  assert.equal(await readFile(target,'utf8'),'Existing user skill');
  assert.equal(run(['--force']).status,0);
  assert.equal(await readFile(target,'utf8'),await readFile(join(root,'skills/windows-executor-ui/SKILL.md'),'utf8'));
  console.log('Installation check passed: existing skill is preserved unless replacement is explicit.');
} finally {
  assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  assert(basename(directory).startsWith('executor-install-'));
  await rm(directory,{recursive:true,force:true});
}
