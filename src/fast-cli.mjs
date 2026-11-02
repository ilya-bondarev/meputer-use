// Thin local entry point: usable immediately without reconnecting an old MCP.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DesktopSession} from './desktop.mjs';
import {readPage,pageNeedsInput} from './pages.mjs';
import {requireThat} from './errors.mjs';

const [operation,file]=process.argv.slice(2);
let session;
try {
  requireThat(['windows','text','page','sequence'].includes(operation),'INVALID_OPERATION');
  const request=file?JSON.parse(await readFile(file,'utf8')):{};
  const execute=operation==='sequence'||operation==='page'&&pageNeedsInput(request);
  session=new DesktopSession({mode:execute?'execute':'read-only',allowedProcesses:request.allowedProcesses??['firefox'],stopFile:resolve(import.meta.dirname,'../local/STOP')});
  let result;
  if(operation==='windows')result=await session.windows();
  else if(operation==='page')result=await readPage(session,request);
  else {
    await session.bind(request.window);
    result=operation==='text'?await session.document({maxChars:request.maxChars??100000}):
      await session.batch(request.actions);
  }
  console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({reason:error.code??'INVALID_REQUEST',retryAllowed:false}));process.exitCode=1;}
finally{await session?.close();}
