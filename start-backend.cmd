@echo off
setlocal

where pwsh.exe >nul 2>nul
if errorlevel 1 (
  set "POWERSHELL_EXE=powershell.exe"
) else (
  set "POWERSHELL_EXE=pwsh.exe"
)

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-backend.ps1"
set "START_BACKEND_EXIT_CODE=%ERRORLEVEL%"

if not "%START_BACKEND_EXIT_CODE%"=="0" (
  echo.
  echo Backend startup failed. Review the messages above.
  pause
)

exit /b %START_BACKEND_EXIT_CODE%
