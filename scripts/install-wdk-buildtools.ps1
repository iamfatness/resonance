$ErrorActionPreference = 'Stop'

$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
$installer = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vs_installer.exe'

if (-not (Test-Path -LiteralPath $vswhere)) {
  throw "vswhere.exe not found. Install Visual Studio Build Tools 2022 first."
}

if (-not (Test-Path -LiteralPath $installer)) {
  throw "Visual Studio Installer not found."
}

$installPath = & $vswhere -latest -products * -property installationPath
if (-not $installPath) {
  throw "Visual Studio Build Tools installation path was not found."
}

Write-Host "Adding Visual Studio WDK Build Tools component to:"
Write-Host $installPath
Write-Host "Component: Component.Microsoft.Windows.DriverKit.BuildTools"

& $installer modify `
  --installPath $installPath `
  --add Component.Microsoft.Windows.DriverKit.BuildTools `
  --passive `
  --norestart

Write-Host "Visual Studio Installer exited with code $LASTEXITCODE."
Write-Host "After installation completes, rerun: npm run driver:build"
