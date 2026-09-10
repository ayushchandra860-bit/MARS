// ============================================================
// MARS PRO V3 — ML Engine (Real Lightweight Trained Classifier)
// Replaces the previous hardcoded if-statement "pseudo-ML" with a
// proper trained logistic-regression model over normalized technical
// features. Trained incrementally from verified completed trades
// stored in the trade journal (CalibrationDatasetManager).
//
// Readiness states (reported honestly to the UI):
//   DORMANT  — under MIN_SAMPLES (30 labeled trades), no boost applied
//   TRAINING — between MIN_SAMPLES and READY_SAMPLES (99), learning, boost capped
//   READY    — 100+ labeled trades, full live boost
//
// Models are per-asset (EUR/USD learns separately from Gold) with a
// global fallback. Retraining uses walk-forward validation: the most
// recent 20% of each asset's examples are held out, so the reported
// accuracy is an honest out-of-sample number, not a training-set score.
// ============================================================

import fs from 'fs';
import path from 'path';
import { MarketObservation } from '../../../shared/types/observation';
import { OHLC, QuantitativeEngine } from '../market/QuantitativeEngine';

export type ReadinessState = 'DORMANT' | 'TRAINING' | 'READY';

export interface FeatureVector {
  features: number[];
  label: 1 | -1;
  /** Optional per-asset key — models are trained per asset with a global fallback. */
  asset?: string;
}

/** Normalized technical feature names (fixed schema for auditability). */
export const FEATURE_NAMES = [
  'rsi',
  'rsi_oversold',
  'rsi_overbought',
  'percent_b',
  'bb_low_stretch',
  'bb_high_stretch',
  'bb_squeeze',
  'trend_bullish',
  'trend_bearish',
  'candle_momentum',
  'exhaustion_penalty',
] as const;

export const MIN_SAMPLES = 30;
export const READY_SAMPLES = 100;
/** Maximum number of labeled examples retained across all asset models. */
export const MAX_LEARNING_EXAMPLES = 1000;

/** Honest out-of-sample validation result from walk-forward retraining. */
export interface ValidationResult {
  asset: string;
  /** Fraction of held-out examples classified correctly. */
  accuracy: number;
  /** Mean of per-class recall — robust when classes are imbalanced. */
  balancedAccuracy: number;
  validationSize: number;
  trainSize: number;
  /** Fraction of held-out WIN examples correctly predicted. */
  winRecall: number;
  timestamp: number;
}

/**
 * Pure logistic regression trained via online gradient descent.
 * No external ML dependency — runs inside the Electron main process.
 */
export class TrainedClassifier {
  private weights: number[] = [];
  private bias = 0;
  private featureCount: number;
  private learningRate: number;

  constructor(featureCount: number, learningRate = 0.05) {
    this.featureCount = featureCount;
    this.learningRate = learningRate;
    // Zero-init: deterministic and mathematically sound for online SGD on balanced data.
    // Random init caused non-deterministic test failures and inconsistent model behavior.
    this.weights = new Array(featureCount).fill(0);
  }

  private sigmoid(z: number): number {
    return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));
  }

  /** Predict probability of win (label +1) for a normalized feature vector. */
  public predict(features: number[]): number {
    let z = this.bias;
    for (let i = 0; i < this.featureCount && i < features.length; i++) {
      z += this.weights[i] * features[i];
    }
    return this.sigmoid(z);
  }

  /** Train on one labeled example (online SGD with L2 regularization). */
  public trainOnce(features: number[], label: 1 | -1): void {
    const p = this.predict(features);
    // Gradient of log-loss w.r.t. weights
    const error = p - (label === 1 ? 1 : 0);
    for (let i = 0; i < this.featureCount; i++) {
      const x = features[i] || 0;
      this.weights[i] -= this.learningRate * (error * x + 0.001 * this.weights[i]);
    }
    this.bias -= this.learningRate * error;
  }

  public getWeights(): number[] {
    return [...this.weights];
  }
}

interface AssetModel {
  classifier: TrainedClassifier | null;
  sampleCount: number;
  buffer: FeatureVector[];
  retrainThreshold: number;
  validation: ValidationResult | null;
}

