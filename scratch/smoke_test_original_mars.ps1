$ErrorActionPreference = 'Stop'
$exe = 'C:\Users\ayush\Documents\MARS\release\MARS PRO V3 3.0.0.exe'
$process = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8
$running = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
if (-not $running) { throw 'The packaged MARS executable exited before the smoke-test interval elapsed.' }
$running | Select-Object ProcessName,Id,StartTime
