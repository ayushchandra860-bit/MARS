$ErrorActionPreference = 'Stop'
$source = 'C:\Users\ayush\Documents\MARS'
$snapshot = 'C:\Users\ayush\Documents\MARS_PreInplaceRepair_20260813'

if (Test-Path -LiteralPath $snapshot) {
  Write-Output 'Pre-repair snapshot already exists.'
} else {
  New-Item -ItemType Directory -Path $snapshot | Out-Null
  & robocopy $source $snapshot /E /XD node_modules dist dist-electron release .git scratch /XF '*.log' | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "Robocopy failed with code $LASTEXITCODE" }
  Write-Output 'Pre-repair source snapshot created.'
}