export class MLEngine {
  private static instance: MLEngine;

  /** Per-asset models; key '' is the global fallback model. */
  private models = new Map<string, AssetModel>();
  /** Ingestion-order index used to evict the oldest example globally. */
  private ingestionQueue: Array<{ key: string; example: FeatureVector }> = [];
  private readonly modelDefault: AssetModel = {
    classifier: null,
    sampleCount: 0,
    buffer: [],
    retrainThreshold: 25,
    validation: null,
  };

  private constructor() {}

  public static getInstance(): MLEngine {
    if (!MLEngine.instance) {
      MLEngine.instance = new MLEngine();
    }
    return MLEngine.instance;
  }

  /** Path to the persisted model file (set via setPersistencePath). */
  private persistencePath: string | null = null;

  /** Set the file path for model persistence. */
  public setPersistencePath(dbDir: string): void {
    this.persistencePath = path.join(dbDir, 'ml-engine-model.json');
    this.load();
  }

  /** Reset all learned knowledge (used in tests and manual retraining). */
  public reset(): void {
    this.models.clear();
    this.ingestionQueue = [];
    this.deletePersistedModel();
  }

  // ----------------------------------------------------------
  // Persistence: save/load model weights + metadata to disk
  // ----------------------------------------------------------

  private deletePersistedModel(): void {
    if (this.persistencePath && fs.existsSync(this.persistencePath)) {
      try { fs.unlinkSync(this.persistencePath); } catch {}
    }
  }

  /** Save the current model state to disk. */
  public save(): void {
    if (!this.persistencePath) return;
    try {
      const data: Record<string, any> = { version: 1, models: {} };
      for (const [key, model] of this.models) {
        data.models[key] = {
          sampleCount: model.buffer.length,
          retrainThreshold: 1,
          weights: model.classifier?.getWeights() ?? null,
          bias: (model.classifier as any)?.bias ?? null,
          validation: model.validation,
          buffer: model.buffer.map(v => ({
            features: v.features,
            label: v.label,
            asset: v.asset,
          })),
        };
      }
      const dir = path.dirname(this.persistencePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.persistencePath, JSON.stringify(data));
    } catch (err) {
      console.error('[MLEngine] Failed to save model:', err);
    }
  }

  /** Load model state from disk. */
  private load(): void {
    if (!this.persistencePath || !fs.existsSync(this.persistencePath)) return;
    try {
      const raw = fs.readFileSync(this.persistencePath, 'utf-8');
      const data = JSON.parse(raw);
      if (!data || data.version !== 1 || !data.models || typeof data.models !== 'object') return;
      this.models.clear();
      this.ingestionQueue = [];
      for (const [key, saved] of Object.entries(data.models) as [string, any][]) {
        if (!saved || typeof saved !== 'object') continue;
        const model = this.getModel(key);
        const sampleCount = Number(saved.sampleCount);
        const retrainThreshold = Number(saved.retrainThreshold);
        model.sampleCount = Number.isFinite(sampleCount) ? Math.max(0, Math.floor(sampleCount)) : 0;
        model.retrainThreshold = Number.isFinite(retrainThreshold) ? Math.max(1, Math.floor(retrainThreshold)) : 1;
        model.validation = saved.validation && typeof saved.validation === 'object' ? saved.validation : null;
        const validBuffer = Array.isArray(saved.buffer)
          ? saved.buffer.filter((v: any) =>
              v && Array.isArray(v.features) && v.features.length >= FEATURE_NAMES.length &&
              v.features.slice(0, FEATURE_NAMES.length).every((x: unknown) => typeof x === 'number' && Number.isFinite(x)) &&
              (v.label === 1 || v.label === -1)
            ).map((v: any) => ({
              features: v.features.slice(0, FEATURE_NAMES.length) as number[],
              label: v.label as 1 | -1,
              asset: typeof v.asset === 'string' ? v.asset : undefined,
            }))
          : [];
        model.buffer = validBuffer.slice(-MAX_LEARNING_EXAMPLES);
        // The buffer is authoritative; older persisted sampleCount values may
        // describe an unbounded pre-fix history and must not bypass the cap.
        model.sampleCount = model.buffer.length;
        for (const example of model.buffer) {
          this.ingestionQueue.push({ key, example });
        }
        if (Array.isArray(saved.weights) && saved.weights.length === FEATURE_NAMES.length && typeof saved.bias === 'number') {
          const classifier = new TrainedClassifier(FEATURE_NAMES.length);
          (classifier as any).weights = [...saved.weights];
          (classifier as any).bias = saved.bias;
          model.classifier = classifier;
        }
      }
      this.enforceLearningBufferLimit();
      for (const [key, model] of this.models) {
        model.sampleCount = model.buffer.length;
      }
      console.log(`[MLEngine] Loaded persisted model (${this.totalSamples()} samples across ${this.models.size} assets)`);
    } catch (err) {
      console.error('[MLEngine] Failed to load model:', err);
    }
  }

