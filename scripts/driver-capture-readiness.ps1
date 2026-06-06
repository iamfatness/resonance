param(
  [switch] $Json
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$packageDir = Join-Path $root 'driver\audio\sysvad\x64\Debug\package'
$driverInf = Join-Path $packageDir 'ComponentizedAudioSample.inf'
$routerExe = Join-Path $root 'native\audio-router\build\Release\resonance-audio-router.exe'

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-SecureBootEnabled {
  try {
    $state = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State' -Name UEFISecureBootEnabled -ErrorAction Stop
    return ([int]$state.UEFISecureBootEnabled -eq 1)
  } catch {
  }

  try {
    return [bool](Confirm-SecureBootUEFI)
  } catch {
    return $false
  }
}

function Get-AudioEndpointRole {
  param(
    [string] $Name,
    [string] $Id
  )

  if ($Id -match '\{0\.0\.0\.') {
    return 'output'
  }

  if ($Id -match '\{0\.0\.1\.') {
    return 'input'
  }

  if ($Name -match '(?i)(microphone|mic|line in|input|capture)') {
    return 'input'
  }

  if ($Name -match '(?i)(speakers|speaker|headphones|headset|output|display audio|hdmi|render)') {
    return 'output'
  }

  return 'unknown'
}

function Get-AudioEndpoints {
  $devices = Get-CimInstance Win32_PnPEntity |
    Where-Object { $_.PNPClass -eq 'AudioEndpoint' -or $_.Service -eq 'AudioEndpointBuilder' } |
    ForEach-Object {
      [pscustomobject]@{
        id = $_.PNPDeviceID
        name = $_.Name
        role = Get-AudioEndpointRole -Name $_.Name -Id $_.PNPDeviceID
        status = $_.Status
        available = $_.Status -eq 'OK'
        manufacturer = $_.Manufacturer
      }
    }

  if ($devices) {
    return @($devices)
  }

  return @(Get-CimInstance Win32_SoundDevice | ForEach-Object {
    [pscustomobject]@{
      id = $_.PNPDeviceID
      name = $_.Name
      role = 'unknown'
      status = $_.Status
      available = $_.Status -eq 'OK'
      manufacturer = $_.Manufacturer
    }
  })
}

function New-Check($Name, $Status, $Detail, $NextAction = '') {
  return [pscustomobject]@{
    check = $Name
    status = $Status
    detail = $Detail
    nextAction = $NextAction
  }
}

$isAdmin = Test-IsAdmin
$secureBoot = Test-SecureBootEnabled
$testSigning = [bool](& bcdedit /enum '{current}' 2>$null | Select-String -Pattern 'testsigning\s+Yes')
$builtPackage = Test-Path -LiteralPath $driverInf
$nativeRouter = Test-Path -LiteralPath $routerExe
$endpoints = Get-AudioEndpoints
$resonanceEndpoints = @($endpoints | Where-Object { $_.name -match '(?i)resonance' })
$resonanceInputs = @($resonanceEndpoints | Where-Object { $_.role -eq 'input' -or $_.name -match '(?i)(capture|input|microphone|mic)' })
$resonanceOutputs = @($resonanceEndpoints | Where-Object { $_.role -eq 'output' -or $_.name -match '(?i)(speaker|render|output|playback)' })

$checks = [System.Collections.Generic.List[object]]::new()

$checks.Add((New-Check `
      'Built driver package' `
      $(if ($builtPackage) { 'ready' } else { 'blocked' }) `
      $(if ($builtPackage) { $driverInf } else { 'ComponentizedAudioSample.inf was not found.' }) `
      $(if ($builtPackage) { '' } else { 'Run npm run driver:customize:resonance, then npm run driver:build.' })))

$checks.Add((New-Check `
      'Secure Boot install path' `
      $(if ($secureBoot) { 'manual' } else { 'ready' }) `
      $(if ($secureBoot) { 'Secure Boot is enabled; install only a Microsoft-signed production/attestation package.' } else { 'Secure Boot is disabled; local test-signed install is allowed only on a VM/test machine.' }) `
      $(if ($secureBoot) { 'Do not use npm run driver:install:sysvad on this machine. Submit/sign the package before install.' } else { '' })))

$checks.Add((New-Check `
      'Test-signed install preconditions' `
      $(if (-not $secureBoot -and $isAdmin -and $testSigning) { 'ready' } elseif ($secureBoot) { 'blocked' } else { 'manual' }) `
      "elevated=$isAdmin; testSigning=$testSigning" `
      $(if ($secureBoot) { 'Use Microsoft signing for Secure Boot systems.' } elseif (-not $isAdmin -or -not $testSigning) { 'On a VM/test machine, use elevated PowerShell, enable test signing, reboot, then install.' } else { '' })))

$checks.Add((New-Check `
      'Resonance audio endpoint present' `
      $(if ($resonanceEndpoints.Count -gt 0) { 'ready' } else { 'blocked' }) `
      $(if ($resonanceEndpoints.Count -gt 0) { ($resonanceEndpoints.name -join '; ') } else { 'No active AudioEndpoint device name contains Resonance.' }) `
      $(if ($resonanceEndpoints.Count -gt 0) { '' } else { 'Install the signed driver package, then rerun this check.' })))

$checks.Add((New-Check `
      'Resonance capture endpoint' `
      $(if ($resonanceInputs.Count -gt 0) { 'ready' } elseif ($resonanceEndpoints.Count -gt 0) { 'manual' } else { 'blocked' }) `
      $(if ($resonanceInputs.Count -gt 0) { ($resonanceInputs.name -join '; ') } elseif ($resonanceEndpoints.Count -gt 0) { 'Resonance endpoint found, but its capture/input role could not be confirmed from PnP metadata.' } else { 'No Resonance capture/input endpoint found.' }) `
      $(if ($resonanceInputs.Count -gt 0) { '' } else { 'Open Windows Sound settings and confirm the Resonance capture endpoint is enabled.' })))

$checks.Add((New-Check `
      'Native audio router helper' `
      $(if ($nativeRouter) { 'ready' } else { 'blocked' }) `
      $(if ($nativeRouter) { $routerExe } else { 'resonance-audio-router.exe was not found.' }) `
      $(if ($nativeRouter) { '' } else { 'Run npm run native:audio-router.' })))

$checks.Add((New-Check `
      'Deck A/B sustained capture test' `
      'manual' `
      'Requires the desktop UI and an installed virtual endpoint.' `
      'Run npm run desktop:dev, select the Resonance capture endpoint for both decks, start continuous capture on Deck A and Deck B, and monitor meters/underruns for at least 20 minutes.'))

$summary = [pscustomobject]@{
  generatedAt = (Get-Date).ToString('o')
  secureBoot = $secureBoot
  testSigning = $testSigning
  elevated = $isAdmin
  resonanceEndpointCount = $resonanceEndpoints.Count
  resonanceCaptureEndpointCount = $resonanceInputs.Count
  resonancePlaybackEndpointCount = $resonanceOutputs.Count
  checks = $checks
}

if ($Json) {
  $summary | ConvertTo-Json -Depth 5
  exit 0
}

Write-Host 'Resonance driver/capture readiness'
Write-Host ''
$checks | Format-Table -AutoSize
Write-Host ''
Write-Host 'Endpoint summary:'
Write-Host "  Resonance endpoints: $($resonanceEndpoints.Count)"
Write-Host "  Resonance capture endpoints: $($resonanceInputs.Count)"
Write-Host "  Resonance playback endpoints: $($resonanceOutputs.Count)"
Write-Host ''
Write-Host 'Use -Json for a machine-readable diagnostics payload.'
