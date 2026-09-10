$ErrorActionPreference = 'Stop'
$path = 'C:\Users\ayush\Documents\MARS\electron\main\view\EmbeddedBrowserManager.ts'
$content = Get-Content -Raw -LiteralPath $path
$content = [regex]::Replace($content, '[ \t]+(?=\r?\n)', '')
Set-Content -NoNewline -Encoding utf8 -LiteralPath $path -Value $content
Write-Output 'Trailing whitespace removed from EmbeddedBrowserManager.ts.'
