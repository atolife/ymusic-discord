$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$compilerPath = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath)) { throw '.NET Framework compiler was not found.' }
$target = Join-Path $projectRoot 'native\ProcessAudio.exe'
& $compilerPath /nologo /target:exe /platform:x64 /optimize+ /codepage:65001 /reference:System.Web.Extensions.dll "/out:$target" (Join-Path $projectRoot 'native\ProcessAudio.cs')
if ($LASTEXITCODE -ne 0) { throw 'Failed to build the audio helper.' }
Write-Output $target
