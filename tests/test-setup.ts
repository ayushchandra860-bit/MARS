import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach } from 'vitest';

const testsDirectory = path.join(process.cwd(), 'tests');

function removeDatabaseSidecars(): void {
  if (!fs.existsSync(testsDirectory)) return;
  for (const entry of fs.readdirSync(testsDirectory)) {
    if (entry.endsWith('.db.bak') || /\.db\.(?:tmp|replace)-\d+$/.test(entry)) {
      try {
        fs.unlinkSync(path.join(testsDirectory, entry));
      } catch {}
    }
  }
}

beforeEach(removeDatabaseSidecars);
afterEach(removeDatabaseSidecars);
