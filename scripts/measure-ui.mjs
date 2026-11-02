// An opt-in real-browser performance check. It only navigates public posts.
import {readFile,writeFile} from 'node:fs/promises';
import {JobStore,JobRunner} from '../src/jobs.mjs';
import {DesktopSession} from '../src/desktop.mjs';
import {build} from '../routines/read-pages.mjs';
import {resolve} from 'node:path';
if(!process.argv.includes('--live'))throw Error('Pass --live to use Firefox');
const session=new DesktopSession({mode:'execute',allowedProcesses:['firefox']});
try {
 const windows=(await session.windows()).filter(w=>w.processName==='firefox');
 if(windows.length!==1)throw Error('Need one Firefox window');
 const window={id:windows[0].id,processId:windows[0].processId};
 const before=JSON.parse(await readFile(resolve('reports/speed-before.json'),'utf8'));
 const unknown=process.argv.includes('--unknown');
 const job=build({window,directory:resolve('local/performance-after'),pages:before.cases.map(x=>unknown?x.url:{url:x.url,contains:x.marker})});
 if(!unknown)for(const node of job.nodes)if(node.type==='page') {
   node.navigation=process.argv.includes('--spa')?'spa':'address';node.format='text';delete node.readySelector;
 }
 if(process.argv.includes('--dom'))for(const node of job.nodes)if(node.type==='page')node.format='dom';
 job.userIdleMs=0;
 const store=new JobStore(resolve('local/performance-after/jobs'));
 const start=performance.now(),created=await store.create(job);
 const result=await new JobRunner({store}).run(created.id);
 const elapsedMs=performance.now()-start;
 if(result.status!=='completed')throw Error(result.reason||result.status);
 const cases=[];
 for(const [i,baseline] of before.cases.entries()) {
  const output=result.outputs['page_'+i],page=JSON.parse(await readFile(output.path,'utf8'));
  const verified=page.url===baseline.url&&page.text.includes(baseline.marker);
  if(!verified)throw Error('INCORRECT_PAGE');
  cases.push({url:page.url,verified,characters:page.text.length,transport:page.transport??'accessibility',links:page.links?.length,images:page.images?.length,...output.timings});
 }
 const report={at:new Date().toISOString(),kind:'same three public posts; actual browser loading, no fixed sleeps',elapsedMs,
  beforeMs:before.cases.reduce((s,x)=>s+x.elapsedMs,0),cases};
 report.speedup=report.beforeMs/elapsedMs;
 await writeFile(resolve('reports/speed-after'+(unknown?'-unknown':'')+(process.argv.includes('--spa')?'-spa':'')+(process.argv.includes('--dom')?'-dom':'')+'.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
} finally {await session.close();}
