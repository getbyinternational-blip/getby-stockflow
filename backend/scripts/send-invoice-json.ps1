param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$JsonPath
)

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

function Resolve-InputPath([string]$InputPath) {
  try {
    return (Resolve-Path $InputPath).Path
  } catch {
    Write-Error "JSON file not found: $InputPath"
  }
}

$resolvedPath = Resolve-InputPath $JsonPath
$body = Get-Content $resolvedPath -Raw
$uri = 'http://localhost:3002/api/whatsapp/send-invoice'

try {
  $response = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body $body
  Write-Host "Request succeeded."
  $response | ConvertTo-Json -Depth 10
} catch {
  Write-Host "Request failed."
  if ($_.Exception.Response) {
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $reader.BaseStream.Position = 0
      $reader.DiscardBufferedData()
      $responseBody = $reader.ReadToEnd()
      if ($responseBody) {
        Write-Host $responseBody
      }
    } catch {
      Write-Host "Could not read error response body."
    }
  }
  throw
}
