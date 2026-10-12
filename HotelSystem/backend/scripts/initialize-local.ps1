$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $backendRoot '.env'
if (Test-Path -LiteralPath $envFile) { throw '.env already exists; refusing to overwrite secrets.' }
$secretBytes = New-Object byte[] 32
$generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$generator.GetBytes($secretBytes)
$generator.Dispose()
$localSecret = [Convert]::ToBase64String($secretBytes).Replace('+','A').Replace('/','B').TrimEnd('=')
$envText = @"
HMS_ENV=development
HMS_DB_PASSWORD=$localSecret
HMS_DATABASE_URL=postgresql+psycopg://hms_dev:$localSecret@127.0.0.1:55432/hms_dev
HMS_TEST_DATABASE_URL=postgresql+psycopg://hms_dev:$localSecret@127.0.0.1:55432/hms_test
HMS_CORS_ORIGINS=["http://localhost:5173","http://127.0.0.1:5173"]
"@
[System.IO.File]::WriteAllText($envFile,$envText)
Write-Output 'Created ignored HMS .env with a generated local password; secret not displayed.'
