import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const required = [
  packageJson.main,
  'dist/index.html',
  'dist/overlay.html',
  'dist-electron/preload/index.js',
  'dist-electron/preload/overlay-preload.js',
];

const missing = required.filter((relativePath) => !fs.existsSync(path.join(root, relativePath)));
if (missing.length > 0) {
  console.error('Build verification failed. Missing artifacts:');
  for (const item of missing) console.error(`- ${item}`);
  process.exit(1);
}

const mainStat = fs.statSync(path.join(root, packageJson.main));
if (mainStat.size < 1000) {
  console.error(`Build verification failed. Electron entry is unexpectedly small: ${packageJson.main}`);
  process.exit(1);
}

console.log('Build verification passed. Required artifacts:');
for (const item of required) console.log(`- ${item}`);
