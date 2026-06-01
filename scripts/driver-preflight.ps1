$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$solution = Join-Path $root 'driver\audio\sysvad\sysvad.sln'
$wdkRoot = 'C:\Program Files (x86)\Windows Kits\10'
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'

function Get-BuildToolsPath {
  if (-not (Test-Path -LiteralPath $vswhere)) {
    return $null
  }

  $withWdk = & $vswhere -latest -products * -requires Component.Microsoft.Windows.DriverKit -property installationPath
  if ($withWdk) {
    return $withWdk
  }

  $withToolsets = & $vswhere -all -products * -format json | ConvertFrom-Json |
    Where-Object {
      $platformsPath = Get-VcPlatformsPath $_.installationPath
      (Get-ChildItem -Path $platformsPath -Recurse -ErrorAction SilentlyContinue | Where-Object {
        $_.FullName -match 'WindowsKernelModeDriver10\.0'
      } | Select-Object -First 1)
    } |
    Sort-Object installationVersion -Descending |
    Select-Object -First 1

  if ($withToolsets) {
    return $withToolsets.installationPath
  }

  return (& $vswhere -latest -products * -property installationPath)
}

function Get-VcPlatformsPath($InstallPath) {
  if (-not $InstallPath) {
    return ''
  }

  $vcRoot = Join-Path $InstallPath 'MSBuild\Microsoft\VC'
  $vcVersion = Get-ChildItem -Path $vcRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^v\d+$' } |
    Sort-Object Name -Descending |
    Select-Object -First 1

  if (-not $vcVersion) {
    return ''
  }

  return (Join-Path $vcVersion.FullName 'Platforms')
}

$buildTools = Get-BuildToolsPath
$msbuild = if ($buildTools) { Join-Path $buildTools 'MSBuild\Current\Bin\amd64\MSBuild.exe' } else { '' }
$platforms = Get-VcPlatformsPath $buildTools

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

function Test-ExistsByFilter($Path, $Filter) {
  return [bool](Get-ChildItem -Path $Path -Recurse -Filter $Filter -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-Status($Ready) {
  if ($Ready) { return 'ready' }
  return 'blocked'
}

$hasSolution = Test-Path -LiteralPath $solution
$hasMsbuild = Test-Path -LiteralPath $msbuild
$hasWdkHeader = Test-ExistsByFilter (Join-Path $wdkRoot 'Include') 'portcls.h'
$hasWdkLib = Test-ExistsByFilter (Join-Path $wdkRoot 'Lib') 'portcls.lib'
$hasInf2Cat = Test-ExistsByFilter (Join-Path $wdkRoot 'bin') 'Inf2Cat.exe'
$hasSignTool = Test-ExistsByFilter (Join-Path $wdkRoot 'bin') 'signtool.exe'
$hasKernelToolset = [bool](Get-ChildItem -Path $platforms -Recurse -ErrorAction SilentlyContinue | Where-Object {
  $_.FullName -match 'WindowsKernelModeDriver10\.0'
} | Select-Object -First 1)
$hasDriverAppToolset = [bool](Get-ChildItem -Path $platforms -Recurse -ErrorAction SilentlyContinue | Where-Object {
  $_.FullName -match 'WindowsApplicationForDrivers10\.0'
} | Select-Object -First 1)
$isAdmin = Test-IsAdmin
$secureBoot = Test-SecureBootEnabled
$testSigning = [bool](& bcdedit /enum '{current}' 2>$null | Select-String -Pattern 'testsigning\s+Yes')
$packageDir = Join-Path $root 'driver\audio\sysvad\x64\Debug\package'
$builtInf = Get-ChildItem -Path $packageDir -Filter 'ComponentizedAudioSample.inf' -ErrorAction SilentlyContinue |
  Select-Object -First 1

$checks = @(
  [pscustomobject]@{ check = 'SysVAD source'; status = Get-Status $hasSolution; detail = $solution },
  [pscustomobject]@{ check = 'MSBuild'; status = Get-Status $hasMsbuild; detail = $msbuild },
  [pscustomobject]@{ check = 'WDK kernel header'; status = Get-Status $hasWdkHeader; detail = 'portcls.h' },
  [pscustomobject]@{ check = 'WDK portcls library'; status = Get-Status $hasWdkLib; detail = 'portcls.lib' },
  [pscustomobject]@{ check = 'Inf2Cat'; status = Get-Status $hasInf2Cat; detail = 'Inf2Cat.exe' },
  [pscustomobject]@{ check = 'SignTool'; status = Get-Status $hasSignTool; detail = 'signtool.exe' },
  [pscustomobject]@{ check = 'VS WDK component'; status = Get-Status ([bool](& $vswhere -latest -products * -requires Component.Microsoft.Windows.DriverKit -property installationPath 2>$null)); detail = 'Component.Microsoft.Windows.DriverKit' },
  [pscustomobject]@{ check = 'Kernel driver toolset'; status = Get-Status $hasKernelToolset; detail = 'WindowsKernelModeDriver10.0' },
  [pscustomobject]@{ check = 'Driver app toolset'; status = Get-Status $hasDriverAppToolset; detail = 'WindowsApplicationForDrivers10.0' },
  [pscustomobject]@{ check = 'Elevated shell'; status = Get-Status $isAdmin; detail = 'Required only for test signing and driver install' },
  [pscustomobject]@{ check = 'Secure Boot'; status = if ($secureBoot) { 'blocked' } else { 'ready' }; detail = if ($secureBoot) { 'Test-signed drivers cannot be used with Secure Boot enabled' } else { 'Compatible with local test-signed driver install' } },
  [pscustomobject]@{ check = 'Test signing'; status = Get-Status $testSigning; detail = 'Only for VM/test machine installs without Secure Boot' },
  [pscustomobject]@{ check = 'Built SysVAD package'; status = Get-Status ([bool]$builtInf); detail = if ($builtInf) { $packageDir } else { 'Run npm run driver:build after toolsets are ready' } }
)

$checks | Format-Table -AutoSize

if (-not $hasKernelToolset -or -not $hasDriverAppToolset) {
  Write-Host ''
  Write-Host 'Next command after Visual Studio Installer is idle:'
  Write-Host 'npm run driver:preflight'
  Write-Host ''
  Write-Host 'If toolsets are still blocked, run:'
  Write-Host 'npm run driver:install:wdk-buildtools'
  exit 0
}

if (-not $builtInf) {
  Write-Host ''
  Write-Host 'Ready to build SysVAD:'
  Write-Host 'npm run driver:build'
  exit 0
}

if ($secureBoot) {
  Write-Host ''
  Write-Host 'Build output exists, but this package is test-signed and Secure Boot is enabled.'
  Write-Host 'Do not install it on this machine. Use a VM/test machine for test-signed builds, or move to Microsoft attestation/production signing.'
  exit 0
}

if (-not $isAdmin -or -not $testSigning) {
  Write-Host ''
  Write-Host 'Build output exists. For a VM/test machine only, open elevated PowerShell and enable test signing if needed:'
  Write-Host 'bcdedit /set testsigning on'
  Write-Host 'Then reboot and run: npm run driver:install:sysvad'
  exit 0
}

Write-Host ''
Write-Host 'Ready to install SysVAD:'
Write-Host 'npm run driver:install:sysvad'
