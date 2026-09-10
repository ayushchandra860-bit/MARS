$ErrorActionPreference = 'Stop'
$path = 'C:\Users\ayush\Documents\MARS\electron\main\lifecycle\AnalysisController.ts'
$content = (Get-Content -Raw -LiteralPath $path) -replace "`r`n", "`n"

function Replace-OnceText {
  param([string]$Find, [string]$Replace, [string]$AlreadyPresent)
  if ($content.Contains($AlreadyPresent)) { return }
  if (-not $content.Contains($Find)) { throw "Patch anchor not found: $Find" }
  $script:content = $script:content.Replace($Find, $Replace)
}

Replace-OnceText @'
      if (!scanResult) {
        this.emitPipelineStatus(SystemStatus.DEGRADED, 'Scanner did not return a result. Retrying live capture.');
        return;
      }
'@ @'
      if (!scanResult) {
        // Expiry resolution must not depend on a fresh scanner frame.
        this.updateTradeLifecycle(null);
        this.emitPipelineStatus(SystemStatus.DEGRADED, 'Scanner did not return a result. Retrying live capture.');
        return;
      }
'@ 'Expiry resolution must not depend on a fresh scanner frame.'

Replace-OnceText @'
      if (!scanResultObservation) {
        const failedStage = scanResult.diagnostics?.firstFailedStage || 'OBSERVATION';
'@ @'
      if (!scanResultObservation) {
        // Preserve existing active-trade lifecycle even while OCR/observation is unavailable.
        this.updateTradeLifecycle(null);
        const failedStage = scanResult.diagnostics?.firstFailedStage || 'OBSERVATION';
'@ 'Preserve existing active-trade lifecycle even while OCR/observation is unavailable.'

Replace-OnceText @'
      if (!qualityCheck.passed) {
        this.emitPipelineStatus(
'@ @'
      if (!qualityCheck.passed) {
        // A rejected observation cannot create a signal, but existing trades
        // still need expiry processing and the UI must show a real WAIT state.
        this.updateTradeLifecycle(scanResultObservation);
        this.emitPipelineStatus(
'@ 'A rejected observation cannot create a signal'

Replace-OnceText @'
      signalStrength: null,
      confidence: null,
      winProbability: null,
'@ @'
      signalStrength: null,
      confidence: null,
      waitScore: 1,
      winProbability: null,
'@ 'waitScore: 1,'

Set-Content -NoNewline -Encoding utf8 -LiteralPath $path -Value $content
Write-Output 'Original scan recovery patch applied successfully.'
