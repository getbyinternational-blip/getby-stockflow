$ErrorActionPreference = 'Stop'

function Get-BackendRoot {
  $scriptDir = if ($PSScriptRoot) {
    $PSScriptRoot
  } else {
    Split-Path -Parent $PSCommandPath
  }

  if (-not $scriptDir) {
    $scriptDir = (Get-Location).Path
  }

  $candidate = Resolve-Path (Join-Path $scriptDir '..')
  return $candidate.Path
}

$backendRoot = Get-BackendRoot
$scriptsDir = if ($PSScriptRoot) { $PSScriptRoot } else { Join-Path $backendRoot 'scripts' }
$backendScript = Join-Path $scriptsDir 'start-backend.ps1'
$cloudflareScript = Join-Path $scriptsDir 'start-cloudflare.ps1'

Start-Process powershell -WindowStyle Normal -ArgumentList @(
  '-NoExit',
  '-ExecutionPolicy', 'Bypass',
  '-File', $backendScript
)

Start-Process powershell -WindowStyle Normal -ArgumentList @(
  '-NoExit',
  '-ExecutionPolicy', 'Bypass',
  '-File', $cloudflareScript
)

Write-Host "Started backend and Cloudflare tunnel in separate PowerShell windows."
Write-Host "Reminder: Cloudflare quick tunnel URLs change whenever the tunnel is restarted."
