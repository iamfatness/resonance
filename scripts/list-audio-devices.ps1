$ErrorActionPreference = 'Stop'

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

$devices = Get-CimInstance Win32_PnPEntity |
  Where-Object { $_.PNPClass -eq 'AudioEndpoint' -or $_.Service -eq 'AudioEndpointBuilder' } |
  ForEach-Object {
    $role = Get-AudioEndpointRole -Name $_.Name -Id $_.PNPDeviceID
    [pscustomobject]@{
      id = $_.PNPDeviceID
      name = $_.Name
      role = $role
      status = $_.Status
      available = $_.Status -eq 'OK'
      manufacturer = $_.Manufacturer
      pnpClass = $_.PNPClass
    }
  }

if (-not $devices) {
  $devices = Get-CimInstance Win32_SoundDevice | ForEach-Object {
    [pscustomobject]@{
      id = $_.PNPDeviceID
      name = $_.Name
      role = 'unknown'
      status = $_.Status
      available = $_.Status -eq 'OK'
      manufacturer = $_.Manufacturer
      pnpClass = $_.PNPClass
    }
  }
}

$devices | ConvertTo-Json -Depth 4
