$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$solution = Join-Path $root 'driver\audio\sysvad\sysvad.sln'
$wdkRoot = 'C:\Program Files (x86)\Windows Kits\10'
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'

if (-not (Test-Path -LiteralPath $vswhere)) {
  throw "vswhere.exe not found. Install Visual Studio Build Tools first."
}

function Get-BuildToolsPath {
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
  $vcRoot = Join-Path $InstallPath 'MSBuild\Microsoft\VC'
  $vcVersion = Get-ChildItem -Path $vcRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^v\d+$' } |
    Sort-Object Name -Descending |
    Select-Object -First 1

  if (-not $vcVersion) {
    throw "Visual C++ MSBuild platform folder was not found under $vcRoot"
  }

  return (Join-Path $vcVersion.FullName 'Platforms')
}

$buildTools = Get-BuildToolsPath
if (-not $buildTools) {
  throw "Visual Studio was not found."
}

$msbuild = Join-Path $buildTools 'MSBuild\Current\Bin\amd64\MSBuild.exe'
$platforms = Get-VcPlatformsPath $buildTools

if (-not (Test-Path -LiteralPath $solution)) {
  throw "SysVAD solution not found. Run: git clone --filter=blob:none --sparse https://github.com/microsoft/Windows-driver-samples.git driver; git -C driver sparse-checkout set audio/sysvad"
}

if (-not (Test-Path -LiteralPath $msbuild)) {
  throw "MSBuild not found at $msbuild"
}

$kernelToolset = Get-ChildItem -Path $platforms -Recurse -ErrorAction SilentlyContinue | Where-Object {
  $_.FullName -match 'WindowsKernelModeDriver10\.0'
} | Select-Object -First 1

$driverAppToolset = Get-ChildItem -Path $platforms -Recurse -ErrorAction SilentlyContinue | Where-Object {
  $_.FullName -match 'WindowsApplicationForDrivers10\.0'
} | Select-Object -First 1

if (-not $kernelToolset -or -not $driverAppToolset) {
  $wdkKernelHeader = Get-ChildItem -Path (Join-Path $wdkRoot 'Include') -Recurse -Filter 'portcls.h' -ErrorAction SilentlyContinue | Select-Object -First 1
  $wdkPortClsLib = Get-ChildItem -Path (Join-Path $wdkRoot 'Lib') -Recurse -Filter 'portcls.lib' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($wdkKernelHeader -and $wdkPortClsLib) {
    throw "WDK files are installed, but the Visual Studio WDK build component is missing. Add component: Component.Microsoft.Windows.DriverKit. Required platform toolsets: WindowsKernelModeDriver10.0 and WindowsApplicationForDrivers10.0."
  }
  throw "WDK Visual Studio driver toolsets are missing. Required: WindowsKernelModeDriver10.0 and WindowsApplicationForDrivers10.0."
}

& $msbuild $solution /p:Configuration=Debug /p:Platform=x64 /m
if ($LASTEXITCODE -ne 0) {
  throw "SysVAD build failed with exit code $LASTEXITCODE."
}
