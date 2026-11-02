import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { ExecutorError, requireThat } from '../errors.mjs';
import manifest from '../../package.json' with {type:'json'};

// Public MCP stdio client. No Telegram implementation or account state here.
export class StdioMcpClient {
  #child; #pending=new Map(); #next=0; #ready; #closed=false; #diagnostic=''; #authRequired=false;
  constructor({command,args=[],cwd,env={},roots=[],timeoutMs=60000}) {
    this.timeoutMs=timeoutMs; this.roots=roots;
    this.#child=spawn(command,args,{cwd,env:{...process.env,...env},windowsHide:true,stdio:['pipe','pipe','pipe']});
    // Provider diagnostics can contain account data. Drain; never forward to MCP stdout.
    this.#child.stderr.on('data',chunk=>{this.#diagnostic+=chunk;this.#authRequired ||= /not authorized|session.*expired/i.test(this.#diagnostic);this.#diagnostic=this.#diagnostic.slice(-16384);});
    this.#child.stdin.on('error',()=>this.#child.kill());
    this.#child.on('error',()=>this.#fail('PROVIDER_UNAVAILABLE'));
    this.#child.on('close',()=>this.#fail(this.#authRequired?'PROVIDER_AUTH_REQUIRED':'PROVIDER_DISCONNECTED'));
    const lines=createInterface({input:this.#child.stdout});
    lines.on('line',line=>{
      try {
        requireThat(Buffer.byteLength(line)<=16*1024*1024,'PROVIDER_RESPONSE_LIMIT');
        const m=JSON.parse(line);
        if(m.method&&m.id!==undefined) {
          const result=m.method==='roots/list'?{roots:this.roots.map(uri=>({uri}))}:undefined;
          this.#write(result?{jsonrpc:'2.0',id:m.id,result}:{jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Unsupported client request'}});
          return;
        }
        const p=this.#pending.get(m.id); if(!p)return;
        this.#pending.delete(m.id);p.cleanup();
        if(m.error)p.reject(new ExecutorError('PROVIDER_RPC_ERROR'));
        else p.resolve(m.result);
      } catch {this.#fail('PROVIDER_PROTOCOL_ERROR');this.close();}
    });
  }
  #write(m) {if(!this.#closed)this.#child.stdin.write(JSON.stringify(m)+'\n');}
  #fail(code) {this.#closed=true;for(const p of this.#pending.values()){p.cleanup();p.reject(new ExecutorError(code));}this.#pending.clear();}
  async start() {
    return this.#ready ||= this.request('initialize',{protocolVersion:'2024-11-05',capabilities:{roots:{listChanged:false}},clientInfo:{name:manifest.name+'-client',version:manifest.version}})
      .then(value=>{this.#write({jsonrpc:'2.0',method:'notifications/initialized'});return value;});
  }
  request(method,params={}, {signal,timeoutMs=this.timeoutMs}={}) {
    signal?.throwIfAborted();requireThat(!this.#closed,'PROVIDER_DISCONNECTED');
    const id=++this.#next;
    return new Promise((resolve,reject)=>{
      const abort=()=>{this.#write({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id}});this.#pending.delete(id);cleanup();reject(signal.reason);};
      const timer=setTimeout(()=>{this.#pending.delete(id);cleanup();reject(new ExecutorError('PROVIDER_TIMEOUT'));},timeoutMs);
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      this.#pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',abort,{once:true});
      this.#write({jsonrpc:'2.0',id,method,params});
    });
  }
  async listTools(options={}) {
    await this.start();const tools=[];let cursor;
    do {const page=await this.request('tools/list',cursor?{cursor}:{},options);tools.push(...page.tools);cursor=page.nextCursor;requireThat(tools.length<=2000,'PROVIDER_CATALOG_LIMIT');}while(cursor);
    return tools;
  }
  async callTool(name,args,options) {await this.start();return this.request('tools/call',{name,arguments:args},options);}
  async close() {
    if(!this.#child)return;
    this.#child.stdin.end();
    await Promise.race([new Promise(resolve=>this.#child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,500))]);
    if(this.#child.exitCode===null)this.#child.kill();this.#fail('PROVIDER_DISCONNECTED');
  }
}
