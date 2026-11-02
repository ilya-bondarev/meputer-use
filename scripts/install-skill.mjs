import {mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {constants} from 'node:fs';
import manifest from '../package.json' with {type:'json'};
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--force'))throw new Error('Usage: node scripts/install-skill.mjs [--force]');
const source=resolve(import.meta.dirname,'../skills',manifest.name,'SKILL.md');
const target=resolve(process.env.CODEX_HOME||join(homedir(),'.codex'),'skills',manifest.name);
await mkdir(target,{recursive:true});
try {await copyFile(source,join(target,'SKILL.md'),args.includes('--force')?0:constants.COPYFILE_EXCL);}
catch(error) {if(error.code==='EEXIST')throw new Error('Existing skill preserved. Use --force only to replace it deliberately.');throw error;}
console.log('Installed '+manifest.name+' skill from repository source.');
