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
Set-Location $backendRoot

Write-Host "Backend root: $backendRoot"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js was not found in PATH. Install Node.js 18+ and try again."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Error "npm was not found in PATH. Install Node.js/npm and try again."
}

$nodeVersion = node --version
$npmVersion = npm --version
Write-Host "Node: $nodeVersion"
Write-Host "npm:  $npmVersion"

Write-Host "Installing dependencies..."
npm install

Write-Host "Building backend..."
npm run build

$envExamplePath = Join-Path $backendRoot '.env.example'
$envPath = Join-Path $backendRoot '.env'
if (-not (Test-Path $envPath)) {
  if (-not (Test-Path $envExamplePath)) {
    Write-Error ".env.example was not found at $envExamplePath"
  }
  Copy-Item $envExamplePath $envPath
  Write-Host "Created .env from .env.example"
} else {
  Write-Host ".env already exists. Leaving it unchanged."
}

$logsDir = Join-Path $backendRoot 'logs'
if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
  Write-Host "Created logs folder"
} else {
  Write-Host "logs folder already exists"
}

Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Fill WHATSAPP_ACCESS_TOKEN in backend\.env"
Write-Host "2. Start backend:      .\scripts\start-backend.ps1"
Write-Host "3. Test health:        .\scripts\test-health.ps1"
Write-Host "4. Start tunnel:       .\scripts\start-cloudflare.ps1"
Write-Host "5. Start both windows: .\scripts\start-all.ps1"
