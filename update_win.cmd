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
xcopy /E /I /Q /Y "%~dp0bin"  "%DEST%\bin"  >nul
copy  /Y          "%~dp0index.html" "%DEST%\index.html" >nul
REM Re-stage BBQC's files inside Lineup's own folder — same staging spot the
REM in-app self-updater uses (js/update.js), whether or not BBQC is actually
REM installed as its own extension below.
if exist "%~dp0BBQC_CEP" xcopy /E /I /Q /Y "%~dp0BBQC_CEP" "%DEST%\BBQC_CEP" >nul

REM ── BBQC companion extension ───────────────────────────────────────────────
REM Mirrors js/update.js: silently refresh BBQC if it's already installed as
REM its own extension, otherwise ask before installing it fresh.
set BBQC_SRC=%~dp0BBQC_CEP
set BBQC_DEST=%EXT_DIR%\BBQC_CEP
if not exist "%BBQC_SRC%" goto :after_bbqc
if exist "%BBQC_DEST%" goto :update_bbqc

set /p BBQC_ANSWER=BBQC companion extension not found - install it now? [Y/n]:
if /i "%BBQC_ANSWER%"=="n" goto :after_bbqc
echo Installing BBQC...
xcopy /E /I /Q "%BBQC_SRC%" "%BBQC_DEST%\" >nul
echo BBQC installed.
goto :after_bbqc

:update_bbqc
echo Updating BBQC companion extension...
xcopy /E /I /Q /Y "%BBQC_SRC%\CSXS"  "%BBQC_DEST%\CSXS"  >nul
xcopy /E /I /Q /Y "%BBQC_SRC%\certs" "%BBQC_DEST%\certs" >nul
xcopy /E /I /Q /Y "%BBQC_SRC%\css"   "%BBQC_DEST%\css"   >nul
xcopy /E /I /Q /Y "%BBQC_SRC%\js"    "%BBQC_DEST%\js"    >nul
xcopy /E /I /Q /Y "%BBQC_SRC%\jsx"   "%BBQC_DEST%\jsx"   >nul
copy  /Y          "%BBQC_SRC%\index.html" "%BBQC_DEST%\index.html" >nul

:after_bbqc
echo.
echo Done! To pick up the changes in After Effects:
echo   1. Close the Lineup panel  (click X on the panel tab)
echo   2. Reopen via  Window ^> Extensions ^> Lineup
echo.
pause
