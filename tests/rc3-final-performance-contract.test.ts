import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('RC3 final performance and release contracts', () => {
  it('self-schedules analysis only after the previous scan completes', () => {
    const source = read('electron/main/lifecycle/AnalysisController.ts');
    expect(source).toContain('this.scanTimer = setTimeout(async () =>');
    expect(source).toContain('await this.runScanCycle();');
    expect(source).toContain('scheduleNext();');
    expect(source).toContain('clearTimeout(this.scanTimer);');
    expect(source).not.toContain('this.scanTimer = setInterval');
  });

  it('uses one absolute-time overlay countdown ticker', () => {
    const source = read('frontend/src/overlay/SignalPanel.tsx');
    expect(source.match(/window\.setInterval\(/g)).toHaveLength(1);
    expect(source).toContain('One absolute-time ticker drives both countdowns');
    expect(source).toContain('normalizePrice');
    expect(source).not.toContain('[localVisualSec]');
  });

  it('updates active trade display from lightweight quotes without verifying outcomes', () => {
    const source = read('electron/main/overlay/OverlayManager.ts');
    expect(source).toContain('patch.tradeMonitor =');
    expect(source).toContain('Indicative live quote only; final result remains evidence-verified.');
    expect(source).toContain('quoteUpdateCount');
    expect(source).toContain('ipcUpdateCount');
  });

  it('exposes central scan, worker, quote, IPC, event-loop, and persistence metrics', () => {
    const source = read('electron/main/lifecycle/AnalysisController.ts');
    for (const field of [
      'lastScanDurationMs', 'captureDurationMs', 'workerAnalysisDurationMs',
      'quoteHeartbeatAgeMs', 'eventLoopLagMs', 'overlayIpcUpdates',
      'quoteIpcUpdates', 'databasePersistence',
    ]) expect(source).toContain(field);
  });

  it('keeps package and release metadata synchronized to rc.3', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    const workflow = read('.github/workflows/windows-installer.yml');
    expect(pkg.version).toBe('3.0.1-rc.4');
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
    expect(workflow).toContain('default: v3.0.1-rc.4');
    expect(workflow).toContain('Performance and reliability changes in rc.3');
  });
});
