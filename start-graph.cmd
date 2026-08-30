@echo off
setlocal

where pwsh.exe >nul 2>nul
if errorlevel 1 (
  set "POWERSHELL_EXE=powershell.exe"
) else (
  set "POWERSHELL_EXE=pwsh.exe"
)

if "%~1"=="" (
  "%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-graph.ps1"
) else (
  "%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-graph.ps1" %*
)
set "START_GRAPH_EXIT_CODE=%ERRORLEVEL%"

if not "%START_GRAPH_EXIT_CODE%"=="0" (
  echo.
  echo Startup failed. Review the messages above.
  pause
)

exit /b %START_GRAPH_EXIT_CODE%
