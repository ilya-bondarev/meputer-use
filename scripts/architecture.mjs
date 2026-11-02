import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
import {platformNames} from '../src/connector-registry.mjs';
const root=resolve(import.meta.dirname,'..');
const fail=message=>{throw new Error(message);};
const modules=readdirSync(resolve(root,'src'),{recursive:true}).filter(p=>p.endsWith('.mjs'));
const edges=new Map();
const domainBuiltins=new Set(['node:path','node:crypto','node:util']);
for(const name of modules) {
  const file=resolve(root,'src',name),source=readFileSync(file,'utf8');
  const parts=name.split(sep),owner=parts[0]==='services'?parts[1]:null;
  const legacyDomain=name===['services','x','bookmarks.mjs'].join(sep);
  const dependencies=[];edges.set(file,dependencies);
  if(owner&&!existsSync(resolve(root,'src/services',owner,'RULES.md')))fail(name+': missing RULES');
  for(const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g)) {
    const dependency=match[1];
    if(owner&&!dependency.startsWith('.')&&!domainBuiltins.has(dependency)&&!(legacyDomain&&dependency==='node:timers/promises'))fail(name+': unapproved domain dependency');
    if(!dependency.startsWith('.'))continue;
    const resolved=resolve(dirname(file),dependency);
    if(!existsSync(resolved))fail(name+': missing import '+dependency);
    dependencies.push(resolved);
    const target=relative(resolve(root,'src'),resolved).split(sep);
    const legacyRecipe=name==='recipes.mjs'&&target.join('/')==='services/x/bookmarks.mjs';
    if(target[0]==='services'&&target[1]!==owner&&target.at(-1)!=='index.mjs'&&!legacyRecipe)fail(name+': use public domain entry');
    if(owner&&target[0]!=='services'&&!['errors.mjs','contracts.mjs'].includes(target[0]))fail(name+': outer-layer import');
    if(parts[0]==='adapters'&&target[0]==='services')fail(name+': adapter imports domain');
    if(parts[0]==='persistence'&&['runtime','jobs.mjs','connectors.mjs','desktop.mjs','native.mjs','mcp.mjs'].includes(target[0]))fail(name+': persistence imports execution');
  }
  const nativeConnector=owner&&name!==['services','x','bookmarks.mjs'].join(sep)||['connectors.mjs','ui.mjs'].includes(name);
  if(nativeConnector&&/\bfetch\s*\(|querySelector|FirefoxClient|XMLHttpRequest|api\.x\.com|api\.telegram\.org|mtproto/i.test(source))fail(name+': remote API/DOM path in UI connector');
  if(owner&&!legacyDomain&&/\bprocess\s*\.|\bglobalThis\s*\.\s*fetch\b/.test(source))fail(name+': domain accesses process or network state');
}
const visiting=new Set(),visited=new Set();
function visit(file,path=[]) {
  if(visiting.has(file))fail('Import cycle: '+[...path,file].map(p=>relative(root,p)).join(' -> '));
  if(visited.has(file)||!edges.has(file))return;
  visiting.add(file);
  for(const dependency of edges.get(file))visit(dependency,[...path,file]);
  visiting.delete(file);visited.add(file);
}
for(const file of edges.keys())visit(file);
const mcp=readFileSync(resolve(root,'src/mcp.mjs'),'utf8');
if(/FirefoxClient|name:\s*'firefox_page'|from ['"].*firefox\.mjs/.test(mcp))fail('Remote browser driver exposed by MCP');
for(const domain of platformNames) {
  const {catalog}=await import('../src/services/'+domain+'/index.mjs');
  const names=catalog().operations.map(o=>o.name);
  if(new Set(names).size!==names.length)fail(domain+': duplicated operation name');
}
console.log('Architecture gates passed: '+modules.length+' modules.');
