import { packager } from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Expected a stable semantic version.');
const output = path.join(root, 'dist');
const nativeBuild = await promisify(execFile)('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts/build-audio.ps1')], { windowsHide: true });
if (nativeBuild.stdout.trim()) console.log(nativeBuild.stdout.trim());
const result = await packager({
  dir: root, out: output, name: `YMusic-${pkg.version}`, executableName: 'YMusic', platform: 'win32', arch: 'x64',
  electronVersion: '45.2.3',
  icon: path.join(root, 'desktop/icon.ico'), asar: false, prune: true, overwrite: true,
  appVersion: pkg.version, buildVersion: pkg.version, appCopyright: 'Copyright 2026 atolife — YMusic',
  win32metadata: { CompanyName: 'YMusic', FileDescription: 'YMusic — музыка в Discord', ProductName: 'YMusic' },
  ignore: [/^\/config\.json$/, /^\/settings\.json$/, /^\/\.env(?:\.|$)/, /^\/(?:dist|docs|work|test|scripts|\.cache|\.git|\.github)($|\/)/, /\.log$/, /^\/\.gitignore$/, /^\/\.gitattributes$/],
});
for (const directory of result) {
  fs.copyFileSync(path.join(root, 'DESKTOP.md'), path.join(directory, 'Начать здесь.md'));
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE-YMusic.txt'));
  fs.copyFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(directory, 'THIRD_PARTY_NOTICES.md'));
  console.log(directory);
}
