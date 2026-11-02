import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopSession } from '../src/desktop.mjs';

function sessionWithEvents() {
  const events=[];
  const backend={mode:'execute',
    request:async(method,parameters)=>{
      events.push({method,parameters});
      if(method==='sequence')return {performed:true};
      if(method==='frame')return {frameId:'new'};
      return {};
    },
    desktop:async(window,operation)=>{
      events.push({method:operation,window});
      return {lastInputTick:123};
    },
  };
  const session=new DesktopSession({mode:'execute',allowedProcesses:['*'],backend});
  session.window={id:1,processId:42};
  return {session,events};
}

test('activated keyboard batch holds one lease from activation through delivery', async()=>{
  const {session,events}=sessionWithEvents();
  const actions=[{operation:'key',keys:['CTRL','L']},{operation:'paste',text:'https://example.com'},{operation:'key',keys:['ENTER']}];
  const result=await session.batch(actions,{activate:true});
  assert.deepEqual(events.map(event=>event.method),['lease_acquire','activate','sequence','frame','lease_release']);
  assert.deepEqual(events[2].parameters,{windowId:1,processId:42,actions,expectedInputTick:123});
  assert.equal(result.taskStatus,'unverified');
});

test('activated coordinate batch fails before lease acquisition or activation', async()=>{
  const {session,events}=sessionWithEvents();
  assert.throws(()=>session.batch([{operation:'click',x:1,y:2}],{activate:true}),{code:'ACTIVATED_SEQUENCE_KEYBOARD_ONLY'});
  assert.deepEqual(events,[]);
});
