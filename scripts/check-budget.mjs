// The one targeted regression check: uncertain paid requests cannot reset spend.
// No real key, network, browser or GUI. Runs in a temporary directory.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createDecisionClient} from '../src/decisions.mjs';
const directory=await mkdtemp(join(tmpdir(),'executor-budget-'));
const originalFetch=globalThis.fetch;let deliveries=0;
try{
  const keyFile=join(directory,'key.txt');await writeFile(keyFile,'sk-fake-budget-check');
  const options={keyFile,ledgerFile:join(directory,'spend.json'),budgetUsd:0.02};
  const request={input:'Choose',questions:[{type:'choice',name:'target',choices:[{value:'a',description:'Observed control'}]}]};
  globalThis.fetch=async()=>{deliveries++;throw Error('connection lost after delivery');};
  await assert.rejects(createDecisionClient(options).request(request),/connection lost/);
  await assert.rejects(createDecisionClient(options).request(request),error=>error.code==='DECISION_BUDGET_EXHAUSTED');
  assert.equal(deliveries,1,'A new client must retain the uncertain request reservation');
  assert.throws(()=>createDecisionClient({...options,budgetUsd:5.01}),error=>error.code==='INVALID_DECISION_CONFIG');
  console.log('Budget gate passed: uncertain delivery retained across clients; no network retries.');
}finally{
  globalThis.fetch=originalFetch;
  assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('executor-budget-'));
  await rm(directory,{recursive:true,force:true});
}
