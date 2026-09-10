import fs from 'node:fs';
import path from 'node:path';

const contractPath = 'shared/contracts/ipc-channels.ts';
const handlerPath = 'electron/main/ipc/handlers.ts';
const reportPath = 'scratch/restart-ipc-contract-audit.json';
const contract = fs.readFileSync(contractPath, 'utf8');
const handlers = fs.readFileSync(handlerPath, 'utf8');
const block = contract.match(/export const IPC_INVOKE_CHANNELS = \{([\s\S]*?)\n\} as const;/)?.[1];
if (!block) throw new Error('Could not locate IPC_INVOKE_CHANNELS block');
const entries = [...block.matchAll(/^\s*([A-Z0-9_]+):\s*'([^']+)'/gm)].map((match) => ({ key: match[1], value: match[2] }));
const handledKeys = new Set([...handlers.matchAll(/safeHandle\(\s*IPC_INVOKE_CHANNELS\.([A-Z0-9_]+)/g)].map((match) => match[1]));
const handledLiterals = new Set([...handlers.matchAll(/safeHandle\(\s*'([^']+)'/g)].map((match) => match[1]));
const missingHandlers = entries.filter(({ key, value }) => !handledKeys.has(key) && !handledLiterals.has(value));
const unknownLiterals = [...handledLiterals].filter((value) => !entries.some((entry) => entry.value === value));
const report = {
  generatedAt: new Date().toISOString(),
  contractChannelCount: entries.length,
  namedHandlers: handledKeys.size,
  literalHandlers: handledLiterals.size,
  missingHandlers,
  unknownLiteralHandlers: unknownLiterals,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = missingHandlers.length || unknownLiterals.length ? 2 : 0;
