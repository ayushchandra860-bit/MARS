import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildEmbeddedTradeDetectorScript } from '../electron/main/view/embeddedTradeDetector';

function source(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

describe('runtime performance regression guards', () => {
  it('never throttles a visible or merely blurred Browser Workstation to one FPS', () => {
    const manager = source('electron/main/view/EmbeddedBrowserManager.ts');
    expect(manager).toContain('ACTIVE_FRAME_RATE = 60');
    expect(manager).toContain('BACKGROUND_FRAME_RATE = 30');
    expect(manager).not.toMatch(/setFrameRate\(1\)/);
  });

  it('does not globally disable Windows acceleration on every normal launch', () => {
    const main = source('electron/main/main.ts');
    expect(main).toContain('if (safeGraphicsMode) app.disableHardwareAcceleration()');
    expect(main).not.toContain("if (process.platform === 'win32') app.disableHardwareAcceleration()");
  });

  it('uses a compact quote heartbeat instead of full body text extraction', () => {
    const script = buildEmbeddedTradeDetectorScript();
    expect(script).toContain('[MARS_MARKET_SNAPSHOT]:');
    expect(script).not.toContain('document.body.innerText');
    const manager = source('electron/main/view/EmbeddedBrowserManager.ts');
    expect(manager).not.toContain('document.body ? document.body.innerText');
  });

  it('keeps heavy pixel work in a Node worker and bounds captures', () => {
    const scanner = source('electron/main/scanner/LiveScanner.ts');
    const manager = source('electron/main/view/EmbeddedBrowserManager.ts');
    expect(scanner).toContain('PixelAnalysisWorker');
    expect(scanner).toContain('backgroundCapturePending');
    expect(manager).toContain('CAPTURE_MAX_WIDTH = 960');
  });

  it('ships the low-repaint renderer profile in both windows', () => {
    expect(source('frontend/src/main.tsx')).toContain("./styles/performance.css");
    expect(source('frontend/src/overlay-main.tsx')).toContain("./styles/performance.css");
    expect(source('frontend/src/styles/performance.css')).toContain('animation: none !important');
  });
});
