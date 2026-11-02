import {readFile} from 'node:fs/promises';
import {createConnectors,platformNames} from './connectors.mjs';
const args=process.argv.slice(2),execute=args.includes('--execute');
const [command,value,name]=args.filter(a=>a!=='--execute');
const runtime=createConnectors({mode:execute?'execute':'read-only'});
try {
  let result;
  if(command==='catalog')result=runtime.catalog({platform:value,name});
  else if(command==='call')result=await runtime.invoke(JSON.parse(await readFile(value,'utf8')));
  else if(command==='receipt')result=await runtime.inspect(value);
  else throw new Error('catalog ['+platformNames.join('|')+'] [NAME] | call FILE [--execute] | receipt ID');
  console.log(JSON.stringify(result,null,2));
} catch(error) {console.error(JSON.stringify({reason:error.code||error.message,details:error.details}));process.exitCode=1;}
finally {await runtime.close();}
