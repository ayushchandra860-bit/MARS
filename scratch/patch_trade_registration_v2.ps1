$ErrorActionPreference = 'Stop'

function Replace-Exact {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Find,
    [Parameter(Mandatory = $true)][string]$Replace
  )

  $content = (Get-Content -Raw -LiteralPath $Path) -replace "`r`n", "`n"
  if (-not $content.Contains($Find)) {
    throw "Expected patch anchor was not found in $Path"
  }
  Set-Content -NoNewline -Encoding utf8 -LiteralPath $Path -Value $content.Replace($Find, $Replace)
}

$root = 'C:\Users\ayush\Documents\MARS'
$browser = Join-Path $root 'electron\main\view\EmbeddedBrowserManager.ts'
$manager = Join-Path $root 'electron\main\trade\RunningTradeManager.ts'

Replace-Exact $browser @'
import { TradingAction } from '../../../shared/types/decision';
'@ @'
import { TradingAction, TradeOutcome } from '../../../shared/types/decision';
'@

Replace-Exact $browser @'
            } else {
              const activeTitle = this.getActiveTitle();
              const assetName = activeTitle ? activeTitle.split(' ')[0] : 'EUR/USD';
              RunningTradeManager.getInstance().registerTrade({
                sessionId: 'live-browser',
                asset: assetName,
                direction: action,
                expirySeconds: 60,
                eventId: data.eventId,
              });
            }
'@ @'
            } else {
              // The embedded platform is the authoritative source for a manual
              // order click. Preserve the detected asset and expiry instead of
              // silently replacing them with hard-coded defaults.
              const nodeInfo = data.nodeInfo || {};
              const activeTitle = this.getActiveTitle();
              const assetName = String(
                data.asset || nodeInfo.assetName || (activeTitle ? activeTitle.split(' ')[0] : '')
              ).trim() || 'UNKNOWN';
              const expirySeconds = this.parseExpirySeconds(data.expiryText || nodeInfo.expiryText);
              const trade = RunningTradeManager.getInstance().registerTrade({
                sessionId: 'live-browser',
                asset: assetName,
                direction: action,
                expirySeconds,
                eventId: data.eventId,
              });
              if (trade) this.emitTradeStateRefresh();
            }
'@

Replace-Exact $browser @'
        } else if (message.startsWith('[MARS_TRADE_RESULT]:')) {
          try {
            const resultData = JSON.parse(message.substring(20));
            if (this.tradeResultHandler) {
              this.tradeResultHandler(resultData);
            }
          } catch (err) {
            console.error('[MARS Browser Detector] Error parsing result event:', err);
          }
        }
'@ @'
        } else if (message.startsWith('[MARS_TRADE_RESULT]:')) {
          try {
            const resultData = JSON.parse(message.substring(20));
            if (this.tradeResultHandler) {
              this.tradeResultHandler(resultData);
            } else {
              // The result detector was previously a dead end whenever no custom
              // callback was registered. Complete the next pending browser trade
              // directly so the browser result reaches the journal and analytics.
              const rawOutcome = String(resultData.outcome || '').toUpperCase();
              const outcome = rawOutcome === 'WIN'
                ? TradeOutcome.WIN
                : rawOutcome === 'LOSS'
                ? TradeOutcome.LOSS
                : rawOutcome === 'DRAW'
                ? TradeOutcome.DRAW
                : null;
              if (outcome) {
                const completed = RunningTradeManager.getInstance().resolveNextActiveTrade(
                  outcome,
                  String(resultData.amount ?? '0'),
                  'live-browser',
                );
                if (completed) this.emitTradeStateRefresh();
              }
            }
          } catch (err) {
            console.error('[MARS Browser Detector] Error parsing result event:', err);
          }
        }
'@

Replace-Exact $browser @'
  public setTradeResultHandler(handler: ((event: { outcome: string; amount: number; rawText: string; timestamp: number }) => void) | null): void {
    this.tradeResultHandler = handler;
  }
  private injectTradeDetectorScript(): void {
'@ @'
  public setTradeResultHandler(handler: ((event: { outcome: string; amount: number; rawText: string; timestamp: number }) => void) | null): void {
    this.tradeResultHandler = handler;
  }

  private parseExpirySeconds(rawExpiry: unknown): number {
    const text = String(rawExpiry || '').trim().toLowerCase();
    const clock = text.match(/(\d{1,2}):(\d{2})/);
    if (clock) {
      const seconds = Number(clock[1]) * 60 + Number(clock[2]);
      if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 24 * 60 * 60);
    }
    const duration = text.match(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/);
    if (duration) {
      const value = Number(duration[1]);
      const unit = duration[2];
      const multiplier = unit.startsWith('h') ? 3600 : unit.startsWith('m') ? 60 : 1;
      const seconds = Math.round(value * multiplier);
      if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 24 * 60 * 60);
    }
    return 60;
  }

  private emitTradeStateRefresh(): void {
    if (this.parentWindow && !this.parentWindow.isDestroyed() && !this.parentWindow.webContents.isDestroyed()) {
      this.parentWindow.webContents.send('mars:trade:active-update');
      this.parentWindow.webContents.send('mars:performance:refresh');
    }
  }

  private injectTradeDetectorScript(): void {
'@

Replace-Exact $manager @'
  // ----------------------------------------------------------
  // Task T1.10: Database Safety & Persistence
  // ----------------------------------------------------------
'@ @'
  /**
   * Resolve the pending browser trade that is due next. The trading platform
   * result toast does not expose an internal MARS trade ID, so expiry order is
   * the stable correlation key. This supports normal single orders while still
   * preserving independent records for intentional scaling entries.
   */
  public resolveNextActiveTrade(
    outcome: TradeOutcome,
    completionPrice?: string,
    sessionId: string = 'live-browser',
  ): boolean {
    const pendingInMemory = Array.from(this.activeTrades.values())
      .filter((trade) => trade.sessionId === sessionId &&
        (trade.status === TradeState.TRADE_ACTIVE || trade.status === TradeState.EXPIRING))
      .sort((a, b) => a.expiryTimestamp - b.expiryTimestamp || a.entryTimestamp - b.entryTimestamp);

    const memoryTrade = pendingInMemory[0];
    if (memoryTrade) {
      this.resolveTradeOutcome(memoryTrade.id, outcome, completionPrice);
      return true;
    }

    // After a browser reload, in-memory records can be empty before recovery
    // has finished. Fall back to the durable SQLite source of truth.
    if (!this.tradeRepo) return false;
    const dbTrade = this.tradeRepo.getActiveTrades(sessionId)
      .sort((a, b) => a.expiry_timestamp - b.expiry_timestamp || a.entry_timestamp - b.entry_timestamp)[0];
    if (!dbTrade) return false;

    this.tradeRepo.completeTrade(dbTrade.id, outcome, completionPrice || '0');
    this.clearExpiryTimer(dbTrade.id);
    this.activeTrades.delete(dbTrade.id);
    return true;
  }

  // ----------------------------------------------------------
  // Task T1.10: Database Safety & Persistence
  // ----------------------------------------------------------
'@

Write-Output 'Trade-registration patch applied successfully.'
