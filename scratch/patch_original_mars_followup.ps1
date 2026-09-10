$ErrorActionPreference = 'Stop'

function Replace-Once {
  param([string]$Path, [string]$Find, [string]$Replace, [string]$AlreadyPresent)
  $content = (Get-Content -Raw -LiteralPath $Path) -replace "`r`n", "`n"
  if ($content.Contains($AlreadyPresent)) {
    Write-Output "Already patched: $Path"
    return
  }
  if (-not $content.Contains($Find)) { throw "Patch anchor not found in $Path" }
  Set-Content -NoNewline -Encoding utf8 -LiteralPath $Path -Value $content.Replace($Find, $Replace)
}

$root = 'C:\Users\ayush\Documents\MARS'
$controller = Join-Path $root 'electron\main\lifecycle\AnalysisController.ts'
$dashboard = Join-Path $root 'frontend\src\control-center\DashboardView.tsx'
$signalPanel = Join-Path $root 'frontend\src\overlay\SignalPanel.tsx'

Replace-Once $controller @'
      mlFeatures: MLEngine.getInstance().extractFeatures(observation),
    });
  }

  private buildActiveTradeContext
'@ @'
      mlFeatures: MLEngine.getInstance().extractFeatures(observation),
    });
    // Publish immediately after durable creation so every existing Control
    // Center view can render the active trade without waiting for another scan.
    this.emitPerformanceRefresh();
  }

  private buildActiveTradeContext
'@ 'Publish immediately after durable creation'

Replace-Once $controller @'
      this.mainWindow.webContents.send(IPC_CHANNELS.PERFORMANCE_REFRESH);
'@ @'
      this.mainWindow.webContents.send(IPC_CHANNELS.PERFORMANCE_REFRESH);
      this.mainWindow.webContents.send(IPC_CHANNELS.ACTIVE_TRADES_UPDATE);
'@ 'IPC_CHANNELS.ACTIVE_TRADES_UPDATE'

Replace-Once $dashboard @'
import { AICore } from '../components/AICore';
'@ @'
import { AICore } from '../components/AICore';
import { ActiveTradesPanel } from '../components/ActiveTradesPanel';
'@ "import { ActiveTradesPanel } from '../components/ActiveTradesPanel';"

Replace-Once $dashboard @'
        {/* Market Intelligence Context Card */}
'@ @'
        <ActiveTradesPanel />
        {/* Market Intelligence Context Card */}
'@ '        <ActiveTradesPanel />'

Replace-Once $signalPanel @'
  const signalStatus = state?.signalStatus || 'WAIT';
  const tradeStatus = state?.tradeStatus || 'NO TRADE';
'@ @'
  const signalStatus = state?.signalStatus || 'WAIT';
  const waitScore = typeof state?.waitScore === 'number'
    ? Math.max(1, Math.min(100, Math.round(state.waitScore)))
    : Math.max(1, Math.min(100, Math.round((typeof state?.confidence === 'number' ? state.confidence : 0) * 100)));
  const tradeStatus = state?.tradeStatus || 'NO TRADE';
'@ 'const waitScore = typeof state?.waitScore'

Replace-Once $signalPanel @'
        {strengthPercent !== null && (
'@ @'
        {actionText === 'WAIT' && (
          <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,193,7,0.28)', borderRadius: '7px', padding: '7px 9px', background: 'rgba(255,193,7,0.06)' }}>
            <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>WAIT SCORE</span>
            <span style={{ fontSize: '12px', fontWeight: 900, color: 'var(--color-amber)', fontFamily: 'var(--font-mono)' }}>WAIT {waitScore} / 100</span>
          </div>
        )}
        {strengthPercent !== null && (
'@ 'WAIT {waitScore} / 100'

Write-Output 'Original MARS follow-up patch applied successfully.'