  /** Feed completed trade into training pipeline. Called when a trade reaches terminal state. */
  public ingestCompletedTrade(params: {
    features: number[];
    outcome: 'WIN' | 'LOSS';
    asset?: string;
  }): void {
    const label: 1 | -1 = params.outcome === 'WIN' ? 1 : -1;
    this.ingestLabeledExamples([{
      features: params.features,
      label,
      asset: params.asset,
    }]);
    this.save();
  }

  private keyFor(asset?: string | null): string {
    return asset && asset !== 'UNKNOWN' && asset !== 'unknown' ? asset : '';
  }

  private getModel(asset?: string | null): AssetModel {
    const key = this.keyFor(asset);
    let model = this.models.get(key);
    if (!model) {
      // CRITICAL: buffer must be a fresh array, not shared via shallow copy.
      // The previous `{ ...this.modelDefault }` shared the same buffer[] reference
      // across all per-asset models, causing cross-contamination of training data.
        model = {
          classifier: null,
          sampleCount: 0,
          buffer: [],
          retrainThreshold: 1,
          validation: null,
        };
      this.models.set(key, model);
    }
    return model;
  }

  private totalSamples(): number {
    let total = 0;
    for (const m of this.models.values()) total += m.sampleCount;
    return total;
  }

  public getReadiness(asset?: string | null): ReadinessState {
    const n = asset ? this.getModel(asset).sampleCount : this.totalSamples();
    if (n < MIN_SAMPLES) return 'DORMANT';
    if (n < READY_SAMPLES) return 'TRAINING';
    return 'READY';
  }

  public getSampleCount(asset?: string | null): number {
    return asset ? this.getModel(asset).sampleCount : this.totalSamples();
  }

  /** True once at least one valid labeled example has produced a classifier. */
  public hasTrainedModel(asset?: string | null): boolean {
    if (asset) return Boolean(this.getModel(asset).classifier && this.getModel(asset).sampleCount > 0);
    return Array.from(this.models.values()).some((model) => Boolean(model.classifier && model.sampleCount > 0));
  }

  /**
   * Feed verified trade outcomes from the calibration dataset.
   * `examples` are (featureVector, label) pairs derived from completed trades,
   * optionally tagged with the asset so each instrument learns its own model.
   * Labels: +1 if the price moved in the entry direction (WIN), -1 otherwise (LOSS).
   * Draws are intentionally ignored.
   */
  /** Reconcile persisted model state with the authoritative completed-trade history. */
  public hydrateFromCompletedTrades(examples: FeatureVector[]): void {
    this.models.clear();
    this.ingestionQueue = [];
    this.ingestLabeledExamples(examples);
  }

  public ingestLabeledExamples(examples: FeatureVector[]): void {
    const grouped = new Map<string, FeatureVector[]>();
    for (const ex of examples || []) {
      if (!ex || !Array.isArray(ex.features) || ex.features.length < FEATURE_NAMES.length) continue;
      if (ex.label !== 1 && ex.label !== -1) continue;
      if (!ex.features.slice(0, FEATURE_NAMES.length).every((value) => typeof value === 'number' && Number.isFinite(value))) continue;
      const key = this.keyFor(ex.asset);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(ex);
    }
    for (const [key, group] of grouped) {
      const model = this.getModel(key);
      for (const ex of group) {
        const normalized: FeatureVector = {
          features: ex.features.slice(0, FEATURE_NAMES.length),
          label: ex.label,
          asset: ex.asset,
        };
        model.buffer.push(normalized);
        model.sampleCount = model.buffer.length;
        this.ingestionQueue.push({ key, example: normalized });
        this.enforceLearningBufferLimit();
      }
      // Continuous learning is intentional: every accepted outcome causes a
      // fresh bounded walk-forward update, including trade one.
      this.retrain(key);
    }
    this.save();
  }

