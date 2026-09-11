import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURE_NAMES, MLEngine } from '../electron/main/decision/MLEngine';
import { TradingAction } from '../shared/types/decision';

describe('persisted ML operational readiness', () => {
  it('keeps a high-sample invalid model non-operational after reload', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mars-ml-reload-'));
    const ml = MLEngine.getInstance();

    try {
      ml.reset();
      ml.setPersistencePath(directory);
      const sameFeatures = new Array(FEATURE_NAMES.length).fill(0.5);
      const examples = [];
      for (let index = 0; index < 80; index++) {
        examples.push(
          {
            features: sameFeatures,
            label: index % 2 === 0 ? 1 as const : -1 as const,
            action: TradingAction.BUY,
            asset: 'EUR/USD',
          },
          {
            features: sameFeatures,
            label: index % 2 === 0 ? -1 as const : 1 as const,
            action: TradingAction.BUY,
            asset: 'EUR/USD',
          },
        );
      }

      ml.ingestLabeledExamples(examples);
      expect(ml.getSampleCount('EUR/USD')).toBe(160);
      expect(ml.getReadiness('EUR/USD')).toBe('TRAINING');
      expect(ml.hasTrainedModel('EUR/USD')).toBe(false);
      expect(fs.existsSync(path.join(directory, 'ml-engine-model.json'))).toBe(true);

      // setPersistencePath reloads the persisted file, matching startup behavior.
      ml.setPersistencePath(directory);
      expect(ml.getSampleCount('EUR/USD')).toBe(160);
      expect(ml.getReadiness('EUR/USD')).toBe('TRAINING');
      expect(ml.hasTrainedModel('EUR/USD')).toBe(false);
    } finally {
      ml.reset();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
