$ErrorActionPreference = 'Stop'
$path = 'C:\Users\ayush\Documents\MARS\electron\main\trade\RunningTradeManager.ts'
$content = (Get-Content -Raw -LiteralPath $path) -replace "`r`n", "`n"

if (-not $content.Contains('public resolveNextActiveTrade(')) {
  $marker = '  // Task T1.10: Database Safety & Persistence'
  $index = $content.IndexOf($marker)
  if ($index -lt 0) { throw 'Trade-manager insertion marker not found' }

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
  Set-Content -NoNewline -Encoding utf8 -LiteralPath $path -Value $content
}

Write-Output 'Trade-manager resolver patch applied successfully.'
