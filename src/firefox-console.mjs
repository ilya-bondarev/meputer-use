// Firefox's ordinary Web Console UI. No debugger server, extension or bot mode.
// Only locally constructed DOM reads and same-origin history navigation run here.
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {requireThat,ExecutorError} from './errors.mjs';

const prepared=new WeakSet();
function historyNavigation(before,address) {
  requireThat(new URL(before).origin===new URL(address).origin,'SAME_ORIGIN_REQUIRED');
  return 'if(location.href!=='+JSON.stringify(before)+')throw Error("Page changed");history.pushState({...history.state,idx:(history.state?.idx??0)+1},"",'+JSON.stringify(address)+');dispatchEvent(new PopStateEvent("popstate",{state:history.state}));';
}
async function command(session,source,expectedInputTick) {
  requireThat(session.window.processName.toLowerCase()==='firefox','FIREFOX_REQUIRED');
  let receipt=await session.sequence([{operation:'key',keys:['CTRL','SHIFT','K']}],{expectedInputTick});
  if(!prepared.has(session)) {
    const options={scope:{automationId:'devtools-webconsole'},maxElements:80,maxDepth:5,budgetMs:1500};
    let view;const deadline=performance.now()+5000;
    while(!view) {
      try{view=await session.observe(options);}
      catch(error){
        if(!['SCOPE_NOT_UNIQUE','ELEMENT_GONE'].includes(error.code)||performance.now()>=deadline)throw error;
        await delay(100);
      }
    }
    const multiline=v=>v.elements.some(e=>e.role==='Button'&&/^(Run|Запустить)$/i.test(e.name));
    requireThat(!view.inputChangedDuringRead&&view.lastInputTick===receipt.lastInputTick,'USER_INTERFERENCE');
    if(!multiline(view)) {receipt=await session.sequence([{operation:'key',keys:['CTRL','B']}],{expectedInputTick:receipt.lastInputTick});view=await session.observe(options);}
    requireThat(multiline(view),'CONSOLE_MULTILINE_REQUIRED');
    prepared.add(session);
  }
  // Paste is one editor transaction: per-character input triggers CodeMirror's
  // automatic brackets and can silently change JavaScript.
  return session.sequence([{operation:'key',keys:['CTRL','HOME']},{operation:'key',keys:['CTRL','SHIFT','END']},
    {operation:'paste',text:source},{operation:'key',keys:['CTRL','ENTER']}],{expectedInputTick:receipt.lastInputTick});
}
export async function navigateInPage(session,address,{expectedInputTick}={}) {
  const before=await session.document({maxChars:1});
  const source='(()=>{'+historyNavigation(before.url,address)+'})()';
  return command(session,source,expectedInputTick);
}
export async function copyDocument(session,{format='text',maxChars=100000,signal,readySelector,expectedUrl,navigateTo,expectedInputTick,timeoutMs=20000,check=()=>{}}={}) {
  requireThat(['text','html'].includes(format),'INVALID_PAGE_FORMAT');
  const before=await session.document({maxChars:1}),token=randomUUID();
  const target=expectedUrl??before.url;
  // Firefox's copy helper reports a synchronous evaluation result. Calling it
  // after await does not deliver that result to the console actor/clipboard.
  // Poll with short synchronous reads; never leave timers running in the page.
  const source=prefix=>'(()=>{try{'+prefix+'if(location.href!=='+JSON.stringify(target)+
    (readySelector?'||!document.querySelector('+JSON.stringify(readySelector)+')':'')+
    '){copy(JSON.stringify({token:'+JSON.stringify(token)+',ready:false}));return;}const root=document.querySelector("main")||document.body;'+
    'const raw='+(format==='html'?'root.outerHTML':'root.innerText')+';copy(JSON.stringify({token:'+JSON.stringify(token)+',url:location.href,title:document.title,text:raw.slice(0,'+maxChars+'),truncated:raw.length>'+maxChars+',links:Array.from(root.querySelectorAll("a[href]")).slice(0,1000).map(a=>({text:a.innerText,url:a.href})),images:Array.from(root.querySelectorAll("img")).slice(0,1000).map(i=>({alt:i.alt,url:i.currentSrc||i.src}))}));}catch(error){copy(JSON.stringify({token:'+JSON.stringify(token)+',error:"DOM_READ_FAILED"}));}})()';
  let receipt=await command(session,source(navigateTo?historyNavigation(before.url,navigateTo):''),expectedInputTick);
  let responded=false;
  const deadline=performance.now()+timeoutMs+3000;
  while(performance.now()<deadline) {
    signal?.throwIfAborted();
    check();
    const frame=await session.frame();
    requireThat(frame.lastInputTick===receipt.lastInputTick,'USER_INTERFERENCE');
    const clipboard=await session.action('clipboard_read',{frameId:frame.frameId});
    let value;
    try {value=JSON.parse(clipboard.text);}
    catch(error){if(!(error instanceof SyntaxError))throw error;}
    if(value?.token===token) {
      responded=true;
      if(value.error)throw new ExecutorError(value.error);
      if(value.ready===false) {await delay(100,undefined,{signal});check();receipt=await command(session,source(''),receipt.lastInputTick);continue;}
      delete value.token;return {...value,transport:'firefox-console-dom'};
    }
    await delay(100,undefined,{signal});
  }
  throw new ExecutorError(responded?'PAGE_READY_TIMEOUT':'DOM_COPY_TIMEOUT');
}
