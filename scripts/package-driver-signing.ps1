param(
  [string] $PackageDir,
  [string] $OutputDir
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
if (-not $PackageDir) {
  $PackageDir = Join-Path $root 'driver\audio\sysvad\x64\Debug\package'
}
if (-not $OutputDir) {
  $OutputDir = Join-Path $root 'release\driver-signing'
}

if (-not (Test-Path -LiteralPath $PackageDir)) {
  throw "Driver package directory not found: $PackageDir. Run npm run driver:build first."
}

$resolvedPackageDir = Resolve-Path -LiteralPath $PackageDir
$resolvedOutputRoot = if (Test-Path -LiteralPath $OutputDir) {
  Resolve-Path -LiteralPath $OutputDir
} else {
  New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
  Resolve-Path -LiteralPath $OutputDir
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$submissionName = "resonance-driver-submission-$stamp"
$submissionRoot = Join-Path $resolvedOutputRoot $submissionName
$submissionPackage = Join-Path $submissionRoot 'package'
$manifestPath = Join-Path $submissionRoot 'resonance-driver-submission.json'
$zipPath = Join-Path $resolvedOutputRoot "$submissionName.zip"

New-Item -ItemType Directory -Force -Path $submissionPackage | Out-Null
Copy-Item -Path (Join-Path $resolvedPackageDir '*') -Destination $submissionPackage -Recurse -Force

$files = @(Get-ChildItem -LiteralPath $submissionPackage -File | Sort-Object Name | ForEach-Object {
    [pscustomobject]@{
      file = $_.Name
      bytes = $_.Length
      sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
      authenticodeStatus = [string](Get-AuthenticodeSignature -LiteralPath $_.FullName).Status
    }
  })

$manifest = [pscustomobject]@{
  name = 'Resonance virtual audio driver submission package'
  packagedAt = (Get-Date).ToString('o')
  sourcePackageDir = [string]$resolvedPackageDir
  submissionRoot = $submissionRoot
  packageDir = $submissionPackage
  zip = $zipPath
  installPolicy = 'Do not install this local package on Secure Boot systems until Microsoft attestation or production signing is complete.'
  expectedMicrosoftSigningFlow = 'Submit the package contents to Microsoft Hardware Dev Center, then install only the returned signed package on Secure Boot machines.'
  files = $files
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding UTF8

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $submissionPackage '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "Packaged driver signing folder: $submissionRoot"
Write-Host "Packaged driver signing zip: $zipPath"
Write-Host "Manifest: $manifestPath"
