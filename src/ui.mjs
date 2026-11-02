import {setTimeout as delay} from 'node:timers/promises';
import {requireThat,ExecutorError} from './errors.mjs';
import {select} from './selectors.mjs';

// Generic Windows interface orchestration, independent of service names.
export function createUiDriver(session,{signal}={}) {
  async function read(observe={}) {
    signal?.throwIfAborted();
    const snapshot=await session.observe({...observe,includeValues:true});
    requireThat(!snapshot.inputChangedDuringRead,'USER_INTERFERENCE');
    return snapshot;
  }
  async function input(operation,parameters={}) {
    signal?.throwIfAborted();
    const frame=await session.frame();
    return session.action(operation,{...parameters,frameId:frame.frameId});
  }
  async function target(selector,observe) {
    const snapshot=await read(observe);
    requireThat(!snapshot.truncated,'INCOMPLETE_OBSERVATION');
    const candidates=select(snapshot,selector).filter(e=>e.enabled&&!e.offscreen&&!e.password&&e.bounds?.width>0&&e.bounds?.height>0);
    requireThat(candidates.length===1,'TARGET_NOT_UNIQUE');
    return candidates[0];
  }
  async function waitAddressField(predicate,code,lastInputTick) {
    const until=performance.now()+8000;
    while(true) {
      const view=await read({scope:{automationId:'urlbar-input'},maxElements:1,maxDepth:0,budgetMs:1500});
      requireThat(view.lastInputTick===lastInputTick,'USER_INTERFERENCE');
      if(predicate(view.elements[0]))return;
      requireThat(performance.now()<until,code);await delay(30,undefined,{signal});
    }
  }
  return {
    read,input,
    async navigate(address,options) {
      requireThat(typeof address==='string'&&/^https?:\/\//.test(address),'INVALID_ADDRESS');
      signal?.throwIfAborted();
      // Ctrl+L is also Clear Console when Firefox DevTools owns focus.
      let receipt=await session.sequence([{operation:'key',keys:['ALT','D']}],options);
      const firefox=session.window.processName.toLowerCase()==='firefox';
      if(firefox)await waitAddressField(field=>field?.focused,'ADDRESS_INPUT_NOT_FOCUSED',receipt.lastInputTick);
      receipt=await session.sequence([{operation:'key',keys:['CTRL','A']},{operation:'type',text:address}],{expectedInputTick:receipt.lastInputTick});
      if(firefox)await waitAddressField(field=>field?.focused&&field.value===address,'ADDRESS_INPUT_NOT_CONFIRMED',receipt.lastInputTick);
      receipt=await session.sequence([{operation:'key',keys:['ENTER']}],{expectedInputTick:receipt.lastInputTick});
      return {taskStatus:'unverified',address,...receipt};
    },
    async click(selector,observe,button='left') {
      const element=await target(selector,observe);const frame=await session.frame();
      return session.action('click',{frameId:frame.frameId,x:Math.round(element.bounds.x+element.bounds.width/2-frame.x),y:Math.round(element.bounds.y+element.bounds.height/2-frame.y),button});
    },
    async scroll(observe,delta=-700) {
      const snapshot=await read(observe);const root=snapshot.elements[0];const frame=await session.frame();
      requireThat(root?.bounds,'SCROLL_TARGET_UNAVAILABLE');
      return session.action('wheel',{frameId:frame.frameId,x:Math.round(Math.max(0,root.bounds.x-frame.x)+Math.min(root.bounds.width,frame.width)*0.65),y:Math.round(Math.max(0,root.bounds.y-frame.y)+Math.min(root.bounds.height,frame.height)*0.65),delta});
    },
    async wait(predicate,observe,timeoutMs=10000) {
      const until=Date.now()+timeoutMs;
      while(true) {
        const snapshot=await read(observe);if(await predicate(snapshot))return snapshot;
        if(Date.now()>=until)throw new ExecutorError('UI_RESULT_TIMEOUT');
        await delay(200,undefined,{signal});
      }
    },
  };
}
