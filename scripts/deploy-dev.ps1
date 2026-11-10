<#
.SYNOPSIS
  Builds, tests and deploys this dev tree to the local dev site, served by
  the BingoDevServer Windows service. The public URL comes from the
  git-ignored scripts\deploy-dev.local.ps1 (copy deploy-dev.local.example.ps1).

.DESCRIPTION
  Mirrors CAHDigitalGame's deploy.ps1: the running site is a separate copy
  at C:\Production\BingoDev, so editing/rebuilding the dev tree never breaks
  the live site mid-game. Steps: build + test here (the gate), mirror the
  source into the deploy tree, npm ci + build there, (re)install the NSSM
  service if needed, restart it, health-check.

  Run from an elevated PowerShell:  .\scripts\deploy-dev.ps1

.PARAMETER SkipTests
  Emergencies only: deploy without running the test suite first.
#>
param(
  [switch]$SkipTests
)

# Not "Stop": in Windows PowerShell 5.1 a native tool writing a harmless
# warning to stderr (npm does) becomes a terminating error under "Stop".
# Native steps are checked via $LASTEXITCODE instead, and cmdlets that
# must halt the script pass -ErrorAction Stop explicitly.
$ErrorActionPreference = "Continue"

$DevRoot     = Split-Path -Parent $PSScriptRoot
$DeployRoot  = "C:\Production\BingoDev"
$ServiceName = "BingoDevServer"
$Port        = 3002
$PublicUrl   = $null
$LocalConfig = Join-Path $PSScriptRoot "deploy-dev.local.ps1"
if (Test-Path $LocalConfig) { . $LocalConfig }   # sets $PublicUrl
$HealthUrls  = @("http://127.0.0.1:$Port/health")
if ($PublicUrl) { $HealthUrls += "$PublicUrl/health" }

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run this from an elevated (Administrator) PowerShell - it manages a Windows service."
}
$nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $nssm) { throw "nssm not found on PATH (winget install NSSM.NSSM)." }
$node = (Get-Command node).Source

Push-Location $DevRoot
try {
  Write-Step "Building the dev tree"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed." }

  if ($SkipTests) {
    Write-Warn "Skipping tests (-SkipTests)."
  } else {
    Write-Step "Running tests (deploy gate)"
    npm test
    if ($LASTEXITCODE -ne 0) { throw "Tests failed - not deploying." }
    Write-Ok "Tests passed."
  }
} finally {
  Pop-Location
}

Write-Step "Copying source to $DeployRoot"
New-Item -ItemType Directory -Force $DeployRoot -ErrorAction Stop | Out-Null
# /MIR keeps the deploy tree an exact copy of the source. Excluded dirs are
# neither copied nor deleted on the destination, so its node_modules/dist
# logs and data (admin password + settings) survive. robocopy exit codes
# below 8 mean success.
robocopy $DevRoot $DeployRoot /MIR /NFL /NDL /NJH /NJS /NP `
  /XD node_modules dist .git test scripts data `
  /XF *.log *.tsbuildinfo .env | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE." }
$global:LASTEXITCODE = 0
Write-Ok "Copied."

Write-Step "Installing and building in the deploy tree"
Push-Location $DeployRoot
try {
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed in the deploy tree." }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed in the deploy tree." }
} finally {
  Pop-Location
}
Write-Ok "Deploy tree built."

Write-Step "Configuring service $ServiceName"
if (-not (Get-Service $ServiceName -ErrorAction SilentlyContinue)) {
  & $nssm install $ServiceName $node "$DeployRoot\server\dist\index.js" | Out-Null
  Write-Ok "Installed new service."
}
# Re-applied every deploy so the service definition can't drift from this script.
& $nssm set $ServiceName DisplayName "Bingo (dev) Server" | Out-Null
& $nssm set $ServiceName AppDirectory "$DeployRoot\server" | Out-Null
& $nssm set $ServiceName AppEnvironmentExtra "PORT=$Port" "NODE_ENV=production" "GAME_NAME=Bingo Night (dev)" | Out-Null
& $nssm set $ServiceName AppStdout "$DeployRoot\server-stdout.log" | Out-Null
& $nssm set $ServiceName AppStderr "$DeployRoot\server-stderr.log" | Out-Null
& $nssm set $ServiceName AppRotateFiles 1 | Out-Null
& $nssm set $ServiceName AppRotateBytes 10485760 | Out-Null
& $nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
# Lets the server's SIGINT-style shutdown notify players before exit.
& $nssm set $ServiceName AppStopMethodConsole 3000 | Out-Null

Write-Step "Restarting $ServiceName"
$svc = Get-Service $ServiceName -ErrorAction Stop
if ($svc.Status -eq "Running") { Restart-Service $ServiceName -Force -ErrorAction Stop } else { Start-Service $ServiceName -ErrorAction Stop }
Write-Ok "Service is $((Get-Service $ServiceName).Status)."

Write-Step "Health checks"
$failed = @()
foreach ($url in $HealthUrls) {
  $ok = $false
  for ($i = 0; $i -lt 10 -and -not $ok; $i++) {
    try {
      $res = Invoke-RestMethod -Uri $url -TimeoutSec 10
      if ($res.ok) { $ok = $true }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if ($ok) { Write-Ok "$url OK" } else { Write-Warn "$url FAILED"; $failed += $url }
}
if ($failed.Count -gt 0) { throw "Health check failed: $($failed -join ', '). Logs: $DeployRoot\server-stderr.log" }

Write-Host "`nDeployed to $(if ($PublicUrl) { $PublicUrl } else { "http://127.0.0.1:$Port" })" -ForegroundColor Green
