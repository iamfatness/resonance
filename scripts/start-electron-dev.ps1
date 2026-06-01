$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$port = 5173
$url = "http://127.0.0.1:$port"

function Test-DevServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$url/" -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

$viteProcess = $null
try {
  if (-not (Test-DevServer)) {
    $viteProcess = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', "$port") -WorkingDirectory $root -PassThru -WindowStyle Hidden
  }

  $ready = $false
  for ($i = 0; $i -lt 30; $i += 1) {
    if (Test-DevServer) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }

  if (-not $ready) {
    throw "Vite dev server did not start at $url"
  }

  $env:RESONANCE_DEV_SERVER_URL = $url
  & (Join-Path $root 'node_modules\.bin\electron.cmd') $root
} finally {
  if ($viteProcess -and -not $viteProcess.HasExited) {
    Stop-Process -Id $viteProcess.Id -Force
  }
}
