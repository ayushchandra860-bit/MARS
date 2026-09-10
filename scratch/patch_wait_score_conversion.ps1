$ErrorActionPreference = 'Stop'
$root = 'C:\Users\ayush\Documents\MARS'
$controller = Join-Path $root 'electron\main\lifecycle\AnalysisController.ts'
$utility = Join-Path $root 'shared\utils\waitScore.ts'

Invoke-WebRequest -UseBasicParsing -Uri 'https://files.manuscdn.com/user_upload_by_module/session_file/310519663889208359/tqNdbKDTSbNmTkAA.ts' -OutFile $utility
$content = (Get-Content -Raw -LiteralPath $controller) -replace "`r`n", "`n"
$content = $content.Replace(
  "import { normalizeWaitScore } from '../../../shared/utils/waitScore';",
  "import { confidenceToWaitScore } from '../../../shared/utils/waitScore';"
)
$content = $content.Replace('waitScore: normalizeWaitScore(stabilized.confidence),', 'waitScore: confidenceToWaitScore(stabilized.confidence),')
if (-not $content.Contains('confidenceToWaitScore')) { throw 'WAIT conversion import was not patched.' }
Set-Content -NoNewline -Encoding utf8 -LiteralPath $controller -Value $content
Write-Output 'WAIT conversion patch applied successfully.'
