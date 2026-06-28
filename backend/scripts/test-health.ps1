$ErrorActionPreference = 'Stop'

$scriptDir = if ($PSScriptRoot) {
  $PSScriptRoot
} else {
  Split-Path -Parent $PSCommandPath
}

if (-not $scriptDir) {
  $scriptDir = (Get-Location).Path
}

$backendDir = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $backendDir

$uri = 'http://localhost:3002/health'

try {
  $response = Invoke-RestMethod -Uri $uri -Method Get
  $response | ConvertTo-Json -Depth 10
} catch {
  Write-Host "Health check failed for $uri"
  if ($_.Exception.Response) {
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $reader.BaseStream.Position = 0
    $reader.DiscardBufferedData()
    $body = $reader.ReadToEnd()
    if ($body) {
      Write-Host $body
    }
  }
  throw
}
