@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动《这不是吸烟区》原型...
start "" http://localhost:8080
node start.mjs 8080