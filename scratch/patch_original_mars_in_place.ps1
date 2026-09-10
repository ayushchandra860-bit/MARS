$ErrorActionPreference = 'Stop'

function Replace-Exact {
  param([string]$Path, [string]$Find, [string]$Replace)
  $content = (Get-Content -Raw -LiteralPath $Path) -replace "`r`n", "`n"
  if (-not $content.Contains($Find)) { throw "Patch anchor not found in $Path" }
  Set-Content -NoNewline -Encoding utf8 -LiteralPath $Path -Value $content.Replace($Find, $Replace)
}

$root = 'C:\Users\ayush\Documents\MARS'
$types = Join-Path $root 'shared\types\ipc.ts'
$controller = Join-Path $root 'electron\main\lifecycle\AnalysisController.ts'
$dashboard = Join-Path $root 'frontend\src\control-center\DashboardView.tsx'
$signalPanel = Join-Path $root 'frontend\src\overlay\SignalPanel.tsx'

Replace-Exact $types @'
  signalStrength: number | null;
  confidence: number | null;
  /** Calibrated win probability (0..1) — the honest estimate from the journal. */
'@ @'
  signalStrength: number | null;
  confidence: number | null;
  /** Display-only WAIT score, normalized to the full inclusive 1..100 range. */
  waitScore?: number | null;
  /** Calibrated win probability (0..1) — the honest estimate from the journal. */
'@

Replace-Exact $controller @'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
'@ @'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc-channels';
import { normalizeWaitScore } from '../../../shared/utils/waitScore';
'@

Replace-Exact $controller @'
      signalStrength: stabilized.signalStrength,
      confidence: typeof stabilized.confidence === 'number'
'@ @'
      signalStrength: stabilized.signalStrength,
      waitScore: normalizeWaitScore(stabilized.confidence),
      confidence: typeof stabilized.confidence === 'number'
'@

Replace-Exact $controller @'
      mlFeatures: MLEngine.getInstance().extractFeatures(observation),
    });
  }
  private buildActiveTradeContext
'@ @'
      mlFeatures: MLEngine.getInstance().extractFeatures(observation),
    });
    // The Control Center must receive an immediate event after the durable
    // record is created; otherwise the active-trade view can look empty until
    // an unrelated refresh occurs.
    this.emitPerformanceRefresh();
  }
  private buildActiveTradeContext
'@

Replace-Exact $controller @'
      this.mainWindow.webContents.send(IPC_CHANNELS.PERFORMANCE_REFRESH);
'@ @'
      this.mainWindow.webContents.send(IPC_CHANNELS.PERFORMANCE_REFRESH);
      this.mainWindow.webContents.send(IPC_CHANNELS.ACTIVE_TRADES_UPDATE);
'@

Replace-Exact $dashboard @'
import { AICore } from '../components/AICore';
'@ @'
import { AICore } from '../components/AICore';
import { ActiveTradesPanel } from '../components/ActiveTradesPanel';
'@

Replace-Exact $dashboard @'
        {/* Market Intelligence Context Card */}
'@ @'
        <ActiveTradesPanel />
        {/* Market Intelligence Context Card */}
'@

Replace-Exact $signalPanel @'
  const signalStatus = state?.signalStatus || 'WAIT';
  const tradeStatus = state?.tradeStatus || 'NO TRADE';
'@ @'
  const signalStatus = state?.signalStatus || 'WAIT';
  const waitScore = typeof state?.waitScore === 'number'
    ? Math.max(1, Math.min(100, Math.round(state.waitScore)))
    : Math.max(1, Math.min(100, Math.round((typeof state?.confidence === 'number' ? state.confidence : 0) * 100)));
  const tradeStatus = state?.tradeStatus || 'NO TRADE';
'@

Replace-Exact $signalPanel @'
        {strengthPercent !== null && (
'@ @'
        {actionText === 'WAIT' && (
          <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,193,7,0.28)', borderRadius: '7px', padding: '7px 9px', background: 'rgba(255,193,7,0.06)' }}>
            <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>WAIT SCORE</span>
            <span style={{ fontSize: '12px', fontWeight: 900, color: 'var(--color-amber)', fontFamily: 'var(--font-mono)' }}>WAIT {waitScore} / 100</span>
          </div>
        )}
        {strengthPercent !== null && (
'@

Write-Output 'Original MARS in-place repair patch applied successfully.'
