@echo off
REM ============================================================================
REM ship.bat - rebuild every shippable artifact after a code change.
REM Run this before committing. It refreshes, in order:
REM   - the web build (app\dist)
REM   - all three APK flavors (carbon / compat / full)
REM   - the packaged files the server serves:
REM       server\apk\*.apk, server\apk\version.json, server\web-dist.zip
REM The version is bumped once so devices see a new self-update.
REM ============================================================================
setlocal
cd /d "%~dp0"

echo === [1/6] Typecheck (app + server) ===
call npm run typecheck
if errorlevel 1 goto err

echo === [2/6] Bump app version ===
call npm run bump:version
if errorlevel 1 goto err

echo === [3/6] Build web (app\dist) ===
call npm run build
if errorlevel 1 goto err

echo === [4/6] Cap sync + assemble APKs (carbon / compat / full) ===
call npx cap sync android
if errorlevel 1 goto err
pushd android
call .\gradlew.bat assembleDebug
set "GRADLE_ERR=%errorlevel%"
popd
if not "%GRADLE_ERR%"=="0" goto err

echo === [5/6] Pack APKs -^> server\apk ===
call npm run pack:apk
if errorlevel 1 goto err

echo === [6/6] Pack web -^> server\web-dist.zip ===
call node scripts\pack-web.mjs
if errorlevel 1 goto err

echo.
echo === Done. Shippable artifacts refreshed. Review before committing: ===
git status --short
exit /b 0

:err
echo.
echo *** FAILED at the step above - nothing further packed. Fix and re-run. ***
exit /b 1
