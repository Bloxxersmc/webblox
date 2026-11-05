@echo off
cd /d "%~dp0"
git add -A
git diff --cached --quiet
if not %errorlevel%==0 git commit -m "Update %date% %time%"
git pull --rebase origin main
if not %errorlevel%==0 (
  echo.
  echo Pull failed or has conflicts. Fix those first, then run this again.
  pause
  exit /b
)
git push origin main
pause
