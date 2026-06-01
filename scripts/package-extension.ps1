$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$extensionDir = Join-Path $root 'extension'
$downloadsDir = Join-Path $root 'public\downloads'
$zipPath = Join-Path $downloadsDir 'resonance-eq-0.1.0.zip'

if (-not (Test-Path -LiteralPath $extensionDir)) {
  throw "Extension directory not found: $extensionDir"
}

New-Item -ItemType Directory -Force -Path $downloadsDir | Out-Null

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

$files = Get-ChildItem -LiteralPath $extensionDir -File | Where-Object {
  $_.Name -in @(
    'manifest.json',
    'background.js',
    'offscreen.html',
    'offscreen.js',
    'popup.html',
    'popup.js',
    'popup.css',
    'README.md'
  )
}

Compress-Archive -LiteralPath $files.FullName -DestinationPath $zipPath -CompressionLevel Optimal
Write-Output "Packaged extension: $zipPath"
