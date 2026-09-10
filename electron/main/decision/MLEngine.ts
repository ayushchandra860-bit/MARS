// ============================================================
// MARS PRO V3 — Action-aware, quality-gated lightweight ML engine
// Probability always means P(the explicitly supplied BUY/SELL action wins).
// DORMANT models never influence output. TRAINING/READY models are blended
// only after a useful walk-forward holdout passes the quality gate.
// ============================================================

import fs from 'fs';
import path from 'path';
import { MarketObservation } from '../../../shared/types/observation';
import { TradingAction } from '../../../shared/types/decision';
import { OHLC } from '../market/QuantitativeEngine';

export type ReadinessState = 'DORMANT' | 'TRAINING' | 'READY';
export type ActionableDirection = TradingAction.BUY | TradingAction.SELL;

export interface FeatureVector {
  features: number[];
  label: 1 | -1;
  action: ActionableDirection;
  asset?: string;
}

export const FEATURE_NAMES = [
  'rsi_for_action',
  'rsi_supports_action',
  'rsi_opposes_action',
  'percent_b_for_action',
  'bb_supports_action',
  'bb_opposes_action',
  'bb_squeeze',
  'trend_supports_action',
  'trend_opposes_action',
  'candle_momentum_for_action',
  'exhaustion_penalty',
] as const;

export const MIN_SAMPLES = 30;
export const READY_SAMPLES = 100;
export const MAX_LEARNING_EXAMPLES = 1000;
const MIN_VALIDATION_SIZE = 10;
const MIN_TRAINING_BALANCED_ACCURACY = 0.52;
const MIN_READY_BALANCED_ACCURACY = 0.55;

export interface ValidationResult {
  asset: string;
  accuracy: number;
  balancedAccuracy: number;
  validationSize: number;
  trainSize: number;
  winRecall: number;
  lossRecall: number;
  timestamp: number;
}

export class TrainedClassifier {
  private weights: number[];
  private bias = 0;

  constructor(private readonly featureCount: number, private readonly learningRate = 0.05) {
    this.weights = new Array(featureCount).fill(0);
  }

  private sigmoid(value: number): number {
    return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, value))));
  }

  public predict(features: number[]): number {
    let value = this.bias;
    for (let index = 0; index < this.featureCount; index++) {
      value += this.weights[index] * (features[index] || 0);
    }
    return this.sigmoid(value);
  }

  public trainOnce(features: number[], label: 1 | -1): void {
    const error = this.predict(features) - (label === 1 ? 1 : 0);
    for (let index = 0; index < this.featureCount; index++) {
      const input = features[index] || 0;
      this.weights[index] -= this.learningRate * (error * input + 0.001 * this.weights[index]);
    }
    this.bias -= this.learningRate * error;
  }

  public snapshot(): { weights: number[]; bias: number } {
    return { weights: [...this.weights], bias: this.bias };
  }

  public restore(weights: number[], bias: number): boolean {
    if (weights.length !== this.featureCount || !weights.every(Number.isFinite) || !Number.isFinite(bias)) return false;
    this.weights = [...weights];
    this.bias = bias;
    return true;
  }
}

interface StoredExample {
  features: number[];
  label: 1 | -1;
  action: ActionableDirection;
  asset?: string;
}

interface AssetModel {
  classifier: TrainedClassifier | null;
  buffer: StoredExample[];
  validation: ValidationResult | null;
}

export interface WinProbabilityResult {
  /** Ratio in the inclusive 0..1 scale. */
  probability: number;
  /** Ratio added by downstream confidence logic; also in 0..1 scale. */
  confidenceBoost: number;
  keyFactors: string[];
  readiness: ReadinessState;
  sampleSize: number;
  modelApplied: boolean;
  validationPassed: boolean;
  selectedModel: string | null;
  probabilityMeaning: 'ACTION_WIN_PROBABILITY';
  probabilityScale: 'RATIO_0_1';
}

export class MLEngine {
  private static instance: MLEngine;
  private models = new Map<string, AssetModel>();
  private ingestionQueue: Array<{ key: string; example: StoredExample }> = [];
  private persistencePath: string | null = null;

  private constructor() {}

  public static getInstance(): MLEngine {
    if (!MLEngine.instance) MLEngine.instance = new MLEngine();
    return MLEngine.instance;
  }

  public setPersistencePath(dbDir: string): void {
    this.persistencePath = path.join(dbDir, 'ml-engine-model.json');
    this.load();
  }

