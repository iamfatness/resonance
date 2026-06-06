$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$extensionDir = Join-Path $root 'extension'
$downloadsDir = Join-Path $root 'public\downloads'
$manifestPath = Join-Path $extensionDir 'manifest.json'

if (-not (Test-Path -LiteralPath $extensionDir)) {
  throw "Extension directory not found: $extensionDir"
}
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Extension manifest not found: $manifestPath"
}

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$version = $manifest.version
$zipPath = Join-Path $downloadsDir "resonance-eq-$version.zip"
$packageManifestPath = Join-Path $downloadsDir "resonance-eq-$version.json"

New-Item -ItemType Directory -Force -Path $downloadsDir | Out-Null

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $extensionDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
$packageManifest = [pscustomobject]@{
  name = $manifest.name
  version = $version
  manifestVersion = $manifest.manifest_version
  packagedAt = (Get-Date).ToString('o')
  zip = (Split-Path -Leaf $zipPath)
  permissions = $manifest.permissions
  hostPermissions = $manifest.host_permissions
}
$packageManifest | ConvertTo-Json -Depth 4 | Set-Content -Path $packageManifestPath -Encoding UTF8
Write-Output "Packaged extension: $zipPath"
Write-Output "Package manifest: $packageManifestPath"
