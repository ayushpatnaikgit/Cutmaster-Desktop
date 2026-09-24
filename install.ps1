# Elyps AI installer for Windows (PowerShell).
#
#   irm https://raw.githubusercontent.com/ayushpatnaikgit/Elyps-AI/main/install.ps1 | iex
#
# Sets up %USERPROFILE%\Elyps (your footage folder and settings), downloads
# the app as a Docker image, starts it and opens it in your browser. Your
# videos, assets and key live in a Docker volume, so updating never loses them.
#
# Options (environment variables): ELYPS_HOME, ELYPS_PORT,
# ELYPS_IMAGE, ELYPS_NO_OPEN=1

$ErrorActionPreference = 'Stop'
$Image = if ($env:ELYPS_IMAGE) { $env:ELYPS_IMAGE } else { 'ghcr.io/ayushpatnaikgit/elyps:latest' }
$HomeDir = if ($env:ELYPS_HOME) { $env:ELYPS_HOME } else { Join-Path $env:USERPROFILE 'Elyps' }
$Port = $env:ELYPS_PORT

function Say($m) { Write-Host $m -ForegroundColor Cyan }
function Info($m) { Write-Host "  $m" }
function Die($m) { Write-Host "`n$m" -ForegroundColor Red; exit 1 }

Say 'Installing Elyps AI'

# ---------------------------------------------------------------- Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Die "Elyps runs inside Docker, which isn't installed.
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
  $running = (docker ps --format '{{.Names}}') -contains 'elyps-app'
  if (-not $running) { while (InUse $Port) { $Port++ } }
}

# ---------------------------------------------------------------- files
New-Item -ItemType Directory -Force -Path (Join-Path $HomeDir 'media') | Out-Null
# UTF-8 without BOM so Docker Compose reads the files cleanly.
$utf8 = New-Object System.Text.UTF8Encoding $false
[IO.File]::WriteAllText($envFile, @"
# Elyps settings. Run 'elyps restart' after changing them.
PORT=$Port
IMAGE=$Image
# Seconds the agent waits for your answer before carrying on alone.
ASK_TIMEOUT=7200
# How many edits run at the same time (each needs about 2-3 GB of memory).
MAX_EDITS=3
"@, $utf8)

[IO.File]::WriteAllText((Join-Path $HomeDir 'docker-compose.yml'), @'
# Elyps AI. Managed by the 'elyps' command; settings are in .env.
name: elyps
services:
  app:
    image: ${IMAGE}
    container_name: elyps-app
    ports:
      - "127.0.0.1:${PORT}:4322"   # only this computer can reach it
    environment:
      ASK_TIMEOUT: "${ASK_TIMEOUT:-7200}"
      MAX_EDITS: "${MAX_EDITS:-3}"
    volumes:
      - data:/data                                  # videos, assets, brand kit, key, usage
      - models:/home/elyps/.cache/huggingface   # speech model, downloaded once
      - ./media:/media:ro                           # your footage: use "From disk" with /media/<file>
    shm_size: "2gb"
    restart: unless-stopped
volumes:
  data:
  models:
'@, $utf8)

[IO.File]::WriteAllText((Join-Path $HomeDir 'elyps.ps1'), @'
# Elyps AI - start, stop, update and check the app.
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
  Write-Host "`nIt's taking a while - see 'elyps logs'."; return $false
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
      Write-Host "`nElyps $($d.version)"
      foreach ($c in $d.checks) {
        $mark = @{ ok = '[ok]'; warn = '[!]'; fail = '[x]' }[$c.status]
        Write-Host "  $mark $($c.label): $($c.detail)"
        if ($c.fix) { Write-Host "      -> $($c.fix)" }
      }
    } catch { Write-Host "Not running - 'elyps start'" }
  }
  'uninstall' {
    $a = Read-Host 'Remove Elyps? Your videos and settings are kept unless you type "delete" (y/N/delete)'
    if ($a -eq 'delete') { dc down -v --rmi all; Write-Host "Removed, including all videos. You can delete $Dir." }
    elseif ($a -eq 'y') { dc down --rmi all; Write-Host 'Removed the app. Your videos are kept in Docker; reinstall to get them back.' }
    else { Write-Host 'Nothing changed.' }
  }
  default {
    Write-Host "Elyps AI - $Url"
    Write-Host '  elyps start      start it and open the browser'
    Write-Host '  elyps stop       stop it'
    Write-Host '  elyps update     download the latest version'
    Write-Host '  elyps status     is it running, and is everything it needs working?'
    Write-Host "  elyps logs       what it's doing (Ctrl-C to leave)"
    Write-Host '  elyps open       open it in the browser'
    Write-Host '  elyps media      open your footage folder'
    Write-Host '  elyps uninstall  remove it'
  }
}
'@, $utf8)

# 'elyps' works from any terminal: a .cmd shim on the user's PATH.
[IO.File]::WriteAllText((Join-Path $HomeDir 'elyps.cmd'), "@powershell -NoProfile -ExecutionPolicy Bypass -File `"%~dp0elyps.ps1`" %*`r`n", $utf8)
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $HomeDir })) {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$HomeDir".Trim(';'), 'User')
  $env:Path = "$env:Path;$HomeDir"
}

# ---------------------------------------------------------------- image
Say 'Downloading Elyps (a couple of GB the first time)...'
docker pull $Image
if ($LASTEXITCODE -ne 0) {
  docker image inspect $Image *> $null
  if ($LASTEXITCODE -ne 0) { Die "Couldn't download $Image. Check your internet connection and try again." }
  Info "Couldn't reach the registry - using the copy already on this computer."
}

# ---------------------------------------------------------------- moving from Cutmaster
# Elyps used to be called Cutmaster. Bring an old install's videos and key along.
docker volume inspect cutmaster_data *> $null
$hasOld = ($LASTEXITCODE -eq 0)
docker volume inspect elyps_data *> $null
$hasNew = ($LASTEXITCODE -eq 0)
if ($hasOld -and -not $hasNew) {
  Say 'Moving your videos from Cutmaster...'
  docker rm -f cutmaster-app *> $null
  docker volume create elyps_data | Out-Null
  docker run --rm --user 0 --entrypoint sh -v cutmaster_data:/from:ro -v elyps_data:/to $Image -c 'cp -a /from/. /to/'
  Info 'Done. The old copy is kept (Docker volume cutmaster_data); remove it any time with: docker volume rm cutmaster_data'
}

Say 'Starting...'
docker compose --project-directory $HomeDir up -d
$up = $false
for ($i = 0; $i -lt 90; $i++) {
  try { Invoke-WebRequest "http://localhost:$Port/api/version" -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true; break } catch { Start-Sleep 2 }
}
if (-not $up) { Die 'Elyps did not start. See: docker logs elyps-app' }

Say "Elyps AI is running at http://localhost:$Port"
Info "Put camera files in $HomeDir\media and use `"From disk`" with /media/<file name>."
Info 'Add your Gemini API key under "Settings" (bottom left) - get one at aistudio.google.com/apikey.'
Info "Manage it from a new terminal with: elyps start | stop | update | status"
if ($env:ELYPS_NO_OPEN -ne '1') { Start-Process "http://localhost:$Port" }
