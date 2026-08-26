@echo off
setlocal

where pwsh.exe >nul 2>nul
if errorlevel 1 (
  set "POWERSHELL_EXE=powershell.exe"
) else (
  set "POWERSHELL_EXE=pwsh.exe"
)

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dev.ps1" %*
set "START_DEV_EXIT_CODE=%ERRORLEVEL%"

if not "%START_DEV_EXIT_CODE%"=="0" (
  echo.
  echo Startup failed. Review the messages above.
  pause
)

exit /b %START_DEV_EXIT_CODE%
