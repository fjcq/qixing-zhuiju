@echo off
chcp 65001 >nul

echo 快速编译中...
set CSC_IDENTITY_AUTO_DISCOVERY=false
if exist "dist" rmdir /s /q "dist" 2>nul
npx electron-builder --win --publish=never --config.win.certificateFile=null --config.win.certificateSha1=null

if %ERRORLEVEL% EQU 0 (
    echo ✅ 编译完成！输出: dist\win-unpacked\
) else (
    echo ❌ 编译失败！
)
pause