  public reset(): void {
    this.models.clear();
    this.ingestionQueue = [];
    if (this.persistencePath && fs.existsSync(this.persistencePath)) {
      try { fs.unlinkSync(this.persistencePath); } catch {}
    }
  }

  private keyFor(asset?: string | null): string {
    const normalized = String(asset || '').trim();
    return normalized && normalized.toUpperCase() !== 'UNKNOWN' ? normalized.toUpperCase() : '';
  }

  private getModelByKey(key: string): AssetModel {
    let model = this.models.get(key);
    if (!model) {
      model = { classifier: null, buffer: [], validation: null };
      this.models.set(key, model);
    }
    return model;
  }

  private readinessFor(sampleCount: number): ReadinessState {
    if (sampleCount < MIN_SAMPLES) return 'DORMANT';
    if (sampleCount < READY_SAMPLES) return 'TRAINING';
    return 'READY';
  }

  private totalSamples(): number {
    return this.ingestionQueue.length;
  }

  public getReadiness(asset?: string | null): ReadinessState {
    if (asset) return this.readinessFor(this.models.get(this.keyFor(asset))?.buffer.length || 0);
    let strongestAssetCount = this.models.get('')?.buffer.length || 0;
    for (const [key, model] of this.models) {
      if (key) strongestAssetCount = Math.max(strongestAssetCount, model.buffer.length);
    }
    return this.readinessFor(strongestAssetCount);
  }

  public getSampleCount(asset?: string | null): number {
    return asset ? this.models.get(this.keyFor(asset))?.buffer.length || 0 : this.totalSamples();
  }

  public hasTrainedModel(asset?: string | null): boolean {
    if (asset) return Boolean(this.models.get(this.keyFor(asset))?.classifier);
    return Array.from(this.models.values()).some((model) => Boolean(model.classifier));
  }

  public save(): void {
    if (!this.persistencePath) return;
    try {
      const models: Record<string, unknown> = {};
      for (const [key, model] of this.models) {
        const snapshot = model.classifier?.snapshot() || null;
        models[key] = {
          weights: snapshot?.weights || null,
          bias: snapshot?.bias ?? null,
          validation: model.validation,
          buffer: model.buffer,
        };
      }
      const directory = path.dirname(this.persistencePath);
      fs.mkdirSync(directory, { recursive: true });
      const tempPath = `${this.persistencePath}.tmp-${process.pid}`;
      fs.writeFileSync(tempPath, JSON.stringify({ version: 2, models }), { encoding: 'utf8', mode: 0o600 });
      try { fs.renameSync(tempPath, this.persistencePath); }
      catch {
        fs.rmSync(this.persistencePath, { force: true });
        fs.renameSync(tempPath, this.persistencePath);
      }
    } catch (error) {
      console.error('[MLEngine] Failed to save model:', error);
    }
  }

  private load(): void {
    if (!this.persistencePath || !fs.existsSync(this.persistencePath)) return;
    try {
      const stats = fs.statSync(this.persistencePath);
      if (!stats.isFile() || stats.size <= 0 || stats.size > 10 * 1024 * 1024) throw new Error('Model file size is invalid.');
      const data = JSON.parse(fs.readFileSync(this.persistencePath, 'utf8'));
      // Version 1 lacked action provenance; it is deliberately not trusted.
      if (!data || data.version !== 2 || !data.models || typeof data.models !== 'object') return;
      this.models.clear();
      this.ingestionQueue = [];

      for (const [key, saved] of Object.entries(data.models) as Array<[string, any]>) {
        if (!saved || typeof saved !== 'object' || !Array.isArray(saved.buffer)) continue;
        const model = this.getModelByKey(key);
        for (const value of saved.buffer) {
          if (!value || !Array.isArray(value.features) || value.features.length < FEATURE_NAMES.length) continue;
          if (!value.features.slice(0, FEATURE_NAMES.length).every((item: unknown) => typeof item === 'number' && Number.isFinite(item))) continue;
          if (value.label !== 1 && value.label !== -1) continue;
          if (value.action !== TradingAction.BUY && value.action !== TradingAction.SELL) continue;
          const example: StoredExample = {
            features: value.features.slice(0, FEATURE_NAMES.length),
            label: value.label,
            action: value.action,
            asset: typeof value.asset === 'string' ? value.asset : undefined,
          };
          model.buffer.push(example);
          this.ingestionQueue.push({ key, example });
        }
        model.validation = this.validateSavedValidation(saved.validation, key);
        if (Array.isArray(saved.weights) && typeof saved.bias === 'number') {
          const classifier = new TrainedClassifier(FEATURE_NAMES.length);
          if (classifier.restore(saved.weights, saved.bias)) model.classifier = classifier;
        }
      }
      this.enforceLearningBufferLimit();
    } catch (error) {
      console.error('[MLEngine] Ignoring unreadable persisted model:', error);
      this.models.clear();
      this.ingestionQueue = [];
    }
  }

