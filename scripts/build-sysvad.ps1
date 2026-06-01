$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$solution = Join-Path $root 'driver\audio\sysvad\sysvad.sln'
$msbuild = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\amd64\MSBuild.exe'
$platforms = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Platforms'
$wdkRoot = 'C:\Program Files (x86)\Windows Kits\10'

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
    throw "WDK files are installed, but the Visual Studio WDK build component is missing. Add component: Component.Microsoft.Windows.DriverKit.BuildTools. Required platform toolsets: WindowsKernelModeDriver10.0 and WindowsApplicationForDrivers10.0."
  }
  throw "WDK Visual Studio driver toolsets are missing. Required: WindowsKernelModeDriver10.0 and WindowsApplicationForDrivers10.0."
}

& $msbuild $solution /p:Configuration=Debug /p:Platform=x64 /m
