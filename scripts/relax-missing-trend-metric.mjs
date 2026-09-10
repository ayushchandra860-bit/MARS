import fs from 'node:fs';
const path = 'electron/main/decision/DecisionEngine.ts';
let source = fs.readFileSync(path, 'utf8');
const pattern = /        if \(!metrics\) \{\n            return obs\.candles\.length >= minimumCandlesForFilter\n                \? decision_1\.WaitReason\.INSUFFICIENT_TREND_DATA\n                : null;\n        \}/;
if (!pattern.test(source)) throw new Error('Missing trend metric guard anchor not found');
source = source.replace(pattern, `        // Legacy/replay observations may predate this optional metric. They
        // continue through the existing evidence gates; a present but invalid
        // metric still fails closed below.
        if (!metrics) return null;`);
fs.writeFileSync(path, source, 'utf8');
console.log('Relaxed only the absent optional trend-metric compatibility path');