  private validateSavedValidation(value: unknown, key: string): ValidationResult | null {
    if (!value || typeof value !== 'object') return null;
    const input = value as Partial<ValidationResult>;
    const numbers = [input.accuracy, input.balancedAccuracy, input.validationSize, input.trainSize, input.winRecall, input.lossRecall, input.timestamp];
    if (!numbers.every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
    return { ...(input as ValidationResult), asset: key };
  }

  public ingestCompletedTrade(params: {
    features: number[];
    outcome: 'WIN' | 'LOSS';
    action: ActionableDirection;
    asset?: string;
  }): void {
    this.ingestLabeledExamples([{
      features: params.features,
      label: params.outcome === 'WIN' ? 1 : -1,
      action: params.action,
      asset: params.asset,
    }]);
  }

  public hydrateFromCompletedTrades(examples: FeatureVector[]): void {
    this.models.clear();
    this.ingestionQueue = [];
    this.ingestLabeledExamples(examples);
  }

  public ingestLabeledExamples(examples: FeatureVector[]): void {
    const touched = new Set<string>();
    for (const input of examples || []) {
      if (!input || !Array.isArray(input.features) || input.features.length < FEATURE_NAMES.length) continue;
      if (!input.features.slice(0, FEATURE_NAMES.length).every((value) => typeof value === 'number' && Number.isFinite(value))) continue;
      if (input.label !== 1 && input.label !== -1) continue;
      if (input.action !== TradingAction.BUY && input.action !== TradingAction.SELL) continue;
      const key = this.keyFor(input.asset);
      const model = this.getModelByKey(key);
      const example: StoredExample = {
        features: this.orientFeaturesForAction(input.features, input.action),
        label: input.label,
        action: input.action,
        asset: input.asset,
      };
      model.buffer.push(example);
      this.ingestionQueue.push({ key, example });
      touched.add(key);
      this.enforceLearningBufferLimit();
    }
    for (const key of touched) this.retrain(key);
    if (touched.size > 0) this.save();
  }

  private enforceLearningBufferLimit(): void {
    while (this.ingestionQueue.length > MAX_LEARNING_EXAMPLES) {
      const oldest = this.ingestionQueue.shift();
      if (!oldest) break;
      const model = this.models.get(oldest.key);
      const index = model?.buffer.indexOf(oldest.example) ?? -1;
      if (model && index >= 0) model.buffer.splice(index, 1);
    }
  }

  private retrain(key: string): void {
    const model = this.getModelByKey(key);
    const validationSize = Math.max(1, Math.floor(model.buffer.length * 0.2));
    const train = model.buffer.slice(0, -validationSize);
    const validation = model.buffer.slice(-validationSize);
    const wins = train.filter((example) => example.label === 1);
    const losses = train.filter((example) => example.label === -1);
    const balancedCount = Math.min(wins.length, losses.length);
    if (balancedCount === 0) {
      model.classifier = null;
      model.validation = null;
      return;
    }

    const balanced: StoredExample[] = [];
    for (let index = 0; index < balancedCount; index++) balanced.push(wins[index], losses[index]);
    const classifier = new TrainedClassifier(FEATURE_NAMES.length);
    for (let epoch = 0; epoch < 4; epoch++) {
      for (const example of balanced) classifier.trainOnce(example.features, example.label);
    }
    model.classifier = classifier;

    let correct = 0;
    let winCorrect = 0;
    let lossCorrect = 0;
    let winTotal = 0;
    let lossTotal = 0;
    for (const example of validation) {
      const predicted = classifier.predict(example.features) >= 0.5 ? 1 : -1;
      if (predicted === example.label) correct++;
      if (example.label === 1) {
        winTotal++;
        if (predicted === 1) winCorrect++;
      } else {
        lossTotal++;
        if (predicted === -1) lossCorrect++;
      }
    }
    const winRecall = winTotal > 0 ? winCorrect / winTotal : 0;
    const lossRecall = lossTotal > 0 ? lossCorrect / lossTotal : 0;
    model.validation = {
      asset: key,
      accuracy: validation.length > 0 ? correct / validation.length : 0,
      balancedAccuracy: winTotal > 0 && lossTotal > 0 ? (winRecall + lossRecall) / 2 : 0,
      validationSize: validation.length,
      trainSize: balanced.length,
      winRecall,
      lossRecall,
      timestamp: Date.now(),
    };
  }

  public getValidationReport(): ValidationResult[] {
    const output: ValidationResult[] = [];
    for (const [key, model] of this.models) {
      if (model.validation) output.push({ ...model.validation, asset: key || 'GLOBAL' });
    }
    return output;
  }

  private selectModel(asset?: string | null): { key: string; model: AssetModel } | null {
    const exactKey = this.keyFor(asset);
    const exact = exactKey ? this.models.get(exactKey) : undefined;
    if (exact && exact.buffer.length > 0) return { key: exactKey, model: exact };
    const global = this.models.get('');
    return global && global.buffer.length > 0 ? { key: '', model: global } : null;
  }

  private passesValidation(model: AssetModel, readiness: ReadinessState): boolean {
    if (readiness === 'DORMANT' || !model.classifier || !model.validation) return false;
    if (model.validation.validationSize < MIN_VALIDATION_SIZE || model.validation.trainSize < 20) return false;
    const threshold = readiness === 'READY' ? MIN_READY_BALANCED_ACCURACY : MIN_TRAINING_BALANCED_ACCURACY;
    return model.validation.balancedAccuracy >= threshold;
  }

  public extractFeatures(observation: MarketObservation, candleBuffer?: OHLC[]): number[] {
    const rsi = observation.quantitativeMetrics?.rsi?.value ?? 50;
    const oversold = observation.quantitativeMetrics?.rsi?.isOversold ?? false;
    const overbought = observation.quantitativeMetrics?.rsi?.isOverbought ?? false;
    const percentB = observation.quantitativeMetrics?.bollingerBands?.percentB ?? 0.5;
    const squeeze = observation.quantitativeMetrics?.bollingerBands?.isSqueeze ?? false;
    const trend = observation.trendEvidence?.direction;
    let momentum = 0.5;
    if (candleBuffer && candleBuffer.length >= 10) {
      const closes = candleBuffer.slice(-10).map((candle) => candle.close);
      if (closes[0] > 0) momentum = Math.max(0, Math.min(1, 0.5 + (closes.at(-1)! / closes[0] - 1) * 20));
    }
    const exhaustion = (rsi > 72 && trend === 'BULLISH') || (rsi < 28 && trend === 'BEARISH') ? 1 : 0;
    return [
      Math.max(0, Math.min(1, rsi / 100)), oversold ? 1 : 0, overbought ? 1 : 0,
      Math.max(0, Math.min(1, percentB)), percentB < 0.05 ? 1 : 0, percentB > 0.95 ? 1 : 0,
      squeeze ? 1 : 0, trend === 'BULLISH' ? 1 : 0, trend === 'BEARISH' ? 1 : 0,
      momentum, exhaustion,
    ];
  }

  public orientFeaturesForAction(features: number[], action: ActionableDirection): number[] {
    const raw = features.slice(0, FEATURE_NAMES.length);
    if (action === TradingAction.BUY) return raw;
    return [
      1 - raw[0], raw[2], raw[1], 1 - raw[3], raw[5], raw[4], raw[6],
      raw[8], raw[7], 1 - raw[9], raw[10],
    ].map((value) => Math.max(0, Math.min(1, Number(value) || 0)));
  }

  public evaluateWinProbability(
    observation: MarketObservation,
    action: TradingAction,
    candleBuffer?: OHLC[],
  ): WinProbabilityResult {
    const keyFactors: string[] = [];
    const selected = this.selectModel(observation.asset);
    const readiness = selected ? this.readinessFor(selected.model.buffer.length) : this.getReadiness(observation.asset);
    const sampleSize = selected?.model.buffer.length || 0;

    if (action !== TradingAction.BUY && action !== TradingAction.SELL) {
      return {
        probability: 0.5, confidenceBoost: 0, keyFactors: ['No actionable BUY/SELL direction supplied.'],
        readiness, sampleSize, modelApplied: false, validationPassed: false,
        selectedModel: selected ? selected.key || 'GLOBAL' : null,
        probabilityMeaning: 'ACTION_WIN_PROBABILITY', probabilityScale: 'RATIO_0_1',
      };
    }

    let probability = 0.5;
    let supportingPillars = 0;
    const rsi = observation.quantitativeMetrics?.rsi;
    const bollinger = observation.quantitativeMetrics?.bollingerBands;
    const trend = observation.trendEvidence?.direction;

    if (rsi?.isOversold) {
      probability += action === TradingAction.BUY ? 0.12 : -0.08;
      keyFactors.push(action === TradingAction.BUY ? 'Oversold RSI supports BUY' : 'Oversold RSI opposes SELL');
      if (action === TradingAction.BUY) supportingPillars++;
    } else if (rsi?.isOverbought) {
      probability += action === TradingAction.SELL ? 0.12 : -0.08;
      keyFactors.push(action === TradingAction.SELL ? 'Overbought RSI supports SELL' : 'Overbought RSI opposes BUY');
      if (action === TradingAction.SELL) supportingPillars++;
    }

    if (bollinger && bollinger.percentB < 0.05) {
      probability += action === TradingAction.BUY ? 0.10 : -0.06;
      if (action === TradingAction.BUY) supportingPillars++;
    } else if (bollinger && bollinger.percentB > 0.95) {
      probability += action === TradingAction.SELL ? 0.10 : -0.06;
      if (action === TradingAction.SELL) supportingPillars++;
    }
    if (bollinger?.isSqueeze) probability += 0.03;

    const trendSupports = (action === TradingAction.BUY && trend === 'BULLISH')
      || (action === TradingAction.SELL && trend === 'BEARISH');
    const trendOpposes = (action === TradingAction.BUY && trend === 'BEARISH')
      || (action === TradingAction.SELL && trend === 'BULLISH');
    if (trendSupports) { probability += 0.10; supportingPillars++; keyFactors.push('Trend supports selected action'); }
    else if (trendOpposes) { probability -= 0.10; keyFactors.push('Trend opposes selected action'); }

    if (candleBuffer && candleBuffer.length >= 3) {
      const recent = candleBuffer.slice(-3);
      const aligned = recent.filter((candle) => action === TradingAction.BUY ? candle.close > candle.open : candle.close < candle.open).length;
      if (aligned >= 2) { probability += 0.08; supportingPillars++; keyFactors.push('Recent candles support selected action'); }
      else if (aligned === 0) probability -= 0.06;
    }

    if ((action === TradingAction.BUY && (rsi?.value ?? 50) > 72 && trend === 'BULLISH')
      || (action === TradingAction.SELL && (rsi?.value ?? 50) < 28 && trend === 'BEARISH')) {
      probability -= 0.15;
      keyFactors.push('Directional exhaustion risk');
    }
    probability = Math.max(0.10, Math.min(0.90, probability));

    const validationPassed = selected ? this.passesValidation(selected.model, readiness) : false;
    let modelApplied = false;
    let learnedProbability = 0.5;
    if (selected?.model.classifier && validationPassed) {
      const oriented = this.orientFeaturesForAction(this.extractFeatures(observation, candleBuffer), action);
      learnedProbability = Math.max(0.15, Math.min(0.85, selected.model.classifier.predict(oriented)));
      const weight = readiness === 'READY' ? 0.60 : 0.35;
      probability = probability * (1 - weight) + learnedProbability * weight;
      modelApplied = true;
      keyFactors.push(`Validated ${selected.key || 'GLOBAL'} ML model applied`);
    } else if (readiness === 'DORMANT') {
      keyFactors.push('ML dormant: no model influence');
    } else if (selected) {
      keyFactors.push('ML holdout quality gate not met: heuristic only');
    }

    probability = Math.round(Math.max(0.10, Math.min(0.90, probability)) * 1000) / 1000;
    const confidenceBoost = modelApplied && supportingPillars >= 2 && probability >= 0.68 && learnedProbability > 0.55
      ? (readiness === 'READY' ? 0.06 : 0.03)
      : 0;

    return {
      probability,
      confidenceBoost,
      keyFactors,
      readiness,
      sampleSize,
      modelApplied,
      validationPassed,
      selectedModel: selected ? selected.key || 'GLOBAL' : null,
      probabilityMeaning: 'ACTION_WIN_PROBABILITY',
      probabilityScale: 'RATIO_0_1',
    };
  }
}
