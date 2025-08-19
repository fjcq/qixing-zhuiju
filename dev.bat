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

REM 检查依赖是否已安装
if not exist "node_modules" (
    echo ❌ 依赖未安装，正在安装...
    %PKG_MANAGER% install
    if %ERRORLEVEL% NEQ 0 (
        echo ❌ 依赖安装失败，请检查网络或权限
        pause
        exit /b 1
    )
    echo ✅ 依赖安装完成
    echo.
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

echo 启动开发服务器...
echo 按 Ctrl+C 可退出
echo.

%PKG_MANAGER% start