  /**
   * Retrain a single asset model from its accumulated buffer with
   * walk-forward validation: the most recent 20% is held out, the model is
   * trained on the earlier 80%, and accuracy is measured on the holdout.
   */
  private retrain(asset: string): void {
    const model = this.getModel(asset);
    const buffer = model.buffer.slice();
    const validationSize = Math.max(1, Math.round(buffer.length * 0.2));
    const trainBuf = buffer.slice(0, buffer.length - validationSize);
    const validationBuf = buffer.slice(buffer.length - validationSize);

    // Balance the training set to avoid majority-class bias.
    const wins = trainBuf.filter((e) => e.label === 1);
    const losses = trainBuf.filter((e) => e.label === -1);
    const n = Math.min(wins.length, losses.length);
    const balanced: FeatureVector[] = [];
    for (let i = 0; i < n; i++) {
      balanced.push(wins[i], losses[i]);
    }

    // Train from scratch on the balanced training portion.
    const classifier = new TrainedClassifier(FEATURE_NAMES.length);
    for (let epoch = 0; epoch < 3; epoch++) {
      for (const ex of balanced) {
        classifier.trainOnce(ex.features, ex.label);
      }
    }
    model.classifier = classifier;

    // Walk-forward validation on the untouched holdout.
    if (validationBuf.length >= 5) {
      let correct = 0;
      let winCorrect = 0;
      let winTotal = 0;
      for (const ex of validationBuf) {
        const p = classifier.predict(ex.features);
        const predicted: 1 | -1 = p >= 0.5 ? 1 : -1;
        if (predicted === ex.label) correct++;
        if (ex.label === 1) {
          winTotal++;
          if (predicted === 1) winCorrect++;
        }
      }
      const lossTotal = validationBuf.length - winTotal;
      const winRecall = winTotal ? winCorrect / winTotal : 0;
      // Balanced accuracy = mean of per-class recall (robust to imbalance).
      const lossRecall = lossTotal ? (correct - winCorrect) / lossTotal : 1;
      model.validation = {
        asset,
        accuracy: Math.round((correct / validationBuf.length) * 1000) / 1000,
        balancedAccuracy: Math.round(((winRecall + lossRecall) / 2) * 1000) / 1000,
        validationSize: validationBuf.length,
        trainSize: balanced.length,
        winRecall: Math.round(winRecall * 1000) / 1000,
        timestamp: Date.now(),
      };
    }

    // The global FIFO is the retention authority. Keep the model count aligned
    // with its actual retained examples after every retraining pass.
    model.sampleCount = model.buffer.length;
    model.retrainThreshold = 1;
    this.save();
  }

  private enforceLearningBufferLimit(): void {
    while (this.ingestionQueue.length > MAX_LEARNING_EXAMPLES) {
      const oldest = this.ingestionQueue.shift();
      if (!oldest) break;
      const model = this.models.get(oldest.key);
      if (!model) continue;
      const index = model.buffer.indexOf(oldest.example);
      if (index >= 0) model.buffer.splice(index, 1);
      model.sampleCount = model.buffer.length;
    }
  }

  /** Pick the best model for a live observation: exact asset, else global. */
  private selectModel(asset?: string | null): { key: string; model: AssetModel } | null {
    const exactKey = this.keyFor(asset);
    const exact = this.models.get(exactKey);
    if (exact && exact.sampleCount > 0 && exact.classifier) return { key: exactKey, model: exact };
    const global = this.models.get('');
    if (global && global.sampleCount > 0 && global.classifier) return { key: '', model: global };
    return null;
  }

