// Distribution checks: inspect filenames and public documentation, never print matches.
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const listed=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',windowsHide:true});
if(listed.status!==0)throw Error('Public checks require a Git checkout.');
const files=listed.stdout.split('\0').filter(Boolean);
if(!files.length)throw Error('Stage the candidate source before running public checks.');
for(const name of files) {
  if(/^(?:local|reports|bin|node_modules|dist)\//i.test(name)||/(?:^|\/)(?:\.env(?:\..*)?|key\.txt|credentials\.json)$|\.(?:session|pem|p12|pfx|sqlite(?:-wal|-shm)?|zip|exe)$/i.test(name))throw Error('Runtime or sensitive file must not be tracked: '+name);
  if(!name.endsWith('.md'))continue;
  const text=readFileSync(resolve(root,name),'utf8');
  if(/\p{Script=Cyrillic}/u.test(text))throw Error('Public documentation must be English: '+name);
  if(/[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\s\\/]+/i.test(text))throw Error('Personal home path in public documentation: '+name);
  for(const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
    const target=match[1];if(/^[a-z]+:|^#/i.test(target))continue;
    if(!existsSync(resolve(dirname(resolve(root,name)),decodeURIComponent(target.split('#')[0]))))throw Error('Broken local link in '+name);
  }
}
const manifest=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
const lock=JSON.parse(readFileSync(resolve(root,'package-lock.json'),'utf8'));
if(manifest.license!=='MIT-0'||lock.packages[''].license!==manifest.license||lock.version!==manifest.version)throw Error('Release metadata and lockfile disagree.');
if(!/^MIT No Attribution\r?\n/.test(readFileSync(resolve(root,'LICENSE'),'utf8')))throw Error('Expected the MIT-0 license.');
console.log('Public source checks passed: files, English documentation, links and license metadata.');
