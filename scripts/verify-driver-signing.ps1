param(
  [string] $PackageDir,
  [switch] $Json
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
if (-not $PackageDir) {
  $PackageDir = Join-Path $root 'driver\audio\sysvad\x64\Debug\package'
}

function Find-WdkTool($Name) {
  $wdkRoot = 'C:\Program Files (x86)\Windows Kits\10\bin'
  Get-ChildItem -Path $wdkRoot -Recurse -Filter $Name -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1
}

function New-Check($Name, $Status, $Detail, $NextAction = '') {
  [pscustomobject]@{
    check = $Name
    status = $Status
    detail = $Detail
    nextAction = $NextAction
  }
}

function Get-SignatureSummary($Path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  [pscustomobject]@{
    file = Split-Path -Leaf $Path
    path = $Path
    status = [string]$signature.Status
    signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
    issuer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Issuer } else { '' }
    notAfter = if ($signature.SignerCertificate) { $signature.SignerCertificate.NotAfter.ToString('o') } else { $null }
  }
}

$resolvedPackageDir = if (Test-Path -LiteralPath $PackageDir) { Resolve-Path -LiteralPath $PackageDir } else { $null }
$requiredFiles = @(
  'ComponentizedAudioSample.inf',
  'ComponentizedAudioSampleExtension.inf',
  'ComponentizedApoSample.inf',
  'TabletAudioSample.sys',
  'sysvad.cat'
)

$checks = [System.Collections.Generic.List[object]]::new()
$checks.Add((New-Check `
      'Package directory' `
      $(if ($resolvedPackageDir) { 'ready' } else { 'blocked' }) `
      $(if ($resolvedPackageDir) { [string]$resolvedPackageDir } else { "Missing package directory: $PackageDir" }) `
      $(if ($resolvedPackageDir) { '' } else { 'Run npm run driver:build first.' })))

$missingFiles = @()
if ($resolvedPackageDir) {
  foreach ($file in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedPackageDir $file))) {
      $missingFiles += $file
    }
  }
}

$checks.Add((New-Check `
      'Required submission files' `
      $(if ($resolvedPackageDir -and $missingFiles.Count -eq 0) { 'ready' } else { 'blocked' }) `
      $(if ($missingFiles.Count -eq 0) { ($requiredFiles -join ', ') } else { 'Missing: ' + ($missingFiles -join ', ') }) `
      $(if ($missingFiles.Count -eq 0) { '' } else { 'Rebuild the driver package and confirm the SysVAD output package is complete.' })))

$infFiles = @()
$catFiles = @()
$driverFiles = @()
$signatureFiles = @()
if ($resolvedPackageDir) {
  $infFiles = @(Get-ChildItem -LiteralPath $resolvedPackageDir -Filter '*.inf' -File)
  $catFiles = @(Get-ChildItem -LiteralPath $resolvedPackageDir -Filter '*.cat' -File)
  $driverFiles = @(Get-ChildItem -LiteralPath $resolvedPackageDir -File | Where-Object { $_.Extension -in @('.sys', '.dll') })
  $signatureFiles = @($catFiles + $driverFiles)
}

$checks.Add((New-Check `
      'INF count' `
      $(if ($infFiles.Count -gt 0) { 'ready' } else { 'blocked' }) `
      "$($infFiles.Count) INF file(s)" `
      $(if ($infFiles.Count -gt 0) { '' } else { 'A driver submission package must include INF files.' })))

$checks.Add((New-Check `
      'Catalog count' `
      $(if ($catFiles.Count -gt 0) { 'ready' } else { 'blocked' }) `
      "$($catFiles.Count) CAT file(s)" `
      $(if ($catFiles.Count -gt 0) { '' } else { 'Run the WDK build/Inf2Cat flow to generate a catalog.' })))

$signatures = @($signatureFiles | ForEach-Object { Get-SignatureSummary $_.FullName })
$signedCount = @($signatures | Where-Object { $_.status -eq 'Valid' }).Count
$unsignedCount = @($signatures | Where-Object { $_.status -ne 'Valid' }).Count
$checks.Add((New-Check `
      'Authenticode signatures' `
      $(if ($signatureFiles.Count -gt 0 -and $unsignedCount -eq 0) { 'ready' } elseif ($signatureFiles.Count -gt 0) { 'manual' } else { 'blocked' }) `
      "$signedCount valid, $unsignedCount not valid" `
      $(if ($unsignedCount -eq 0 -and $signatureFiles.Count -gt 0) { '' } else { 'Submit for Microsoft attestation/production signing before installing on Secure Boot systems.' })))

$signtool = Find-WdkTool 'signtool.exe'
$signtoolResults = @()
if ($signtool -and $catFiles.Count -gt 0) {
  foreach ($cat in $catFiles) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $output = & $signtool.FullName verify /kp /v $cat.FullName 2>&1
      $exitCode = $LASTEXITCODE
    } catch {
      $output = @($_.Exception.Message)
      $exitCode = 1
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    $signtoolResults += [pscustomobject]@{
      file = $cat.Name
      exitCode = $exitCode
      status = if ($exitCode -eq 0) { 'ready' } else { 'manual' }
      output = ($output -join "`n")
    }
  }
}

$checks.Add((New-Check `
      'SignTool kernel policy verification' `
      $(if (-not $signtool) { 'manual' } elseif ($signtoolResults.Count -gt 0 -and (@($signtoolResults | Where-Object { $_.exitCode -ne 0 }).Count -eq 0)) { 'ready' } else { 'manual' }) `
      $(if ($signtool) { $signtool.FullName } else { 'signtool.exe was not found under the Windows Kits bin folder.' }) `
      $(if ($signtoolResults.Count -gt 0 -and (@($signtoolResults | Where-Object { $_.exitCode -ne 0 }).Count -eq 0)) { '' } else { 'Expected to remain manual until the Microsoft-signed CAT is available.' })))

$hashes = @()
if ($resolvedPackageDir) {
  $hashes = @(Get-ChildItem -LiteralPath $resolvedPackageDir -File | Sort-Object Name | ForEach-Object {
      [pscustomobject]@{
        file = $_.Name
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        bytes = $_.Length
      }
    })
}

$summary = [pscustomobject]@{
  generatedAt = (Get-Date).ToString('o')
  packageDir = if ($resolvedPackageDir) { [string]$resolvedPackageDir } else { $PackageDir }
  checks = $checks
  signatures = $signatures
  signtool = $signtoolResults
  hashes = $hashes
}

if ($Json) {
  $summary | ConvertTo-Json -Depth 6
  exit 0
}

Write-Host 'Resonance driver signing verification'
Write-Host ''
$checks | Format-Table -AutoSize
Write-Host ''
if ($signatures.Count -gt 0) {
  $signatures | Select-Object file, status, signer | Format-Table -AutoSize
  Write-Host ''
}
Write-Host 'Use -Json for full signature, SignTool, and SHA256 details.'
