// ============================================================
// MARS PRO V3 — Screen Capture Service
// Low-latency in-memory frame capturer using EmbeddedBrowserManager.
// Pure memory capture (<15ms) via webContents.capturePage().
// ============================================================

import { EmbeddedBrowserManager } from '../view/EmbeddedBrowserManager';
import { CapturedFrame, SessionId } from '../../../shared/types/scanner';

export class ScreenCaptureService {
  public getActiveSourceName(): string | null {
    const title = EmbeddedBrowserManager.getInstance().getActiveTitle();
    return title || 'Embedded Browser View';
  }

  public async getActiveMarketText(): Promise<string> {
    return EmbeddedBrowserManager.getInstance().getVisibleText();
  }

  public async captureFrame(arg1: string, arg2?: string): Promise<CapturedFrame> {
    const sessionId = arg2 || arg1 || 'live';
    const embeddedManager = EmbeddedBrowserManager.getInstance();
    return await embeddedManager.captureFrame(sessionId);
  }

  public clearCache(): void {}
}
