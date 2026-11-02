// Execute and persist a read-only browser-page task; page content is never code.
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {existsSync} from 'node:fs';
import {writeJsonAtomic} from './persistence/files.mjs';
import {requireThat,ExecutorError} from './errors.mjs';
import {navigateInPage,copyDocument} from './firefox-console.mjs';
import {createUiDriver} from './ui.mjs';

export function validatePageRequest(value) {
  if(value.url)requireThat(/^https?:$/.test(new URL(value.url).protocol),'INVALID_ADDRESS');
  if(value.contains!==undefined)requireThat(typeof value.contains==='string'&&value.contains.length>0&&value.contains.length<=2048,'INVALID_PAGE_MARKER');
  if(value.outFile)requireThat(isAbsolute(value.outFile),'ABSOLUTE_PATH_REQUIRED');
  if(value.maxChars!==undefined)requireThat(Number.isInteger(value.maxChars)&&value.maxChars>0&&value.maxChars<=500000,'INVALID_PAGE_LIMIT');
  if(value.timeoutMs!==undefined)requireThat(Number.isInteger(value.timeoutMs)&&value.timeoutMs>0&&value.timeoutMs<=120000,'INVALID_TIMEOUT');
  if(value.navigation!==undefined)requireThat(['address','spa'].includes(value.navigation),'INVALID_NAVIGATION');
  if(value.format!==undefined)requireThat(['text','dom','html'].includes(value.format),'INVALID_PAGE_FORMAT');
  if(value.readySelector!==undefined)requireThat(typeof value.readySelector==='string'&&value.readySelector.length>0&&value.readySelector.length<=4096,'INVALID_PAGE_SELECTOR');
  requireThat(value.navigation!=='spa'||!!value.contains||!!value.readySelector,'SPA_READY_MARKER_REQUIRED');
}
const sameAddress=(a,b)=>a.replace(/\/$/,'')===b.replace(/\/$/,'');
export const pageNeedsInput=request=>!!request.url||!!request.readySelector||['dom','html'].includes(request.format);
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
      inputTick=page.lastInputTick;
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
