$ErrorActionPreference = 'Stop'

function Read-Normalized {
  param([string]$Path)
  return (Get-Content -Raw -LiteralPath $Path) -replace "`r`n", "`n"
}

function Write-Normalized {
  param([string]$Path, [string]$Content)
  Set-Content -NoNewline -Encoding utf8 -LiteralPath $Path -Value $Content
}

function Replace-Section {
  param(
    [string]$Path,
    [string]$StartMarker,
    [string]$EndMarker,
    [string]$Replacement,
    [string]$AlreadyPresent
  )
  $content = Read-Normalized $Path
  if ($content.Contains($AlreadyPresent)) {
    Write-Output "Already patched: $Path"
    return
  }
  $start = $content.IndexOf($StartMarker)
  if ($start -lt 0) { throw "Start marker not found in $Path" }
  $end = $content.IndexOf($EndMarker, $start)
  if ($end -lt 0) { throw "End marker not found in $Path" }
  $updated = $content.Substring(0, $start) + $Replacement + $content.Substring($end + $EndMarker.Length)
  Write-Normalized $Path $updated
}

$root = 'C:\Users\ayush\Documents\MARS'
$browser = Join-Path $root 'electron\main\view\EmbeddedBrowserManager.ts'
$manager = Join-Path $root 'electron\main\trade\RunningTradeManager.ts'

$content = Read-Normalized $browser
if (-not $content.Contains("import { TradingAction, TradeOutcome } from '../../../shared/types/decision';")) {
  $content = $content.Replace("import { TradingAction } from '../../../shared/types/decision';", "import { TradingAction, TradeOutcome } from '../../../shared/types/decision';")
  Write-Normalized $browser $content
}

Replace-Section $browser @'
            } else {
              const activeTitle = this.getActiveTitle();
'@ @'
          } catch (err) {
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
          } catch (err) {
'@ @'
const expirySeconds = this.parseExpirySeconds(data.expiryText || nodeInfo.expiryText);
'@

Replace-Section $browser @'
        } else if (message.startsWith('[MARS_TRADE_RESULT]:')) {
'@ @'
      });
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
      });
'@ @'
resolveNextActiveTrade(
'@

$content = Read-Normalized $browser
if (-not $content.Contains('private parseExpirySeconds(rawExpiry: unknown): number')) {
  $marker = '  private injectTradeDetectorScript(): void {'
  $index = $content.IndexOf($marker)
  if ($index -lt 0) { throw "Browser helper insertion marker not found" }
  $helpers = @'
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

'@
  $content = $content.Substring(0, $index) + $helpers + $content.Substring($index)
  Write-Normalized $browser $content
}

$content = Read-Normalized $manager
if (-not $content.Contains('public resolveNextActiveTrade(')) {
  $marker = '  // ----------------------------------------------------------`n  // Task T1.10: Database Safety & Persistence'
  $index = $content.IndexOf($marker)
  if ($index -lt 0) { throw "Trade-manager insertion marker not found" }
  $method = @'
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

'@
  $content = $content.Substring(0, $index) + $method + $content.Substring($index)
  Write-Normalized $manager $content
}

Write-Output 'Trade-registration patch completed successfully.'
