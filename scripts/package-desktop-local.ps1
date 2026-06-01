$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$releaseRoot = Join-Path $root 'release'
$packageRoot = Join-Path $releaseRoot 'Resonance-local'
$electronDist = Join-Path $root 'node_modules\electron\dist'
$appRoot = Join-Path $packageRoot 'resources\app'

if (-not (Test-Path -LiteralPath $electronDist)) {
  throw "Electron runtime not found. Run npm install first."
}

& npm run build
& npm run native:wasapi-meter

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
if (Test-Path -LiteralPath $packageRoot) {
  $resolvedPackageRoot = Resolve-Path -LiteralPath $packageRoot
  $resolvedReleaseRoot = Resolve-Path -LiteralPath $releaseRoot
  if (-not $resolvedPackageRoot.Path.StartsWith($resolvedReleaseRoot.Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unexpected path: $resolvedPackageRoot"
  }
  Remove-Item -LiteralPath $resolvedPackageRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $packageRoot | Out-Null
Copy-Item -Path (Join-Path $electronDist '*') -Destination $packageRoot -Recurse -Force

$electronExe = Join-Path $packageRoot 'electron.exe'
$resonanceExe = Join-Path $packageRoot 'Resonance.exe'
if (Test-Path -LiteralPath $electronExe) {
  Move-Item -LiteralPath $electronExe -Destination $resonanceExe -Force
}

New-Item -ItemType Directory -Force -Path $appRoot | Out-Null

$appPackage = @'
{
  "name": "resonance",
  "version": "0.1.0",
  "main": "electron/main.cjs"
}
'@
$appPackage | Set-Content -Path (Join-Path $appRoot 'package.json') -Encoding UTF8

$copyItems = @(
  'dist',
  'electron',
  'engine',
  'scripts\list-audio-devices.ps1',
  'native\wasapi-meter\build\Release\resonance-wasapi-meter.exe'
)

foreach ($item in $copyItems) {
  $source = Join-Path $root $item
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Required package source missing: $source"
  }

  $destination = Join-Path $appRoot $item
  $destinationParent = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
}

$launcher = @"
@echo off
setlocal
start "" "%~dp0Resonance.exe"
"@
$launcher | Set-Content -Path (Join-Path $packageRoot 'Launch Resonance.cmd') -Encoding ASCII

Write-Host "Packaged Resonance desktop app at: $packageRoot"
Write-Host "Launch: $resonanceExe"
