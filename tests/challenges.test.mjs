import test from 'node:test';
import assert from 'node:assert/strict';
import {WindowsExecutor} from '../src/executor.mjs';
import {runSimpleChallenge} from '../src/runtime/simple-challenge.mjs';
import {createConnectorJournal} from '../src/persistence/connector-journal.mjs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname, basename} from 'node:path';

// A tiny UI provider, not a second executor: production selectors, plan validation,
// input guards, action sequencing and postcondition evaluation all run unchanged.
async function form({autoSubmit=false, reject=false, rejectFirst=false, reloadFails=false,
  noRejectionSignal=false, truncated=false, completed=false, mode='execute'}={}) {
  const window = {id:1,processId:2,processName:'fixture'};
  let value = '', passed = completed, tick = 1, leases = 0;
  let generation = 1, rejected = false, selected = false;
  const actions = [];
  const element = (id, role, extra={}) => ({ref:id,automationId:id,role,name:id,
    enabled:true,offscreen:false,password:false,actions:[],...extra});
  const backend = {
    mode, windows:async () => [window],
    snapshot:async () => ({window,lastInputTick:tick,truncated,inputChangedDuringRead:false,
      elements:passed ? [element('results','Text')] : [element('challenge','Text'),
        element('checkbox','CheckBox',{actions:['toggle']}),
        element('answer','Edit',{value,actions:['set_value']}),
        element('submit','Button',{actions:['invoke']}),
        element('tile','CheckBox',{toggleState:selected?'On':'Off',actions:['toggle']}),
        element('generation'+generation,'Text'),
        element('reload','Button',{actions:['invoke']}),
        ...(rejected&&!noRejectionSignal?[element('rejected','Text')]:[])]}),
    act:async (_window, target, operation, answer) => {
      actions.push(operation);
      if(target.automationId==='reload') {
        if(!reloadFails){generation++;rejected=false;value='';selected=false;}
      } else if(target.automationId==='tile') selected=!selected;
      else if(operation==='set_value') {value=answer;if(autoSubmit&&!reject)passed=true;}
      else if(reject||rejectFirst&&generation===1)rejected=true;
      else passed=true;
      return {lastInputTick:++tick};
    },
  };
  const executor = new WindowsExecutor({backend,mode,allowedProcesses:mode==='execute'?['fixture']:[]});
  await executor.bind({id:1});
  const session = {mode,window,observe:(...args)=>executor.observe(...args),runPlan:(...args) => executor.run(...args),
    withInputLease:async fn => {leases++;try{return await fn();}finally{leases--;}}};
  const base = {present:{selector:{automationId:'challenge'},exists:true},
    passed:{selector:{automationId:'results'},exists:true},timeoutMs:0};
  return {session, actions, leases:() => leases, changeChallenge:()=>{generation++;},
    reload:{target:{automationId:'reload'},rejected:{selector:{automationId:'rejected'},exists:true},
      refreshed:{selector:{automationId:'generation2'},exists:true}},
    image:{...base,kind:'image',selections:[{target:{automationId:'tile'},operation:'toggle',
      expect:{selector:{automationId:'tile'},toggleState:'On'}}],submit:{automationId:'submit'}},
    checkbox:{...base,kind:'checkbox',target:{automationId:'checkbox'},checkboxOperation:'toggle'},
    text:{...base,kind:'text',target:{automationId:'answer'},answer:'AB7K',submit:{automationId:'submit'}}};
}

test('checkbox continuation requires verified next UI, not a delivered click', async () => {
  for(const reject of [false,true]) {
    const f = await form({reject});
    const result = await runSimpleChallenge(f.session,f.checkbox);
    assert.equal(result.continueTask,!reject);
    assert.equal(result.retryAllowed,false);
    assert.deepEqual(f.actions,['toggle']);
    assert.equal(f.leases(),0);
  }
});

async function journalFixture(t) {
  const parent=resolve(tmpdir());
  const root=await mkdtemp(join(parent,'meputer-challenge-'));
  let journal=createConnectorJournal(root);
  t.after(async()=>{
    journal.close();
    assert.equal(dirname(resolve(root)),parent);
    assert.ok(basename(root).startsWith('meputer-challenge-'));
    await rm(root,{recursive:true,force:true});
  });
  return {get journal(){return journal;},reopen(){journal.close();journal=createConnectorJournal(root);}};
}

test('image selections verify each selected tile and the final next page',async()=>{
  const f=await form();
  assert.equal((await runSimpleChallenge(f.session,f.image)).continueTask,true);
  assert.deepEqual(f.actions,['toggle','invoke']);
  const textImage=await form();
  assert.equal((await runSimpleChallenge(textImage.session,{...textImage.text,kind:'image'})).continueTask,true);
});

