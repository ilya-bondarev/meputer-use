import { open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import { ExecutorError, requireThat } from '../errors.mjs';

const livePid = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
export async function writeJsonAtomic(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const f = await open(temp, 'wx');
  try { await f.writeFile(JSON.stringify(value, null, 2)); await f.sync(); } finally { await f.close(); }
  // Windows indexers can briefly hold the destination without delete sharing.
  for(let attempt=0;;attempt++) {
    try{await rename(temp,path);break;}
    catch(error){
      if(process.platform!=='win32'||!['EPERM','EBUSY'].includes(error.code)||attempt>=5)throw error;
      await delay(50*(attempt+1));
    }
  }
}
export async function lockFile(path, busyCode) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const f = await open(path, 'wx'); await f.writeFile(String(process.pid)); await f.close(); return async () => { await unlink(path).catch(() => {}); }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(await readFile(path, 'utf8').catch(() => '0'));
      requireThat(pid > 0 && !livePid(pid), busyCode); await unlink(path);
    }
  }
  throw new ExecutorError(busyCode);
}
