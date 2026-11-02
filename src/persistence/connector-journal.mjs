import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { requireThat } from '../errors.mjs';

function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function createConnectorJournal(root=resolve(import.meta.dirname,'../../local/connector-requests')) {
  const validId=id=>requireThat(typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id),'INVALID_REQUEST_ID');
  let database;
  const db=()=>{
    if(!database) {
      mkdirSync(root,{recursive:true});database=new DatabaseSync(join(root,'requests.sqlite'));
      database.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      requireThat([0,1].includes(database.prepare('PRAGMA user_version').get().user_version),'UNSUPPORTED_JOURNAL_VERSION');
      database.exec(`CREATE TABLE IF NOT EXISTS requests (
        request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
        platform TEXT NOT NULL, operation TEXT NOT NULL, started_at TEXT NOT NULL,
        completed_at TEXT, output TEXT, reason TEXT
      ); PRAGMA user_version=1;`);
    }
    return database;
  };
  const get=id=>db().prepare('SELECT * FROM requests WHERE request_id=?').get(id);
  const receipt=row=>({requestId:row.request_id,fingerprint:row.fingerprint,status:row.status,
    platform:row.platform,operation:row.operation,startedAt:row.started_at,completedAt:row.completed_at,
    ...(row.output!==null?{output:JSON.parse(row.output)}:{}),...(row.reason?{reason:row.reason}:{})});
  return {
    async inspect(id) {validId(id);const row=get(id);requireThat(row,'REQUEST_NOT_FOUND');return receipt(row);},
    async execute(id,request,deliver) {
      validId(id);const hash=digest(request);const connection=db();
      connection.exec('BEGIN IMMEDIATE');
      try {
        const previous=get(id);
        if(previous) {
          requireThat(previous.fingerprint===hash,'REQUEST_ID_CONFLICT');
          if(previous.status==='completed'){connection.exec('COMMIT');return {...receipt(previous),replayed:true};}
          requireThat(previous.status==='rejected','REQUEST_UNCERTAIN');
        }
        connection.prepare(`INSERT INTO requests(request_id,fingerprint,status,platform,operation,started_at)
          VALUES(?,?,'started',?,?,?) ON CONFLICT(request_id) DO UPDATE SET status='started',reason=NULL`)
          .run(id,hash,request.platform,request.name,new Date().toISOString());
        connection.exec('COMMIT');
      } catch(error) {if(connection.isTransaction)connection.exec('ROLLBACK');throw error;}
      try {
        const output=JSON.stringify(await deliver());requireThat(Buffer.byteLength(output)<=16*1024*1024,'PROVIDER_RESPONSE_LIMIT');
        connection.prepare("UPDATE requests SET status='completed',completed_at=?,output=? WHERE request_id=?").run(new Date().toISOString(),output,id);
        return receipt(get(id));
      } catch(error) {
        connection.prepare('UPDATE requests SET status=?,reason=? WHERE request_id=?').run(error.safeToRetry?'rejected':'uncertain',error.code||'CONNECTOR_FAILED',id);
        throw error;
      }
    },
    close() {database?.close();database=undefined;},
  };
}
