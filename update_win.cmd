@echo off
REM ── Lineup CEP Extension Updater (Windows) ────────────────────────────────
REM Copies changed files to the installed location.
REM No AE restart needed — just right-click inside the Lineup panel
REM and choose "Reload Extension".
REM
REM TIP: Run dev_setup_win.cmd once to symlink the source folder instead,
REM      then you never need to run this update script at all.
REM Run install_win.cmd first if this is a fresh machine.

set EXT_DIR=%AppData%\Adobe\CEP\extensions
set EXT_ID=com.thinkingbox.lineup
set DEST=%EXT_DIR%\%EXT_ID%

if not exist "%DEST%" (
    echo Extension not installed yet. Running install_win.cmd instead...
    call "%~dp0install_win.cmd"
    exit /b
)

echo Updating Lineup CEP extension...

REM Update each subfolder and the root HTML file
xcopy /E /I /Q /Y "%~dp0CSXS" "%DEST%\CSXS" >nul
xcopy /E /I /Q /Y "%~dp0host" "%DEST%\host" >nul
xcopy /E /I /Q /Y "%~dp0css"  "%DEST%\css"  >nul
xcopy /E /I /Q /Y "%~dp0js"   "%DEST%\js"   >nul
xcopy /E /I /Q /Y "%~dp0data" "%DEST%\data" >nul
copy  /Y          "%~dp0index.html" "%DEST%\index.html" >nul

echo.
echo Done! To pick up the changes in After Effects:
echo   1. Close the Lineup panel  (click X on the panel tab)
echo   2. Reopen via  Window ^> Extensions ^> Lineup
echo.
pause
