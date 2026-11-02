import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
import {platformNames} from '../src/connectors.mjs';
const root=resolve(import.meta.dirname,'..');
const fail=message=>{throw new Error(message);};
const modules=readdirSync(resolve(root,'src'),{recursive:true}).filter(p=>p.endsWith('.mjs'));
for(const name of modules) {
  const file=resolve(root,'src',name),source=readFileSync(file,'utf8');
  const parts=name.split(sep),owner=parts[0]==='services'?parts[1]:null;
  if(owner&&!existsSync(resolve(root,'src/services',owner,'RULES.md')))fail(name+': missing RULES');
  for(const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)) {
    const dependency=match[1];
    if(owner&&/^node:(fs|http|https|net|child_process|sqlite|readline)/.test(dependency))fail(name+': domain imports IO');
    if(!dependency.startsWith('.'))continue;
    const target=relative(resolve(root,'src'),resolve(dirname(file),dependency)).split(sep);
    const legacyRecipe=name==='recipes.mjs'&&target.join('/')==='services/x/bookmarks.mjs';
    if(target[0]==='services'&&target[1]!==owner&&target.at(-1)!=='index.mjs'&&!legacyRecipe)fail(name+': use public domain entry');
    if(owner&&target[0]!=='services'&&!['errors.mjs','contracts.mjs'].includes(target[0]))fail(name+': outer-layer import');
    if(parts[0]==='adapters'&&target[0]==='services')fail(name+': adapter imports domain');
  }
  const nativeConnector=owner&&name!==['services','x','bookmarks.mjs'].join(sep)||['connectors.mjs','ui.mjs'].includes(name);
  if(nativeConnector&&/\bfetch\s*\(|querySelector|FirefoxClient|XMLHttpRequest|api\.x\.com|api\.telegram\.org|mtproto/i.test(source))fail(name+': remote API/DOM path in UI connector');
}
const mcp=readFileSync(resolve(root,'src/mcp.mjs'),'utf8');
if(/FirefoxClient|name:\s*'firefox_page'|from ['"].*firefox\.mjs/.test(mcp))fail('Remote browser driver exposed by MCP');
for(const domain of platformNames) {
  const {catalog}=await import('../src/services/'+domain+'/index.mjs');
  const names=catalog().operations.map(o=>o.name);
  if(new Set(names).size!==names.length)fail(domain+': duplicated operation name');
}
console.log('Architecture gates passed: '+modules.length+' modules.');
