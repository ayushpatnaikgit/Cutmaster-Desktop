# Cutmaster AI installer for Windows (PowerShell).
#
#   irm https://raw.githubusercontent.com/ayushpatnaikgit/Cutmaster-Desktop/main/install.ps1 | iex
#
# Sets up %USERPROFILE%\Cutmaster (your footage folder and settings), downloads
# the app as a Docker image, starts it and opens it in your browser. Your
# videos, assets and key live in a Docker volume, so updating never loses them.
#
# Options (environment variables): CUTMASTER_HOME, CUTMASTER_PORT,
# CUTMASTER_IMAGE, CUTMASTER_NO_OPEN=1

$ErrorActionPreference = 'Stop'
$Image = if ($env:CUTMASTER_IMAGE) { $env:CUTMASTER_IMAGE } else { 'ghcr.io/ayushpatnaikgit/cutmaster-desktop:latest' }
$HomeDir = if ($env:CUTMASTER_HOME) { $env:CUTMASTER_HOME } else { Join-Path $env:USERPROFILE 'Cutmaster' }
$Port = $env:CUTMASTER_PORT

function Say($m) { Write-Host $m -ForegroundColor Cyan }
function Info($m) { Write-Host "  $m" }
function Die($m) { Write-Host "`n$m" -ForegroundColor Red; exit 1 }

Say 'Installing Cutmaster AI'

# ---------------------------------------------------------------- Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Die "Cutmaster runs inside Docker, which isn't installed.
Install Docker Desktop for Windows: https://docs.docker.com/desktop/setup/install/windows-install/
Open it once, wait for it to say it's running, then run this installer again."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $dd) {
    Info 'Starting Docker Desktop...'
    Start-Process $dd
    for ($i = 0; $i -lt 60; $i++) { Start-Sleep 2; docker info *> $null; if ($LASTEXITCODE -eq 0) { break } }
  }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) { Die 'Docker is installed but not running. Start Docker Desktop, wait until it says it is running, then run this again.' }
}
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Die "Your Docker is missing 'compose'. Update Docker Desktop." }
Info "Docker $(docker version --format '{{.Server.Version}}') is running"

# ---------------------------------------------------------------- port
function InUse($p) { [bool](Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) }
$envFile = Join-Path $HomeDir '.env'
if (-not $Port -and (Test-Path $envFile)) { $Port = ((Get-Content $envFile) | Where-Object { $_ -like 'PORT=*' }) -replace 'PORT=', '' }
if (-not $Port) {
  $Port = 4322
  $running = (docker ps --format '{{.Names}}') -contains 'cutmaster-app'
  if (-not $running) { while (InUse $Port) { $Port++ } }
}

