import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const generatedDirectories = ['dist', 'dist-electron', 'release'];

for (const directory of generatedDirectories) {
  const target = path.join(root, directory);
  fs.rmSync(target, { recursive: true, force: true });
}

console.log(`Cleaned generated build directories: ${generatedDirectories.join(', ')}`);
