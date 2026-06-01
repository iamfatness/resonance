$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$solution = Join-Path $root 'driver\audio\sysvad\sysvad.sln'
$msbuild = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\amd64\MSBuild.exe'
$platforms = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Microsoft\VC\v170\Platforms'

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
  throw "WDK Visual Studio driver toolsets are missing. Required: WindowsKernelModeDriver10.0 and WindowsApplicationForDrivers10.0."
}

& $msbuild $solution /p:Configuration=Debug /p:Platform=x64 /m
