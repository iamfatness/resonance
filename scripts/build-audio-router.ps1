$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$sourceDir = Join-Path $root 'native\audio-router'
$buildDir = Join-Path $root 'native\audio-router\build'
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'

if (-not (Test-Path -LiteralPath $vcvars)) {
  throw "vcvars64.bat not found at $vcvars"
}

New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

cmd.exe /c "`"$vcvars`" && cmake -S `"$sourceDir`" -B `"$buildDir`" -A x64 && cmake --build `"$buildDir`" --config Release"
