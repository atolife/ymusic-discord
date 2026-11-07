import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'win32') throw new Error('YMusic requires Windows.');
if (!fs.existsSync(path.join(root, 'native/ProcessAudio.exe'))) {
  const result = await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts/build-audio.ps1')], { windowsHide: true });
  if (result.stdout.trim()) console.log(result.stdout.trim());
}
