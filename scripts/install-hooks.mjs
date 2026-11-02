import { spawnSync } from 'node:child_process';
const result=spawnSync('git',['config','--local','core.hooksPath','.githooks'],{cwd:new URL('..',import.meta.url),encoding:'utf8',windowsHide:true});
if(result.status!==0)throw new Error(result.stderr);
console.log('Repository-local verification hook enabled.');
