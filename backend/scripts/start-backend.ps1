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

function Get-EnvValue([string]$Path, [string]$Key, [string]$DefaultValue) {
  if (-not (Test-Path $Path)) {
    return $DefaultValue
  }

  $line = Get-Content $Path | Where-Object { $_ -match "^\s*$Key\s*=" } | Select-Object -First 1
  if (-not $line) {
    return $DefaultValue
  }

  $value = ($line -split '=', 2)[1].Trim()
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $DefaultValue
  }
  return $value
}

$backendRoot = Get-BackendRoot
Set-Location $backendRoot

$envPath = Join-Path $backendRoot '.env'
$port = Get-EnvValue -Path $envPath -Key 'PORT' -DefaultValue '3002'
$distEntry = Join-Path $backendRoot 'dist\index.js'

Write-Host "Backend root: $backendRoot"
Write-Host "Configured port: $port"

if (Test-Path $distEntry) {
  Write-Host "Starting built backend with npm start..."
  npm start
} else {
  Write-Host "dist\index.js not found. Falling back to npm run dev..."
  npm run dev
}
