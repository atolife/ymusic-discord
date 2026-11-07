import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))];
const failures=[];
const patterns=[/\bmfa\.[A-Za-z0-9_-]{30,}/,/\b[A-Za-z0-9_-]{20,30}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}\b/,/\bgh[pousr]_[A-Za-z0-9]{30,}\b/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
for(const file of files){
  if (/(^|\/)(?:config\.json|settings\.json|\.env(?:\..*)?|node_modules|dist|\.cache)(?:\/|$)/.test(file) && file!=='.env.example') failures.push(`${file}: private or generated file`);
  if(/\.(?:exe|wav|pcm|dmp|pdb)$/i.test(file)) failures.push(`${file}: generated binary or recording`);
  if(!/\.(?:md|js|cjs|json|ps1|cmd|cs|yml|yaml|svg)$/.test(file)) continue;
  const content=fs.readFileSync(path.join(root,file),'utf8');
  if(patterns.some(pattern=>pattern.test(content))) failures.push(`${file}: possible credential`);
}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
if(pkg.version!==lock.version||pkg.name!==lock.name) failures.push('package metadata and lockfile disagree');
if(failures.length){console.error(failures.join('\n'));process.exit(1);}
console.log(`Repository check passed: ${files.length} files; no known credential patterns or private/generated paths.`);
