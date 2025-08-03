@echo off
chcp 65001 >nul

echo 快速编译中...
if exist "dist\七星追剧-win32-x64" rmdir /s /q "dist\七星追剧-win32-x64" 2>nul
npx electron-packager . 七星追剧 --platform=win32 --arch=x64 --out=dist --overwrite --icon=assets/icon.ico

if %ERRORLEVEL% EQU 0 (
    echo ✅ 编译完成！输出: dist\七星追剧-win32-x64\
) else (
    echo ❌ 编译失败！
)
pause
