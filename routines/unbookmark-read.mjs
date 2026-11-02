// Run a bounded, resumable native-UI batch against an explicit list of read posts.
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {DesktopSession} from '../src/desktop.mjs';
import {createUiDriver} from '../src/ui.mjs';
import {bookmarkItems,canonicalPost} from '../src/services/x/index.mjs';
import {writeJsonAtomic,lockFile} from '../src/persistence/files.mjs';
import {requireThat} from '../src/errors.mjs';

export async function unbookmarkRead({targetFile,directory,limit=1000}) {
  const input=JSON.parse(await readFile(targetFile,'utf8'));
  requireThat(Array.isArray(input.targets)&&input.targets.length>0,'EMPTY_TARGETS');
  const ids=new Set(input.targets.map(post=>{
    requireThat(canonicalPost(post.url)?.id===post.id,'INVALID_POST_URL');return post.id;
  }));
  await mkdir(directory,{recursive:true});
  const unlock=await lockFile(join(directory,'run.lock'),'BATCH_RUNNING');
  const stateFile=join(directory,'results.json');
  let state;
  try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  state??={startedAt:new Date().toISOString(),events:[]};
  delete state.error;delete state.finishedAt;delete state.scanCompletedAt;state.runRemoved=0;
  const session=new DesktopSession({mode:'execute',allowedProcesses:['firefox'],stopFile:resolve('local/STOP')});
  const observe={activeDocument:true,maxElements:1000,maxDepth:30,includeValues:true,budgetMs:5000};
  const ui=createUiDriver(session);let count=0;
  const save=async()=>writeJsonAtomic(stateFile,state);
  try {
    const windows=(await session.windows()).filter(window=>window.processName==='firefox');
    requireThat(windows.length===1,'WINDOW_NOT_UNIQUE');
    await session.bind({id:windows[0].id,processId:windows[0].processId});
    requireThat((await session.health()).inputIdleMs>=3000,'USER_ACTIVE');
    await session.withInputLease(async()=>{
      await session.activate();
      await session.sequence([{operation:'key',keys:['CTRL','HOME']}]);
      let snapshot=await ui.read(observe),stalled=0,previous='';
      while(count<limit) {
        requireThat(!snapshot.truncated,'INCOMPLETE_OBSERVATION');
        const items=bookmarkItems(snapshot);
        const bounds=snapshot.elements[0].bounds;
        // X's sticky tab bar can cover controls that UIA still marks onscreen.
        const item=items.find(row=>ids.has(row.id)&&row.bookmarked&&row.control.enabled&&!row.control.offscreen&&row.control.bounds.y>bounds.y+170&&row.control.bounds.y+row.control.bounds.height<bounds.y+bounds.height-30);
        if(item) {
          const event={id:item.id,url:item.url,startedAt:new Date().toISOString(),status:'pending'};
          state.events.push(event);await save();
          try{await session.backend.act(session.window,item.control,'invoke');}
          catch(error){
            if(error.code!=='NOT_ACTIONABLE')throw error;
            // The native guard rejected before input: React moved this control.
            event.status='not_actionable';event.reason=error.code;await save();
            snapshot=await ui.read(observe);continue;
          }
          const until=Date.now()+8000;
          while(true) {
            snapshot=await ui.read(observe);
            requireThat(!snapshot.truncated,'INCOMPLETE_OBSERVATION');
            const current=bookmarkItems(snapshot).find(row=>row.id===item.id);
            if(!current||current.bookmarked===false)break;
            requireThat(Date.now()<until,'REMOVAL_NOT_CONFIRMED');await delay(150);
          }
          event.status='removed';event.completedAt=new Date().toISOString();count++;
          state.updatedAt=event.completedAt;await save();
          console.log(JSON.stringify({removed:count,totalRemoved:state.events.filter(e=>e.status==='removed').length,id:item.id,ms:Date.parse(event.completedAt)-Date.parse(event.startedAt)}));
          stalled=0;previous='';continue;
        }
        const signature=items.map(row=>row.id+':'+row.bookmarked+':'+Math.round(row.control?.bounds?.y??0)).join(',');
        stalled=signature===previous?stalled+1:0;previous=signature;
        if(stalled>=6){state.scanCompletedAt=new Date().toISOString();state.lastVisible=items.map(row=>({id:row.id,bookmarked:row.bookmarked}));await save();break;}
        await ui.scroll(observe,-400);await delay(120);snapshot=await ui.read(observe);
      }
      state.runRemoved=count;state.finishedAt=new Date().toISOString();await save();
    });
    return state;
  }catch(error){state.error={code:error.code??error.message,at:new Date().toISOString()};await save();throw error;}
  finally{await session.close();await unlock();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const directory=resolve(process.argv[3]??'local/unbookmark-read');
  const result=await unbookmarkRead({targetFile:resolve(process.argv[2]??join(directory,'targets.json')),directory,limit:Number(process.argv[4]??1000)});
  console.log(JSON.stringify({finishedAt:result.finishedAt,removed:result.runRemoved,scanCompletedAt:result.scanCompletedAt}));
}
