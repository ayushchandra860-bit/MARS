import fs from 'node:fs';

const decisionPath = 'electron/main/decision/DecisionEngine.ts';
const decision = fs.readFileSync(decisionPath, 'utf8');
const oldDecision = `    // Regime penalty: choppy/high-vol markets are unreliable\n    if (regime === MarketRegime.HIGH_VOLATILITY || regime === MarketRegime.CHOPPY) {\n      calibrated *= 0.85;\n    }`;
const newDecision = `    // Regime penalty: choppy/high-vol markets are unreliable\n    if (regime === MarketRegime.HIGH_VOLATILITY || regime === MarketRegime.CHOPPY) {\n      calibrated *= 0.85;\n    }\n\n    // ADX/choppiness is an independent quality check, not an extra source of\n    // confidence. A missing or warming-up metric can never increase a score.\n    const trendStrength = obs.quantitativeMetrics?.trendStrength;\n    if (trendStrength?.status === 'VALID' && trendStrength.adx != null && trendStrength.choppiness != null) {\n      const strengthFactor = Math.max(0, Math.min(1, trendStrength.adx / 35));\n      const chopFactor = Math.max(0, Math.min(1, (75 - trendStrength.choppiness) / 35));\n      calibrated *= 0.75 + 0.25 * (strengthFactor * 0.6 + chopFactor * 0.4);\n    } else {\n      calibrated *= 0.75;\n    }\n\n    // A signal score is not a guarantee. Keep the UI and persisted records\n    // below the 95% empirical-calibration ceiling used by the journal.\n    const CONFIDENCE_CEILING = 0.95;`;
if (!decision.includes(oldDecision)) throw new Error('DecisionEngine confidence anchor not found');
const patchedDecision = decision.replace(oldDecision, newDecision).replace(
  '    return Math.min(1, Math.max(0.40, calibrated));',
  '    return Math.min(CONFIDENCE_CEILING, Math.max(0.40, calibrated));',
);
fs.writeFileSync(decisionPath, patchedDecision);

const mlPath = 'electron/main/decision/MLEngine.ts';
const ml = fs.readFileSync(mlPath, 'utf8');
const oldMl = '    probability = Math.min(0.96, Math.max(0.10, probability));';
const newMl = `    // Uncalibrated heuristic/ML output is a ranking signal, not a guarantee.\n    // Keep it below the journal calibration ceiling until empirical outcomes\n    // support a lower or higher mapping.\n    probability = Math.min(0.95, Math.max(0.10, probability));`;
if (!ml.includes(oldMl)) throw new Error('MLEngine probability clamp anchor not found');
fs.writeFileSync(mlPath, ml.replace(oldMl, newMl).replace(
  '      learnedProbability = Math.min(0.92, Math.max(0.18, learnedProbability));',
  '      learnedProbability = Math.min(0.90, Math.max(0.20, learnedProbability));',
));
console.log('Applied confidence ceiling patch to DecisionEngine and MLEngine');
