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

function Find-Cloudflared([string]$BackendRoot) {
  $localPath = Join-Path $BackendRoot 'cloudflared.exe'
  if (Test-Path $localPath) {
    return (Resolve-Path $localPath).Path
  }

  $cDrivePath = 'C:\cloudflared.exe'
  if (Test-Path $cDrivePath) {
    return $cDrivePath
  }

  $command = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  return $null
}

$backendRoot = Get-BackendRoot
$cloudflaredPath = Find-Cloudflared -BackendRoot $backendRoot

if (-not $cloudflaredPath) {
  Write-Host "cloudflared.exe was not found."
  Write-Host "Place cloudflared.exe in one of these locations and try again:"
  Write-Host "  - $backendRoot\cloudflared.exe"
  Write-Host "  - C:\cloudflared.exe"
  Write-Host "  - any folder already available in PATH"
  exit 1
}

Write-Host "Using cloudflared: $cloudflaredPath"
& $cloudflaredPath tunnel --url http://localhost:3002
