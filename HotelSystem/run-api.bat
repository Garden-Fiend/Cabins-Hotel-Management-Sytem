@echo off
rem Starts API mode (5173) and independent demo mode (5174) for comparison.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-api.ps1" %*
if errorlevel 1 pause
