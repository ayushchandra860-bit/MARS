$ErrorActionPreference = 'Stop'
$documents = 'C:\Users\ayush\Documents'
$new = Join-Path $documents 'Mars Trading View'
$staging = Join-Path $documents 'mars_trading_view_v1'
$archive = Join-Path $documents 'mars_trading_view_v1.tar.gz'

if (Test-Path -LiteralPath $new) {
  throw 'Mars Trading View already exists; refusing to overwrite it.'
}

Invoke-WebRequest -UseBasicParsing -Uri 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663889208359/OZBdAbAQVBufLeXu.gz' -OutFile $archive
if (Test-Path -LiteralPath $staging) { Remove-Item -Recurse -Force $staging }
tar -xzf $archive -C $documents
Rename-Item -LiteralPath $staging -NewName 'Mars Trading View'
Remove-Item -Force $archive

Write-Output 'New project extracted.'
Get-ChildItem -LiteralPath $new -Force | Select-Object Name,Mode,Length
