$ErrorActionPreference = 'Stop'
$source = 'C:\Users\ayush\Documents\MARS'
$backup = 'C:\Users\ayush\Documents\MARS_Legacy_Backup_20260813'

if (Test-Path $backup) {
  Write-Output 'Backup already exists.'
} else {
  New-Item -ItemType Directory -Path $backup | Out-Null
  & robocopy $source $backup /E /XD node_modules dist dist-electron release .git scratch /XF '*.log' | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "Robocopy failed with code $LASTEXITCODE"
  }
  Write-Output 'Source backup created.'
}

Get-ChildItem -LiteralPath $backup -Force | Select-Object Name,Mode
