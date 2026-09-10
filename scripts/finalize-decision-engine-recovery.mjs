import fs from 'node:fs';

const path = 'electron/main/decision/DecisionEngine.ts';
let source = fs.readFileSync(path, 'utf8');
const replacements = [
  [/Object\.defineProperty\(exports, "__esModule", \{ value: true \}\);\r?\nexports\.DecisionEngine = void 0;\r?\n/, ''],
  [/const decision_1 = require\("\.\.\/\.\.\/\.\.\/shared\/types\/decision"\);/, 'import * as decision_1 from "../../../shared/types/decision";'],
  [/const market_1 = require\("\.\.\/\.\.\/\.\.\/shared\/types\/market"\);/, 'import * as market_1 from "../../../shared/types/market";'],
  [/const scanner_1 = require\("\.\.\/\.\.\/\.\.\/shared\/types\/scanner"\);/, 'import * as scanner_1 from "../../../shared/types/scanner";'],
  [/const EvidenceEngine_1 = require\("\.\/EvidenceEngine"\);/, 'import * as EvidenceEngine_1 from "./EvidenceEngine";'],
  [/const RiskEngine_1 = require\("\.\/RiskEngine"\);/, 'import * as RiskEngine_1 from "./RiskEngine";'],
  [/const ExpiryEngine_1 = require\("\.\/ExpiryEngine"\);/, 'import * as ExpiryEngine_1 from "./ExpiryEngine";'],
  [/const MarketRegimeAnalyzer_1 = require\("\.\.\/market\/MarketRegimeAnalyzer"\);/, 'import * as MarketRegimeAnalyzer_1 from "../market/MarketRegimeAnalyzer";'],
  [/exports\.DecisionEngine = DecisionEngine;\r?\nexport \{ DecisionEngine \};/, 'export { DecisionEngine };'],
];
for (const [from, to] of replacements) {
  if (!from.test(source)) throw new Error(`Recovery finalizer anchor missing: ${from}`);
  source = source.replace(from, to);
}
fs.writeFileSync(path, source, 'utf8');
console.log('Finalized DecisionEngine recovery for TypeScript module loading');
