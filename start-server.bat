@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ZollTool sync server launcher.
rem Configuration lives in server\.env (KEY=VALUE, gitignored).
rem On first run this script creates it with a random JWT_SECRET and asks you
rem to fill in the owner login before actually starting the server.

if exist "server\.env" goto :load

echo First run - creating server\.env ...
for /f %%G in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set "JWT_SECRET=%%G"
(
  echo # ZollTool sync server configuration
  echo # JWT_SECRET signs login tokens - keep it stable, changing it logs every device out
  echo JWT_SECRET=!JWT_SECRET!
  echo.
  echo # Owner account, seeded on first server start ^(also unlocks the /admin panel^)
  echo OWNER_EMAIL=owner@example.com
  echo OWNER_PASSWORD=change-me-please
  echo.
  echo # Set to 1 to allow account creation without an invite code
  echo REGISTRATION_OPEN=0
) > "server\.env"
echo.
echo Created server\.env with a random JWT_SECRET.
echo Please edit server\.env and set OWNER_EMAIL / OWNER_PASSWORD,
echo then run this script again.
echo.
pause
exit /b 1

:load
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("server\.env") do set "%%A=%%B"

if not defined JWT_SECRET (
  echo ERROR: JWT_SECRET is missing from server\.env
  pause
  exit /b 1
)

echo.
echo  ZollTool sync server
echo  --------------------
echo  Local:      http://localhost:8787
echo  Admin seed: %OWNER_EMAIL%
echo.
echo  From a phone on the same Wi-Fi use this PC's IPv4 address, port 8787:
ipconfig | findstr /c:"IPv4"
echo.
echo  Press Ctrl+C to stop.
echo.

npm run dev:server
pause
