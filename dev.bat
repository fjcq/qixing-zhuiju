@echo off
chcp 65001 >nul 2>&1
title 七星追剧 - 开发启动器

REM 智能检测包管理器
set PKG_MANAGER=npm
if exist "pnpm-lock.yaml" (
    set PKG_MANAGER=pnpm
) else if exist "package-lock.json" (
    set PKG_MANAGER=npm
) else if exist "yarn.lock" (
    set PKG_MANAGER=yarn
)

echo.
echo ========================================
echo         七星追剧开发启动器
echo ========================================
echo.
echo 当前包管理器: %PKG_MANAGER%
echo.

REM 检查Node.js版本
node -v >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ 未检测到Node.js，请先安装Node.js
    pause
    exit /b 1
)

REM 检查依赖是否已安装
if not exist "node_modules" (
    echo ❌ 依赖未安装，正在安装...
    %PKG_MANAGER% install
    if %ERRORLEVEL% NEQ 0 (
        echo ❌ 依赖安装失败，请检查网络或权限
        echo ℹ️  尝试使用npm替代当前包管理器...
        npm install
        if %ERRORLEVEL% NEQ 0 (
            echo ❌ npm安装也失败，请手动解决依赖问题
            pause
            exit /b 1
        )
        set PKG_MANAGER=npm
    )
    echo ✅ 依赖安装完成
    echo.
)

REM 检测Electron安装状态并提供修复选项
if exist "node_modules\electron" (
    echo 检查Electron安装状态...
    node -e "require('electron')" >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo ⚠️  Electron安装可能不完整，尝试修复...
        echo 正在删除损坏的Electron目录...
        rmdir /s /q "node_modules\electron" >nul 2>&1
        echo 重新安装Electron...
        npm install electron --save-dev
        if %ERRORLEVEL% NEQ 0 (
            echo ⚠️  Electron修复失败，应用可能无法正常启动
            echo ℹ️  建议稍后运行: Remove-Item -Recurse -Force node_modules; npm install
        )
    )
)

REM 检测运行环境
if defined VSCODE_PID (
    echo 检测到VS Code环境，使用UTF-8编码模式
    set VSCODE_DEBUG=true
    set ELECTRON_ENABLE_LOGGING=1
) else (
    echo 检测到独立终端环境
)

echo 设置开发环境...
set NODE_OPTIONS=--max-old-space-size=4096

REM 添加Electron日志环境变量
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_NO_ATTACH_CONSOLE=1

echo 启动开发服务器...
echo 按 Ctrl+C 可退出
echo.

REM 启动应用并处理错误
%PKG_MANAGER% start
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ 应用启动失败！错误代码: %ERRORLEVEL%
    echo.
    echo ℹ️  故障排除建议:
    echo 1. 清理并重新安装依赖: npm install
    echo 2. 检查Electron安装: npm install electron@27.3.11
    echo 3. 确保Node.js版本兼容
    echo.
    pause
    exit /b %ERRORLEVEL%
)
