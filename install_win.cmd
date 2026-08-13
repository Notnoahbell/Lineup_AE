@echo off
REM ── Lineup CEP Extension Installer (Windows) ──────────────────────────────
REM Copies the extension to the CEP extensions folder and enables debug mode
REM so unsigned extensions are allowed.
REM Run as Administrator if you get permission errors.

set EXT_DIR=%AppData%\Adobe\CEP\extensions
set EXT_ID=com.thinkingbox.lineup

echo Installing Lineup CEP extension...

REM Create extensions directory if it doesn't exist
if not exist "%EXT_DIR%" mkdir "%EXT_DIR%"

REM Remove old version if present
if exist "%EXT_DIR%\%EXT_ID%" (
    echo Removing old installation...
    rmdir /s /q "%EXT_DIR%\%EXT_ID%"
)

REM Copy extension folder (exclude the cmd scripts to keep the install clean)
echo Copying extension files...
xcopy /E /I /Q "%~dp0." "%EXT_DIR%\%EXT_ID%"
REM Ensure .debug file is included (xcopy skips dot-files by default on some systems)
if exist "%~dp0.debug" copy /Y "%~dp0.debug" "%EXT_DIR%\%EXT_ID%\.debug" >nul

REM Enable PlayerDebugMode for unsigned extensions. The manifest supports AE
REM 15.0+ (CC 2018), which spans CSXS 6 through whatever's current — different
REM machines' AE installs use different CSXS versions, and AE will list the
REM extension either way but silently refuse to open an unsigned one unless
REM its specific CSXS version has this key set. Cover the whole known range.
echo Enabling debug mode for unsigned extensions...
for %%v in (6 7 8 9 10 11 12 13) do (
    reg add "HKCU\SOFTWARE\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)

REM Verify the writes actually took — on locked-down machines, antivirus or
REM Group Policy can silently block "reg add" with no visible error above,
REM which is exactly what causes "shows in the menu but won't open".
echo.
echo Verifying debug mode was enabled...
set ANY_OK=0
for %%v in (6 7 8 9 10 11 12 13) do (
    reg query "HKCU\SOFTWARE\Adobe\CSXS.%%v" /v PlayerDebugMode >nul 2>&1
    if errorlevel 1 (
        echo   CSXS.%%v - not set
    ) else (
        echo   CSXS.%%v - OK
        set ANY_OK=1
    )
)
if "%ANY_OK%"=="0" (
    echo.
    echo WARNING: PlayerDebugMode could not be set for ANY CSXS version.
    echo This is almost always antivirus or a Group Policy blocking registry
    echo writes under HKCU\SOFTWARE\Adobe. Try right-clicking this script and
    echo choosing "Run as Administrator", or ask IT to allow it.
)

REM ── BBQC companion extension ───────────────────────────────────────────────
REM BBQC ships bundled inside this repo (see BBQC_CEP\) but installs as its own
REM separate CEP extension, matching what js/update.js's in-app self-updater
REM does on every Lineup update: silently refresh it if it's already there,
REM otherwise ask before installing it fresh.
set BBQC_SRC=%~dp0BBQC_CEP
set BBQC_DEST=%EXT_DIR%\BBQC_CEP
if not exist "%BBQC_SRC%" goto :after_bbqc
if exist "%BBQC_DEST%" goto :update_bbqc

set /p BBQC_ANSWER=BBQC companion extension not found - install it too? [Y/n]:
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
echo Done! Restart After Effects, then open:
echo   Window ^> Extensions ^> Lineup
if exist "%BBQC_DEST%" echo   Window ^> Extensions ^> BBQC
echo.
pause
