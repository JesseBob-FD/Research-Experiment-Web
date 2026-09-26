@echo off
cd /d "%~dp0"
node --disable-warning=ExperimentalWarning src\cli.mjs stop
if errorlevel 1 pause
