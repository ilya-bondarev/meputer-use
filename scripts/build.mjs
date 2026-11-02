import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const framework = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
if (process.platform !== 'win32' || !existsSync(join(framework, 'csc.exe'))) {
  throw new Error('Windows x64 with the built-in .NET Framework 4.x compiler is required.');
}
mkdirSync(join(root, 'bin'), { recursive: true });
const nativeFiles = ['WindowsUiaHost.cs','Desktop.cs','Content.cs','Credentials.cs','Administrator.cs','InputLease.cs'];
const version = createHash('sha256').update(nativeFiles.map(name=>readFileSync(join(root,'native',name),'utf8')).join('\n')).digest('hex').slice(0,12);
const executable = `WindowsUiaHost-${version}.exe`;
const result = existsSync(join(root,'bin',executable)) ? {status:0} : spawnSync(join(framework, 'csc.exe'), [
  '/nologo', '/target:exe', '/platform:x64', '/optimize+',
  `/out:${join(root, 'bin', executable)}`,
  `/reference:${join(framework, 'WPF', 'UIAutomationClient.dll')}`,
  `/reference:${join(framework, 'WPF', 'UIAutomationTypes.dll')}`,
  `/reference:${join(framework, 'WPF', 'WindowsBase.dll')}`,
  `/reference:${join(framework, 'System.Web.Extensions.dll')}`,
  `/reference:${join(framework, 'System.Drawing.dll')}`,
  `/reference:${join(framework, 'System.Windows.Forms.dll')}`,
  join(root, 'native', 'WindowsUiaHost.cs'),
  join(root, 'native', 'Desktop.cs'),
  join(root, 'native', 'Content.cs'),
  join(root, 'native', 'Credentials.cs'),
  join(root, 'native', 'Administrator.cs'),
  join(root, 'native', 'InputLease.cs'),
], { encoding: 'utf8', windowsHide: true, shell: false });
if (result.status !== 0) throw new Error(result.stdout + result.stderr);
writeFileSync(join(root,'bin','host.json'),JSON.stringify({executable}));
console.log('Built bin/'+executable+'. Existing processes were not interrupted.');
