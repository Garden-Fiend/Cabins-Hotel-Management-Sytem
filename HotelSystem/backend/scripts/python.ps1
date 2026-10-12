param([Parameter(ValueFromRemainingArguments=$true)][string[]]$PythonArguments)
# Clear contamination in this process only; never alter global/ZKBioTime settings.
Remove-Item Env:PYTHONHOME,Env:PYTHONPATH -ErrorAction SilentlyContinue
$backendPython = Join-Path (Split-Path $PSScriptRoot -Parent) '.venv\Scripts\python.exe'
& $backendPython -I @PythonArguments
exit $LASTEXITCODE
