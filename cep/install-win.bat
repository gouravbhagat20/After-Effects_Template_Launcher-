@echo off
REM BigHappy Launcher — dev install (Windows)
REM Copies the extension into the user CEP folder and enables PlayerDebugMode
REM so the unsigned extension loads. Restart After Effects afterwards.

set "SRC=%~dp0"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.bighappy.launcher"

if exist "%DEST%" rmdir /s /q "%DEST%"
robocopy "%SRC%." "%DEST%" /e /xf install-win.bat install-mac.sh >nul
echo Copied to: %DEST%

REM Allow unsigned extensions for every CEP runtime AE 2019-2025 might use
for %%v in (9 10 11 12) do (
    reg add "HKCU\SOFTWARE\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
)

echo PlayerDebugMode enabled (CSXS 9-12).
echo Restart After Effects, then open: Window ^> Extensions ^> BigHappy Launcher
pause
