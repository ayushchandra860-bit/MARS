import fs from 'node:fs';

const path = 'electron/main/decision/DecisionEngine.ts';
let source = fs.readFileSync(path, 'utf8');

const quantAnchor = `        const quantConfluence = quantResult.score;`;
const quantReplacement = `${quantAnchor}\n        // Trend strength is an eligibility gate, never a confidence amplifier.\n        const trendStrengthWait = this.getTrendStrengthWaitReason(obs);\n        if (trendStrengthWait) {\n            return this.wait(trendStrengthWait, evidence.overallStrength, 0, decision_1.RiskLevel.HIGH, market_1.MarketBias.NEUTRAL, expiry, obs.dataQuality, timestamp, obs.observationId);\n        }`;
if (!source.includes(quantAnchor)) throw new Error('quantitative decision anchor not found');
source = source.replace(quantAnchor, quantReplacement);

const methodAnchor = `    computeQuantConfluence(obs) {`;
const method = `    getTrendStrengthWaitReason(obs) {\n        const metrics = obs.quantitativeMetrics?.trendStrength;\n        const minimumCandlesForFilter = 29;\n        if (!metrics) {\n            return obs.candles.length >= minimumCandlesForFilter\n                ? decision_1.WaitReason.INSUFFICIENT_TREND_DATA\n                : null;\n        }\n        if (metrics.status !== 'VALID' || metrics.adx == null || metrics.choppiness == null) {\n            return decision_1.WaitReason.INSUFFICIENT_TREND_DATA;\n        }\n        const thresholds = {\n            SNIPER: { minAdx: 22, maxChoppiness: 55, blockChoppiness: 64 },\n            BALANCED: { minAdx: 18, maxChoppiness: 61.8, blockChoppiness: 68 },\n            AGGRESSIVE: { minAdx: 14, maxChoppiness: 68, blockChoppiness: 74 },\n        }[this.calibrationMode];\n        if (metrics.choppiness >= thresholds.blockChoppiness) {\n            return decision_1.WaitReason.CHOPPY_MARKET;\n        }\n        if (metrics.adx < thresholds.minAdx || metrics.choppiness > thresholds.maxChoppiness) {\n            return decision_1.WaitReason.WEAK_TREND_STRENGTH;\n        }\n        return null;\n    }\n${methodAnchor}`;
if (!source.includes(methodAnchor)) throw new Error('quant confluence method anchor not found');
source = source.replace(methodAnchor, method);

const confidenceAnchor = `        // Ranging markets: slightly penalize (no clear direction)\n        if (regime === market_1.MarketRegime.RANGING) {\n            calibrated *= 0.92;\n        }\n        return Math.min(1, Math.max(0.40, calibrated));`;
const confidenceReplacement = `        // Ranging markets: slightly penalize (no clear direction)\n        if (regime === market_1.MarketRegime.RANGING) {\n            calibrated *= 0.92;\n        }\n        // ADX/choppiness is an independent quality check, not an extra source\n        // of confidence. Missing or warming-up data can never increase it.\n        const trendStrength = obs.quantitativeMetrics?.trendStrength;\n        if (trendStrength?.status === 'VALID' && trendStrength.adx != null && trendStrength.choppiness != null) {\n            const strengthFactor = Math.max(0, Math.min(1, trendStrength.adx / 35));\n            const chopFactor = Math.max(0, Math.min(1, (75 - trendStrength.choppiness) / 35));\n            calibrated *= 0.75 + 0.25 * (strengthFactor * 0.6 + chopFactor * 0.4);\n        }\n        else {\n            calibrated *= 0.75;\n        }\n        const CONFIDENCE_CEILING = 0.95;\n        return Math.min(CONFIDENCE_CEILING, Math.max(0.40, calibrated));`;
if (!source.includes(confidenceAnchor)) throw new Error('confidence anchor not found');
source = source.replace(confidenceAnchor, confidenceReplacement);

const reasonAnchor = `        // 9. S/R confluence\n        const sr = obs.supportResistanceEvidence;`;
const reasonReplacement = `        // 8. Trend-strength / choppiness state\n        if (qm?.trendStrength?.status === 'VALID') {\n            const ts = qm.trendStrength;\n            reasons.push(\`ADX \${ts.adx?.toFixed(1) ?? '—'} | Choppiness \${ts.choppiness?.toFixed(1) ?? '—'} — \${ts.gate.toLowerCase()} gate\`);\n        }\n        // 9. S/R confluence\n        const sr = obs.supportResistanceEvidence;`;
if (!source.includes(reasonAnchor)) throw new Error('reason anchor not found');
source = source.replace(reasonAnchor, reasonReplacement);

fs.writeFileSync(path, source, 'utf8');
console.log('Patched recovered DecisionEngine safely');
