// Execute and persist a read-only browser-page task; page content is never code.
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {existsSync} from 'node:fs';
import {writeJsonAtomic} from './persistence/files.mjs';
import {requireThat,ExecutorError} from './errors.mjs';
import {navigateInPage,copyDocument} from './firefox-console.mjs';
import {createUiDriver} from './ui.mjs';

import { validatePageRequest, pageNeedsInput } from './services/interface/index.mjs';
export { validatePageRequest, pageNeedsInput } from './services/interface/index.mjs';
const sameAddress=(a,b)=>a.replace(/\/$/,'')===b.replace(/\/$/,'');
export async function readPage(session,request,options={}) {
  validatePageRequest(request);
  const operation=()=>readBoundPage(session,request,options);
  return pageNeedsInput(request)?session.withInputLease(operation):operation();
}
async function readBoundPage(session,request,{signal,userIdleMs=3000,cancelFile}={}) {
  const started=performance.now(),timings={};let inPageNavigation,inputTick;
  const check=()=>{
    signal?.throwIfAborted();
    requireThat(!session.stopFile||!existsSync(session.stopFile),'STOP_REQUESTED');
    requireThat(!cancelFile||!existsSync(cancelFile),'CANCELLED');
  };
  check();
  await session.bind(request.window);
  if(pageNeedsInput(request)) {
    const health=await session.health();
    requireThat(health.inputIdleMs>=userIdleMs,'USER_ACTIVE');
    inputTick=(await session.activate()).lastInputTick;
  }
  if(request.url) {
    const t=performance.now();
    if(request.navigation==='spa') {
      try{
        if(request.readySelector) {
          const current=await session.document({maxChars:1});
          requireThat(new URL(current.url).origin===new URL(request.url).origin,'SAME_ORIGIN_REQUIRED');
          inPageNavigation=request.url;
        }else inputTick=(await navigateInPage(session,request.url,{expectedInputTick:inputTick})).lastInputTick;
      }
      catch(error){
        // This check fails before any delivery. A cross-origin first page
        // uses ordinary navigation; uncertain deliveries are never retried.
        if(error.code!=='SAME_ORIGIN_REQUIRED')throw error;
        inputTick=(await createUiDriver(session,{signal}).navigate(request.url,{expectedInputTick:inputTick})).lastInputTick;
      }
    } else inputTick=(await createUiDriver(session,{signal}).navigate(request.url,{expectedInputTick:inputTick})).lastInputTick;
    timings.navigateMs=performance.now()-t;
  }
  const deadline=performance.now()+(request.timeoutMs??20000);
  let page,reads=0;
  while(!request.readySelector) {
    check();
    try {
      page=await session.document({maxChars:request.maxChars??100000});reads++;
      requireThat(!page.inputChangedDuringRead&&(inputTick===undefined||page.lastInputTick===inputTick),'USER_INTERFERENCE');
      // A read-only poll owns no input sequence. Another window's input between
      // observations must not turn an otherwise ready page into interference.
      if(pageNeedsInput(request))inputTick=page.lastInputTick;
      if((!request.url||sameAddress(page.url,request.url))&&
          (request.contains?page.text.includes(request.contains):page.text.trim().length>32))break;
    }catch(error) {
      if(!['ACTIVE_DOCUMENT_UNAVAILABLE','ELEMENT_GONE'].includes(error.code))throw error;
    }
    if(performance.now()>=deadline)throw new ExecutorError('PAGE_READY_TIMEOUT');
    await delay(100,undefined,{signal});
  }
  timings.reads=reads;timings.totalMs=performance.now()-started;
  if(request.readySelector||request.format==='dom'||request.format==='html') {
    check();
    page=await copyDocument(session,{format:request.format==='html'?'html':'text',maxChars:request.maxChars??100000,signal,
      readySelector:request.readySelector,expectedUrl:request.url,navigateTo:inPageNavigation,expectedInputTick:inputTick,timeoutMs:request.timeoutMs??20000,check});
    requireThat((!request.url||sameAddress(page.url,request.url))&&(!request.contains||page.text.includes(request.contains)),'PAGE_CHANGED');
    timings.totalMs=performance.now()-started;
  }
  const result={taskStatus:'observed',...page,timings};
  if(!request.outFile)return result;
  const saveStarted=performance.now();
  await mkdir(dirname(request.outFile),{recursive:true});
  await writeJsonAtomic(request.outFile,result);
  return {taskStatus:'observed',url:page.url,title:page.title,characters:page.text.length,truncated:page.truncated,
    path:request.outFile,timings:{...timings,persistMs:performance.now()-saveStarted}};
}
