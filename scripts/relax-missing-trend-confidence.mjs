import fs from 'node:fs';
const path = 'electron/main/decision/DecisionEngine.ts';
let source = fs.readFileSync(path, 'utf8');
const oldBranch = `        else {
            calibrated *= 0.75;
        }
        const CONFIDENCE_CEILING = 0.95;`;
const newBranch = `        // Observations created before the trend-strength metric remain
        // backward compatible. Their existing evidence and data-quality gates
        // determine confidence; live scanner observations carry the metric.
        const CONFIDENCE_CEILING = 0.95;`;
if (!source.includes(oldBranch)) throw new Error('Missing trend confidence fallback anchor not found');
source = source.replace(oldBranch, newBranch);
fs.writeFileSync(path, source, 'utf8');
console.log('Removed the unintended missing-metric confidence penalty');
