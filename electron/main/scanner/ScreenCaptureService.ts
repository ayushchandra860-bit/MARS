// ============================================================
// MARS PRO V3 — Screen Capture Service
// Low-latency in-memory frame capture plus targeted market snapshot access.
// ============================================================

import { EmbeddedBrowserManager, EmbeddedMarketSnapshot } from '../view/EmbeddedBrowserManager';
import { CapturedFrame, SessionId } from '../../../shared/types/scanner';

export class ScreenCaptureService {
  public getActiveSourceName(): string | null {
    const snapshot = EmbeddedBrowserManager.getInstance().getMarketSnapshot();
    const title = snapshot?.title || EmbeddedBrowserManager.getInstance().getActiveTitle();
    return title || 'Embedded Browser View';
  }

  public getActiveMarketSnapshot(maxAgeMs = 3000): EmbeddedMarketSnapshot | null {
    return EmbeddedBrowserManager.getInstance().getMarketSnapshot(maxAgeMs);
  }

  public async getActiveMarketText(): Promise<string> {
    return EmbeddedBrowserManager.getInstance().getVisibleText();
  }

  public async captureFrame(arg1: string, arg2?: string): Promise<CapturedFrame> {
    const sessionId = arg2 || arg1 || 'live';
    return EmbeddedBrowserManager.getInstance().captureFrame(sessionId);
  }

  public clearCache(): void {}
}
