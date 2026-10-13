param(
    [switch]$CheckOnly,
    [switch]$NoBrowser,
    [ValidateSet('Backend', 'Frontend', 'Demo')][string]$Service
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$backendRoot = Join-Path $projectRoot 'backend'
$pythonPath = Join-Path $backendRoot '.venv\Scripts\python.exe'
$vitePath = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'

# Process-local isolation only; do not modify the machine's Python/ZKBioTime settings.
Remove-Item Env:PYTHONHOME,Env:PYTHONPATH -ErrorAction SilentlyContinue

# Child services run hidden and inherit this launcher process's environment.
if ($Service -eq 'Backend') {
    Set-Location -LiteralPath $backendRoot
    & $pythonPath -I -m uvicorn app.main:app --host 127.0.0.1 --port 8001
    exit $LASTEXITCODE
}
if ($Service -eq 'Frontend') {
    Set-Location -LiteralPath $projectRoot
    $env:VITE_HMS_DATA_MODE = 'api'
    $env:VITE_HMS_API_URL = 'http://127.0.0.1:8001'
    & node $vitePath --mode api --host 127.0.0.1 --port 5173 --strictPort
    exit $LASTEXITCODE
}
if ($Service -eq 'Demo') {
    Set-Location -LiteralPath $projectRoot
    $env:VITE_HMS_DATA_MODE = 'demo'
    Remove-Item Env:VITE_HMS_API_URL -ErrorAction SilentlyContinue
    & node $vitePath --mode demo --host 127.0.0.1 --port 5174 --strictPort
    exit $LASTEXITCODE
}

$children = @()
function Wait-Endpoint([string]$Address, $Child) {
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        $Child.Refresh()
        if ($Child.HasExited) { throw "Service exited. See logs in $logDirectory" }
        try {
            $response = Invoke-WebRequest -Uri $Address -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
    throw "Service readiness timed out: $Address. See $logDirectory"
}

try {
    foreach ($file in @($pythonPath, $vitePath, (Join-Path $backendRoot '.env'))) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Missing prerequisite: $file. Complete the backend/frontend setup first."
        }
    }
    foreach ($command in @('node', 'docker')) { $null = Get-Command $command -ErrorAction Stop }
    foreach ($port in @(8001, 5173, 5174)) {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $port)
        try { $listener.Start() }
        catch { throw "Port $port is occupied. Close your existing service first; this launcher will not stop it." }
        finally { $listener.Stop() }
    }
    & $pythonPath -I -c "from app.settings import get_settings, require_isolated_local_database; s=get_settings(); require_isolated_local_database(s.database_url.get_secret_value()); assert s.env == 'development', 'Development settings required'"
    if ($LASTEXITCODE -ne 0) { throw 'Backend settings must target the isolated hms_dev database.' }
    if ($CheckOnly) {
        Write-Host 'PASS: prerequisites, isolated development settings and ports checked. No services started.'
        exit 0
    }

    Write-Host 'Starting HMS comparison: database, FastAPI, API frontend and independent demo.'
    Write-Host 'Uses loopback ports 55432 / 8001 / 5173 / 5174. Existing configuration files are preserved.'
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & docker info --format '{{.ServerVersion}}' *> $null
    $dockerStatus = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($dockerStatus -ne 0) {
        Write-Host 'Starting Docker Desktop...'
        & docker desktop start
        if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop could not start.' }
    }
    Push-Location -LiteralPath $backendRoot
    try {
        & docker compose up -d --wait postgres
        if ($LASTEXITCODE -ne 0) { throw 'The isolated HMS PostgreSQL container could not start.' }
    } finally { Pop-Location }

    $logDirectory = Join-Path $projectRoot ('logs\api-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $null = New-Item -ItemType Directory -Path $logDirectory -Force
    foreach ($name in @('Backend', 'Frontend', 'Demo')) {
        $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Service ' + $name
        $child = Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $logDirectory ($name + '.out.log')) `
            -RedirectStandardError (Join-Path $logDirectory ($name + '.err.log'))
        $children += $child
        if ($name -eq 'Backend') {
            Wait-Endpoint 'http://127.0.0.1:8001/api/v1/health' $child
            Wait-Endpoint 'http://127.0.0.1:8001/api/v1/reference-data' $child
        } elseif ($name -eq 'Frontend') { Wait-Endpoint 'http://127.0.0.1:5173' $child }
        else { Wait-Endpoint 'http://127.0.0.1:5174' $child }
    }
    Write-Host 'Ready: http://127.0.0.1:5173 — API mode / PostgreSQL'
    Write-Host 'Ready: http://127.0.0.1:5174 — demo mode / browser memory'
    Write-Host "Logs: $logDirectory"
    Write-Host 'Press Enter to stop this launcher''s backend and both frontends. PostgreSQL stays running.'
    if (-not $NoBrowser) {
        Start-Process 'http://127.0.0.1:5173'
        Start-Process 'http://127.0.0.1:5174'
    }
    $null = Read-Host
} catch {
    Write-Host ("HMS startup failed: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    # Stop only child process trees started by this launcher, never unrelated port owners.
    foreach ($child in $children) {
        $child.Refresh()
        if (-not $child.HasExited) { & taskkill.exe /PID $child.Id /T /F *> $null }
    }
}
