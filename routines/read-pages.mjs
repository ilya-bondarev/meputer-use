// A saved batch replaces one model/tool round trip per navigation and save.
import {join} from 'node:path';
import {postReadiness} from '../src/services/x/index.mjs';
export function build({window,pages,directory}) {
  return {version:1,goal:'Read and save a series of browser pages',allowedProcesses:['firefox'],maxTransitions:pages.length,
    nodes:pages.map((page,index)=>({id:'page_'+index,type:'page',window,
      ...prepare(typeof page==='string'?{url:page}:page),
      outFile:join(directory,String(index+1).padStart(4,'0')+'.json'),key:'page_'+index,replay:'idempotent'}))};
}
function prepare(page) {
  const ready=page.url?postReadiness(page.url):null;
  return ready?{navigation:'spa',...(page.contains?{format:'text'}:{format:'dom',...ready}),...page}:page;
}
