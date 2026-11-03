@echo off
setlocal
cd /d "%~dp0..\workbench" || exit /b 1
call npm.cmd run build || exit /b 1
node server/share-server.mjs