test('a verified reload permits one fresh answer across reopened receipts, never a third delivery',async t=>{
  const store=await journalFixture(t);
  const f=await form({rejectFirst:true});
  const first=await runSimpleChallenge(f.session,{...f.text,reload:f.reload},{journal:store.journal});
  assert.equal(first.taskStatus,'needs_observation');
  assert.equal(first.continueTask,false);
  assert.equal(first.retryAllowed,true);
  assert.deepEqual(f.actions,['set_value','invoke','invoke']);
  store.reopen();
  const request={...f.text,answer:'NEW',retryToken:first.retryToken};
  const second=await runSimpleChallenge(f.session,request,{journal:store.journal});
  assert.equal(second.attempt,2);
  assert.equal(second.continueTask,true);
  assert.equal(second.retryAllowed,false);
  assert.deepEqual(f.actions,['set_value','invoke','invoke','set_value','invoke']);
  const count=f.actions.length;
  const repeated=await runSimpleChallenge(f.session,request,{journal:store.journal});
  assert.equal(repeated.reason,'CHALLENGE_RETRY_ALREADY_USED');
  assert.equal(repeated.continueTask,false);
  assert.equal(f.actions.length,count);
});

test('an unknown rejection or unverified reload cannot authorize another answer',async t=>{
  const store=await journalFixture(t);
  for(const options of [{reject:true,noRejectionSignal:true},{reject:true,reloadFails:true}]) {
    const f=await form(options);
    const result=await runSimpleChallenge(f.session,{...f.text,reload:f.reload},{journal:store.journal});
    assert.equal(result.retryAllowed,false);
    assert.equal(result.retryToken,undefined);
    assert.equal(result.continueTask,false);
    assert.equal(f.actions.length,options.reloadFails?3:2);
  }
});

test('retry tickets reject other windows, expire, and stop on changed challenge content',async t=>{
  const store=await journalFixture(t);
  const f=await form({rejectFirst:true});
  const first=await runSimpleChallenge(f.session,{...f.text,reload:f.reload},{journal:store.journal,now:()=>1000});
  const request={...f.text,answer:'NEW',retryToken:first.retryToken};
  const options={journal:store.journal,now:()=>2000};
  f.session.window={...f.session.window,id:99};
  await assert.rejects(runSimpleChallenge(f.session,request,options),{code:'CHALLENGE_RETRY_CONTEXT_CHANGED'});
  f.session.window={...f.session.window,id:1};
  await assert.rejects(runSimpleChallenge(f.session,request,{...options,now:()=>first.expiresAt}),{code:'CHALLENGE_RETRY_EXPIRED'});
  const count=f.actions.length;
  f.changeChallenge();
  assert.equal((await runSimpleChallenge(f.session,request,options)).continueTask,false);
  assert.equal(f.actions.length,count);
});

test('an uncertain second attempt stays consumed after reopening the journal',async t=>{
  const store=await journalFixture(t);
  const f=await form({reject:true});
  const first=await runSimpleChallenge(f.session,{...f.checkbox,reload:f.reload},{journal:store.journal});
  const request={...f.checkbox,retryToken:first.retryToken};
  const second=await runSimpleChallenge(f.session,request,{journal:store.journal});
  assert.equal(second.continueTask,false);
  assert.equal(second.retryAllowed,false);
  const count=f.actions.length;
  store.reopen();
  assert.equal((await runSimpleChallenge(f.session,request,{journal:store.journal})).reason,'CHALLENGE_RETRY_ALREADY_USED');
  assert.equal(f.actions.length,count);
});

test('text is submitted once; automatic completion skips the submit control', async () => {
  for(const autoSubmit of [false,true]) {
    const f = await form({autoSubmit});
    const result = await runSimpleChallenge(f.session,f.text);
    assert.equal(result.continueTask,true);
    assert.deepEqual(f.actions,autoSubmit?['set_value']:['set_value','invoke']);
  }
});

test('an already-passed challenge does not type into the next page', async () => {
  const f = await form({completed:true});
  assert.equal((await runSimpleChallenge(f.session,f.text)).continueTask,true);
  assert.deepEqual(f.actions,[]);
});

test('partial observations and read-only sessions cannot deliver challenge input', async () => {
  const partial = await form({truncated:true});
  assert.equal((await runSimpleChallenge(partial.session,partial.text)).continueTask,false);
  assert.deepEqual(partial.actions,[]);
  const readonly = await form({mode:'read-only'});
  await assert.rejects(runSimpleChallenge(readonly.session,readonly.checkbox),{code:'READ_ONLY'});
  assert.deepEqual(readonly.actions,[]);
});
