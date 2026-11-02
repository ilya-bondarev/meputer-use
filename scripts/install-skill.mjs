import {mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
const source=resolve(import.meta.dirname,'../skills/windows-executor-ui/SKILL.md');
const target=resolve(process.env.CODEX_HOME||join(homedir(),'.codex'),'skills/windows-executor-ui');
await mkdir(target,{recursive:true});await copyFile(source,join(target,'SKILL.md'));
console.log('Installed windows-executor-ui skill from repository source.');
