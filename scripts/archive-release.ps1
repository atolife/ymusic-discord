$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version.' }
if ($env:RELEASE_TAG -and $env:RELEASE_TAG -ne "v$version") { throw 'Release tag must match package.json.' }
$folder = Join-Path $projectRoot "dist\YMusic-$version-win32-x64"
$archive = Join-Path $projectRoot "dist\YMusic-$version-Windows-x64.zip"
if (-not (Test-Path -LiteralPath (Join-Path $folder 'YMusic.exe'))) { throw 'Build the app first.' }
if (Test-Path -LiteralPath (Join-Path $folder 'resources\app\config.json')) { throw 'A personal configuration was included in the build.' }
Compress-Archive -LiteralPath $folder -DestinationPath $archive -Force -CompressionLevel Optimal
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
"$hash  $([System.IO.Path]::GetFileName($archive))" | Set-Content -LiteralPath (Join-Path $projectRoot 'dist\SHA256SUMS.txt') -Encoding ascii
Write-Output $archive