# ---------------------------------------------------------------- files
New-Item -ItemType Directory -Force -Path (Join-Path $HomeDir 'media') | Out-Null
# UTF-8 without BOM so Docker Compose reads the files cleanly.
$utf8 = New-Object System.Text.UTF8Encoding $false
[IO.File]::WriteAllText($envFile, @"
# Cutmaster settings. Run 'cutmaster restart' after changing them.
PORT=$Port
IMAGE=$Image
# Seconds the agent waits for your answer before carrying on alone.
ASK_TIMEOUT=7200
"@, $utf8)

[IO.File]::WriteAllText((Join-Path $HomeDir 'docker-compose.yml'), @'
# Cutmaster AI. Managed by the 'cutmaster' command; settings are in .env.
name: cutmaster
services:
  app:
    image: ${IMAGE}
    container_name: cutmaster-app
    ports:
      - "127.0.0.1:${PORT}:4322"   # only this computer can reach it
    environment:
      ASK_TIMEOUT: "${ASK_TIMEOUT:-7200}"
    volumes:
      - data:/data                                  # videos, assets, brand kit, key, usage
      - models:/home/cutmaster/.cache/huggingface   # speech model, downloaded once
      - ./media:/media:ro                           # your footage: use "From disk" with /media/<file>
    shm_size: "2gb"
    restart: unless-stopped
volumes:
  data:
  models:
'@, $utf8)

[IO.File]::WriteAllText((Join-Path $HomeDir 'cutmaster.ps1'), @'
# Cutmaster AI - start, stop, update and check the app.
param([string]$Command = 'help')
$Dir = $PSScriptRoot
$Port = ((Get-Content (Join-Path $Dir '.env')) | Where-Object { $_ -like 'PORT=*' }) -replace 'PORT=', ''
$Url = "http://localhost:$Port"
function dc { docker compose --project-directory $Dir @args }
function WaitUp {
  Write-Host -NoNewline 'Starting'
  for ($i = 0; $i -lt 90; $i++) {
    try { Invoke-WebRequest "$Url/api/version" -UseBasicParsing -TimeoutSec 2 | Out-Null; Write-Host " ready at $Url"; return $true } catch { Write-Host -NoNewline '.'; Start-Sleep 2 }
  }
  Write-Host "`nIt's taking a while - see 'cutmaster logs'."; return $false
}
switch ($Command) {
  'start'   { dc up -d; if (WaitUp) { Start-Process $Url } }
  'stop'    { dc stop }
  'restart' { dc up -d --force-recreate; WaitUp | Out-Null }
  'update'  { dc pull; dc up -d; if (WaitUp) { Write-Host "Now running $((Invoke-RestMethod "$Url/api/version").version)" } }
  'logs'    { dc logs -f --tail 100 }
  'open'    { Start-Process $Url }
  'media'   { Start-Process (Join-Path $Dir 'media') }
  'status'  {
    dc ps
    try {
      $d = Invoke-RestMethod "$Url/api/doctor?fresh=1"
      Write-Host "`nCutmaster $($d.version)"
      foreach ($c in $d.checks) {
        $mark = @{ ok = '[ok]'; warn = '[!]'; fail = '[x]' }[$c.status]
        Write-Host "  $mark $($c.label): $($c.detail)"
        if ($c.fix) { Write-Host "      -> $($c.fix)" }
      }
    } catch { Write-Host "Not running - 'cutmaster start'" }
  }
  'uninstall' {
    $a = Read-Host 'Remove Cutmaster? Your videos and settings are kept unless you type "delete" (y/N/delete)'
    if ($a -eq 'delete') { dc down -v --rmi all; Write-Host "Removed, including all videos. You can delete $Dir." }
    elseif ($a -eq 'y') { dc down --rmi all; Write-Host 'Removed the app. Your videos are kept in Docker; reinstall to get them back.' }
    else { Write-Host 'Nothing changed.' }
  }
  default {
    Write-Host "Cutmaster AI - $Url"
    Write-Host '  cutmaster start      start it and open the browser'
    Write-Host '  cutmaster stop       stop it'
    Write-Host '  cutmaster update     download the latest version'
    Write-Host '  cutmaster status     is it running, and is everything it needs working?'
    Write-Host "  cutmaster logs       what it's doing (Ctrl-C to leave)"
    Write-Host '  cutmaster open       open it in the browser'
    Write-Host '  cutmaster media      open your footage folder'
    Write-Host '  cutmaster uninstall  remove it'
  }
}
'@, $utf8)

# 'cutmaster' works from any terminal: a .cmd shim on the user's PATH.
[IO.File]::WriteAllText((Join-Path $HomeDir 'cutmaster.cmd'), "@powershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0cutmaster.ps1`" %*`r`n", $utf8)
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $HomeDir })) {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$HomeDir".Trim(';'), 'User')
  $env:Path = "$env:Path;$HomeDir"
}

# ---------------------------------------------------------------- image
Say 'Downloading Cutmaster (a couple of GB the first time)...'
docker pull $Image
if ($LASTEXITCODE -ne 0) {
  docker image inspect $Image *> $null
  if ($LASTEXITCODE -ne 0) { Die "Couldn't download $Image. Check your internet connection and try again." }
  Info "Couldn't reach the registry - using the copy already on this computer."
}

Say 'Starting...'
docker compose --project-directory $HomeDir up -d
$up = $false
for ($i = 0; $i -lt 90; $i++) {
  try { Invoke-WebRequest "http://localhost:$Port/api/version" -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true; break } catch { Start-Sleep 2 }
}
if (-not $up) { Die 'Cutmaster did not start. See: docker logs cutmaster-app' }

Say "Cutmaster AI is running at http://localhost:$Port"
Info "Put camera files in $HomeDir\media and use `"From disk`" with /media/<file name>."
Info 'Add your Gemini API key under "Settings" (bottom left) - get one at aistudio.google.com/apikey.'
Info "Manage it from a new terminal with: cutmaster start | stop | update | status"
if ($env:CUTMASTER_NO_OPEN -ne '1') { Start-Process "http://localhost:$Port" }
