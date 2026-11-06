@echo off
setlocal
cd /d "%~dp0"
title Nodemail - Viluxzone

where node >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay Node.js. Hay cai Node.js 20 tro len roi chay lai file nay.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

for /f "delims=" %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 20 (
  echo Nodemail can Node.js 20 tro len. Phien ban hien tai: %NODE_MAJOR%.
  pause
  exit /b 1
)

if not exist "node_modules\express\package.json" (
  echo Dang cai cac thu vien can thiet lan dau...
  call npm install
  if errorlevel 1 (
    echo Cai dat thu vien that bai. Kiem tra ket noi mang roi thu lai.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Da tao file .env. Dien thong tin SMTP, luu file va dong Notepad de tiep tuc.
  start "" notepad.exe "%~dp0.env"
  pause
)

node -e "require('dotenv').config();const keys=['SMTP_HOST','SMTP_USER','SMTP_PASS'];const ok=keys.every(k=>process.env[k]&& !/your-domain|replace-with/i.test(process.env[k]));process.exit(ok?0:1)"
if errorlevel 1 (
  echo SMTP chua duoc cau hinh day du trong file .env. Hay dien SMTP_HOST, SMTP_USER va SMTP_PASS.
  start "" notepad.exe "%~dp0.env"
  pause
  node -e "require('dotenv').config();const keys=['SMTP_HOST','SMTP_USER','SMTP_PASS'];const ok=keys.every(k=>process.env[k]&& !/your-domain|replace-with/i.test(process.env[k]));process.exit(ok?0:1)"
  if errorlevel 1 exit /b 1
)

set HOST=127.0.0.1
set PORT=3030
echo Nodemail se mo tai http://127.0.0.1:3030
echo Dong cua so nay de dung ung dung.
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:3030"
call npm start
pause
