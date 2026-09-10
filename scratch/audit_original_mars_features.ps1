$ErrorActionPreference = 'Stop'
Set-Location 'C:\Users\ayush\Documents\MARS'

Write-Output '---MAIN FEATURE MODULES---'
Get-ChildItem electron\main -Directory | ForEach-Object {
  $count = (Get-ChildItem $_.FullName -Recurse -File -Filter *.ts | Measure-Object).Count
  '{0}: {1} TypeScript files' -f $_.Name, $count
}

Write-Output '---CONTROL CENTER VIEWS---'
Get-ChildItem frontend\src\control-center -File -Filter *.tsx | Select-Object -ExpandProperty Name

Write-Output '---OVERLAY AND BROWSER---'
Get-ChildItem electron\main\overlay,electron\main\view -Recurse -File -Filter *.ts | Select-Object -ExpandProperty FullName

Write-Output '---TEST FEATURE GROUPS---'
Get-ChildItem tests -File -Filter *.test.ts | Select-Object -ExpandProperty Name
