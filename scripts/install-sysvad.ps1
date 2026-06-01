$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$driverRoot = Join-Path $root 'driver\audio\sysvad'
$packageDir = Join-Path $driverRoot 'x64\Debug\package'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  throw "SysVAD installation requires an elevated PowerShell window."
}

try {
  $secureBootState = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State' -Name UEFISecureBootEnabled -ErrorAction Stop
  $secureBoot = ([int]$secureBootState.UEFISecureBootEnabled -eq 1)
} catch {
  $secureBoot = try {
    [bool](Confirm-SecureBootUEFI)
  } catch {
    $false
  }
}

if ($secureBoot) {
  throw "Secure Boot is enabled. This SysVAD package is test-signed, so install it only on a VM/test machine without Secure Boot, or submit a production/attestation-signed driver package before installing."
}

$testSigning = (& bcdedit /enum '{current}' 2>$null | Select-String -Pattern 'testsigning\s+Yes')
if (-not $testSigning) {
  throw "Windows test signing is not enabled. On a VM/test machine only, run 'bcdedit /set testsigning on' from elevated PowerShell, reboot, then rerun this script."
}

$inf = Get-ChildItem -Path $packageDir -Filter 'ComponentizedAudioSample.inf' -ErrorAction SilentlyContinue |
  Select-Object -First 1

if (-not $inf) {
  throw "Built SysVAD package was not found. Install the WDK driver toolsets, then run npm run driver:build first."
}

Write-Host "Installing SysVAD driver package:"
Write-Host $packageDir
& pnputil /add-driver (Join-Path $packageDir '*.inf') /install
if ($LASTEXITCODE -ne 0) {
  throw "pnputil failed with exit code $LASTEXITCODE."
}
