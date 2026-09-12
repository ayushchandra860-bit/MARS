import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const sourcePath = path.resolve('scripts/rc4-trade-pipeline-fix.mjs');
const source = fs.readFileSync(sourcePath, 'utf8');
const bodyStart = source.indexOf("\nconst lifecycle = 'electron/main/trade/TradeLifecycleManager.ts';");
if (bodyStart < 0) throw new Error('RC4 patch body marker not found.');

const prelude = `import fs from 'node:fs';
function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, content) { fs.writeFileSync(file, content, 'utf8'); }
function replaceOnce(file, oldText, newText) {
  const source = read(file);
  if (source.includes(newText)) return;
  const occurrences = source.split(oldText).length - 1;
  if (occurrences !== 1) throw new Error(file + ': expected one match, found ' + occurrences);
  write(file, source.replace(oldText, newText));
}
function replaceSection(file, start, end, replacement) {
  const source = read(file);
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(file + ': section markers not found');
  if (source.indexOf(start, startIndex + 1) >= 0) throw new Error(file + ': start marker is not unique');
  if (source.slice(startIndex, endIndex) === replacement) return;
  write(file, source.slice(0, startIndex) + replacement + source.slice(endIndex));
}
`;

const runnable = path.join('/tmp', `rc4-patch-${process.pid}.mjs`);
fs.writeFileSync(runnable, prelude + source.slice(bodyStart), 'utf8');
const result = spawnSync(process.execPath, [runnable], { cwd: process.cwd(), stdio: 'inherit' });
try { fs.unlinkSync(runnable); } catch {}
process.exit(result.status ?? 1);