  /** Honest out-of-sample validation results (one per asset). */
  public getValidationReport(): ValidationResult[] {
    const out: ValidationResult[] = [];
    for (const [asset, model] of this.models) {
      if (model.validation) {
        out.push({ ...model.validation, asset: asset || 'GLOBAL' });
      }
    }
    return out;
  }

  /**
   * Build the normalized feature vector from the live observation + candles.
   * All values are clamped to [0,1] so the model is scale-invariant.
   */
  public extractFeatures(
    observation: MarketObservation,
    candleBuffer?: OHLC[]
  ): number[] {
    const rsi = observation.quantitativeMetrics?.rsi?.value ?? 50;
    const isOversold = observation.quantitativeMetrics?.rsi?.isOversold ?? false;
    const isOverbought = observation.quantitativeMetrics?.rsi?.isOverbought ?? false;
    const percentB = observation.quantitativeMetrics?.bollingerBands?.percentB ?? 0.5;
    const isSqueeze = observation.quantitativeMetrics?.bollingerBands?.isSqueeze ?? false;
    const trend = observation.trendEvidence?.direction;

    // Candle momentum: normalized recent close slope
    let candleMomentum = 0.5;
    if (candleBuffer && candleBuffer.length >= 10) {
      const closes = candleBuffer.slice(-10).map((c) => c.close);
      const first = closes[0] || 0;
      const last = closes[closes.length - 1] || 0;
      if (first > 0) {
        const change = last / first - 1;
        candleMomentum = Math.min(1, Math.max(0, 0.5 + change * 20));
      }
    }

    // Exhaustion penalty: bullish trend + very high RSI (or vice versa)
    let exhaustion = 0;
    if (rsi > 72 && trend === 'BULLISH') exhaustion = 1;
    else if (rsi < 28 && trend === 'BEARISH') exhaustion = 1;

    return [
      Math.max(0, Math.min(1, rsi / 100)),
      isOversold ? 1 : 0,
      isOverbought ? 1 : 0,
      Math.max(0, Math.min(1, percentB)),
      percentB < 0.05 ? 1 : 0,
      percentB > 0.95 ? 1 : 0,
      isSqueeze ? 1 : 0,
      trend === 'BULLISH' ? 1 : 0,
      trend === 'BEARISH' ? 1 : 0,
      candleMomentum,
      exhaustion,
    ];
  }

