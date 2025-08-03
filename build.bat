@echo off
chcp 65001 >nul
title 七星追剧 - 编译工具

echo.
echo ========================================
echo           七星追剧编译工具
echo ========================================
echo.

echo [1/4] 检查环境...
if not exist "node_modules" (
    echo ❌ 未找到 node_modules，请先运行 npm install
    pause
    exit /b 1
)

echo [2/4] 清理旧的构建文件...
if exist "dist" (
    rmdir /s /q "dist" 2>nul
    echo ✅ 已清理 dist 目录
) else (
    echo ✅ dist 目录不存在，跳过清理
)

echo [3/4] 设置构建环境...
set CSC_IDENTITY_AUTO_DISCOVERY=false
set CSC_LINK=
set CSC_KEY_PASSWORD=
set WIN_CSC_LINK=
set WIN_CSC_KEY_PASSWORD=
echo ✅ 环境变量已设置（跳过代码签名）

echo [4/4] 开始编译...
echo.
npx electron-packager . 七星追剧 --platform=win32 --arch=x64 --out=dist --overwrite --icon=assets/icon.ico

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo ✅ 编译成功完成！
    echo ========================================
    echo.
    echo 输出位置: %CD%\dist\七星追剧-win32-x64\
    echo 主程序: 七星追剧.exe
    echo.
    echo 现在可以打包发布 七星追剧-win32-x64 文件夹
    echo ========================================
) else (
    echo.
    echo ========================================
    echo ❌ 编译失败！错误代码: %ERRORLEVEL%
    echo ========================================
    echo.
    echo 请检查错误信息并重试
    echo ========================================
)

echo.
pause
