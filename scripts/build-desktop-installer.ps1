$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$releaseRoot = Join-Path $root 'release'
$installerRoot = Join-Path $releaseRoot 'installer'
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'resonance-electron-builder'

& npm run build
& npm run native:wasapi-meter
& npm run native:audio-router
& npm run native:vst3-bridge

if (Test-Path -LiteralPath $tempRoot) {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

& npx electron-builder --win nsis --x64 "--config.directories.output=$tempRoot"

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
if (Test-Path -LiteralPath $installerRoot) {
  $resolvedInstallerRoot = Resolve-Path -LiteralPath $installerRoot
  $resolvedReleaseRoot = Resolve-Path -LiteralPath $releaseRoot
  if (-not $resolvedInstallerRoot.Path.StartsWith($resolvedReleaseRoot.Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unexpected path: $resolvedInstallerRoot"
  }
  Remove-Item -LiteralPath $resolvedInstallerRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $installerRoot | Out-Null

$artifactPatterns = @('*.exe', '*.blockmap', 'latest.yml')
foreach ($pattern in $artifactPatterns) {
  Get-ChildItem -LiteralPath $tempRoot -Filter $pattern -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $installerRoot -Force
  }
}

$installer = Get-ChildItem -LiteralPath $installerRoot -Filter 'Resonance-Setup-*.exe' -File | Select-Object -First 1
if (-not $installer) {
  throw "Installer was not created in $installerRoot"
}

Write-Host "Built Resonance Windows installer at: $($installer.FullName)"