  /**
   * Public API: evaluates win probability for the given observation.
   * When a trained model (per-asset or global) is available, the learned
   * probability is blended with the heuristic baseline; otherwise a heuristic
   * fallback is used and no confidence boost is emitted.
   */
  public evaluateWinProbability(
    observation: MarketObservation,
    candleBuffer?: OHLC[]
  ): {
    probability: number;
    confidenceBoost: number;
    keyFactors: string[];
    readiness: ReadinessState;
    sampleSize: number;
  } {
    const keyFactors: string[] = [];
    let probability = 0.5;

    const rsiVal = observation.quantitativeMetrics?.rsi?.value ?? 50;
    const isOversold = observation.quantitativeMetrics?.rsi?.isOversold ?? false;
    const isOverbought = observation.quantitativeMetrics?.rsi?.isOverbought ?? false;
    const percentB = observation.quantitativeMetrics?.bollingerBands?.percentB ?? 0.5;
    const isSqueeze = observation.quantitativeMetrics?.bollingerBands?.isSqueeze ?? false;
    const trend = observation.trendEvidence?.direction;

    let pillarConfluenceCount = 0;

    if (isOversold) {
      probability += 0.12;
      pillarConfluenceCount++;
      keyFactors.push('RSI Oversold Reversal Signal');
    } else if (isOverbought) {
      probability += 0.12;
      pillarConfluenceCount++;
      keyFactors.push('RSI Overbought Reversal Signal');
    }
    if (percentB < 0.05) {
      probability += 0.10;
      pillarConfluenceCount++;
      keyFactors.push('Bollinger Lower Band Stretch');
    } else if (percentB > 0.95) {
      probability += 0.10;
      pillarConfluenceCount++;
      keyFactors.push('Bollinger Upper Band Stretch');
    }
    if (isSqueeze) {
      probability += 0.08;
      pillarConfluenceCount++;
      keyFactors.push('Volatility Squeeze Setup');
    }
    if (trend === 'BULLISH' || trend === 'BEARISH') {
      probability += 0.08;
      pillarConfluenceCount++;
      keyFactors.push(`Strong ${trend} Trend Alignment`);
    }
    if (candleBuffer && candleBuffer.length >= 10) {
      const recent = candleBuffer.slice(-3);
      const bullCount = recent.filter((c) => c.close > c.open).length;
      const bearCount = recent.filter((c) => c.close < c.open).length;
      if (bullCount >= 2 && trend === 'BULLISH') {
        probability += 0.08;
        pillarConfluenceCount++;
        keyFactors.push('Multi-Candle Bullish Confirmation');
      } else if (bearCount >= 2 && trend === 'BEARISH') {
        probability += 0.08;
        pillarConfluenceCount++;
        keyFactors.push('Multi-Candle Bearish Confirmation');
      }
    }

    // Heuristic baseline clamp (kept as the safety floor for dormant models)
    // Uncalibrated heuristic/ML output is a ranking signal, not a guarantee.
    // Keep it below the empirical calibration ceiling used by the journal.
    probability = Math.min(0.95, Math.max(0.10, probability));

    const selected = this.selectModel(observation.asset);
    const readiness = selected ? this.readinessFor(selected.model.sampleCount) : this.getReadiness();
    const sampleSize = selected ? selected.model.sampleCount : this.totalSamples();

    if (!selected) {
      // Not enough verified outcomes yet — heuristic only, no boost.
      if (keyFactors.length === 0) keyFactors.push('Awaiting training data: trade more with the journal active.');
      return {
        probability: Math.round(probability * 100) / 100,
        confidenceBoost: 0,
        keyFactors,
        readiness,
        sampleSize,
      };
    }

    const { key: modelKey, model } = selected;
    const features = this.extractFeatures(observation, candleBuffer);

    let learnedProbability = 0.5;
    if (model.classifier) {
      learnedProbability = model.classifier.predict(features);
      // Sanity cap: learned output must stay within plausible range
      learnedProbability = Math.min(0.90, Math.max(0.20, learnedProbability));
    }

    // Blend learned vs heuristic: weight learned more as sample size grows
    const learnWeight = readiness === 'READY'
      ? 0.6
      : readiness === 'TRAINING'
        ? 0.3 + 0.3 * ((model.sampleCount - MIN_SAMPLES) / (READY_SAMPLES - MIN_SAMPLES))
        : Math.min(0.15, 0.05 + model.sampleCount / (MIN_SAMPLES * 20));
    const blended = learnedProbability * learnWeight + probability * (1 - learnWeight);
    probability = Math.min(0.95, Math.max(0.10, blended));

    const assetLabel = modelKey || 'GLOBAL';
    if (readiness === 'DORMANT') keyFactors.push(`ML warming ${assetLabel} (n=${model.sampleCount})`);
    else if (readiness === 'TRAINING') keyFactors.push(`ML learning ${assetLabel} (n=${model.sampleCount})`);
    else keyFactors.push(`ML model ready ${assetLabel} (n=${model.sampleCount})`);

    // Boost only when the trained model AND at least 2 heuristic pillars agree
    const trainedWinning = model.classifier ? model.classifier.predict(features) > 0.55 : false;
    const confidenceBoost = readiness !== 'DORMANT' &&
      probability >= 0.68 && pillarConfluenceCount >= 2 && trainedWinning ? 0.06 : 0;

    if (rsiVal > 72 && trend === 'BULLISH') {
      probability = Math.max(0.10, probability - 0.15);
      keyFactors.push('Bullish exhaustion risk');
    } else if (rsiVal < 28 && trend === 'BEARISH') {
      probability = Math.max(0.10, probability - 0.15);
      keyFactors.push('Bearish exhaustion risk');
    }

    return {
      probability: Math.round(probability * 100) / 100,
      confidenceBoost,
      keyFactors,
      readiness,
      sampleSize,
    };
  }
  private readinessFor(sampleCount: number): ReadinessState {
    if (sampleCount < MIN_SAMPLES) return 'DORMANT';
    if (sampleCount < READY_SAMPLES) return 'TRAINING';
    return 'READY';
  }
}
