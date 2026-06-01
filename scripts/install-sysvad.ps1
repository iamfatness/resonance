$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$driverRoot = Join-Path $root 'driver\audio\sysvad'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  throw "SysVAD installation requires an elevated PowerShell window."
}

$testSigning = (& bcdedit /enum '{current}' 2>$null | Select-String -Pattern 'testsigning\s+Yes')
if (-not $testSigning) {
  throw "Windows test signing is not enabled. Run 'bcdedit /set testsigning on' from elevated PowerShell, reboot, then rerun this script."
}

$inf = Get-ChildItem -Path $driverRoot -Recurse -Filter 'TabletAudioSample.inf' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\(Debug|Release)\\' -and $_.FullName -match '\\x64\\' } |
  Select-Object -First 1

if (-not $inf) {
  throw "Built SysVAD TabletAudioSample.inf was not found. Install the WDK driver toolsets, then run npm run driver:build first."
}

Write-Host "Installing SysVAD driver package:"
Write-Host $inf.FullName
& pnputil /add-driver $inf.FullName /install
