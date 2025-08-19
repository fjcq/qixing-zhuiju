@echo off
chcp 65001 >nul 2>&1
title 七星追剧 - 智能编译器

REM 智能检测包管理器
set PKG_MANAGER=npm
if exist "pnpm-lock.yaml" (
    set PKG_MANAGER=pnpm
) else if exist "package-lock.json" (
    set PKG_MANAGER=npm
) else if exist "yarn.lock" (
    set PKG_MANAGER=yarn
)

REM 检查是否有参数指定编译模式
if "%1"=="1" goto quick_build
if "%1"=="2" goto full_build
if "%1"=="3" goto portable_build
if "%1"=="4" goto env_test
if "%1"=="quick" goto quick_build
if "%1"=="full" goto full_build
if "%1"=="portable" goto portable_build
if "%1"=="test" goto env_test

:menu
cls
echo.
echo ========================================
echo           七星追剧智能编译器
echo ========================================
echo.
echo 当前包管理器: %PKG_MANAGER%
echo.
echo 请选择编译模式：
echo.
echo [1] 快速编译 - 推荐
echo [2] 完整编译 - 包含环境检测
echo [3] 便携版Node.js编译
echo [4] 环境兼容性测试
echo [5] 退出
echo.
set /p CHOICE="请输入选择 (1-5): "

if "%CHOICE%"=="1" goto quick_build
if "%CHOICE%"=="2" goto full_build
if "%CHOICE%"=="3" goto portable_build
if "%CHOICE%"=="4" goto env_test
if "%CHOICE%"=="5" goto exit
echo.
echo 无效选择，使用快速编译模式
goto quick_build

:quick_build
echo.
echo ========================================
echo              快速编译模式
echo ========================================
echo.
echo [1/2] 清理旧文件...
if exist "dist" (
    rmdir /s /q "dist" 2>nul
    echo ✅ 已清理 dist 目录
)

echo [2/2] 开始编译...
%PKG_MANAGER% run pack

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo ✅ 快速编译成功完成！
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
    echo ❌ 快速编译失败！
    echo ========================================
    echo.
    echo 建议尝试完整编译模式获取详细错误信息
    echo ========================================
)
goto cleanup

:full_build
echo.
echo ========================================
echo              完整编译模式
echo ========================================
echo.

echo [1/6] 检查Node.js环境...
node --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ❌ 未找到Node.js，请检查安装
    echo 按任意键退出...
    if not "%1"=="auto" pause
    exit /b 1
) else (
    echo ✅ Node.js可用
)

%PKG_MANAGER% --version 2>nul | findstr /r "." >nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ 未找到%PKG_MANAGER%，请检查安装
    echo 按任意键退出...
    if not "%1"=="auto" pause
    exit /b 1
) else (
    echo ✅ %PKG_MANAGER%可用
)

echo [2/6] 检查项目依赖...
if not exist "node_modules" (
    echo ❌ 未找到 node_modules，请先运行 %PKG_MANAGER% install
    echo 按任意键退出...
    if not "%1"=="auto" pause
    exit /b 1
) else (
    echo ✅ node_modules 目录存在
)

if not exist "node_modules\.bin\electron-packager.cmd" (
    if not exist "node_modules\.bin\electron-packager" (
        echo ❌ 未找到 electron-packager，正在安装...
        if "%PKG_MANAGER%"=="pnpm" (
            %PKG_MANAGER% add electron-packager -D
        ) else (
            %PKG_MANAGER% install electron-packager --save-dev
        )
        if %ERRORLEVEL% NEQ 0 (
            echo ❌ electron-packager 安装失败
            echo 按任意键退出...
            if not "%1"=="auto" pause
            exit /b 1
        )
        echo ✅ electron-packager 安装完成
    )
) else (
    echo ✅ electron-packager 已安装
)

echo [3/6] 清理旧的构建文件...
if exist "dist" (
    rmdir /s /q "dist" 2>nul
    echo ✅ 已清理 dist 目录
)

echo [4/6] 设置构建环境...
set CSC_IDENTITY_AUTO_DISCOVERY=false
set CSC_LINK=
set CSC_KEY_PASSWORD=
echo ✅ 环境变量已设置（跳过代码签名）

echo [5/6] 开始编译...
echo 尝试方式1: npx electron-packager...
npx electron-packager . 七星追剧 --platform=win32 --arch=x64 --out=dist --overwrite --icon=assets/icon.ico 2>build_error.log

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo ✅ 完整编译成功完成！
    echo ========================================
    echo.
    echo 输出位置: %CD%\dist\七星追剧-win32-x64\
    echo 主程序: 七星追剧.exe
    echo.
    echo 现在可以打包发布 七星追剧-win32-x64 文件夹
    echo ========================================
    goto cleanup
) else (
    echo ❌ npx 方式失败，尝试其他方式...
)

echo 尝试方式2: %PKG_MANAGER% run pack...
%PKG_MANAGER% run pack 2>>build_error.log

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo ✅ 完整编译成功完成！
    echo ========================================
    echo.
    echo 输出位置: %CD%\dist\七星追剧-win32-x64\
    echo 主程序: 七星追剧.exe
    echo.
    echo 现在可以打包发布 七星追剧-win32-x64 文件夹
    echo ========================================
    goto cleanup
) else (
    echo.
    echo ========================================
    echo ❌ 完整编译失败！
    echo ========================================
    echo.
    if exist "build_error.log" (
        echo 错误信息：
        type build_error.log
        echo.
    )
    echo 建议：
    echo 1. 检查Node.js和npm版本兼容性
    echo 2. 删除node_modules后重新%PKG_MANAGER% install
    echo 3. 尝试便携版编译模式
    echo 4. 以管理员身份运行
    echo ========================================
    goto cleanup
)

:portable_build
echo.
echo ========================================
echo            便携版Node.js编译
echo ========================================
echo.

set /p NODEJS_PATH="请输入便携版Node.js目录路径（留空使用系统PATH）: "

if not "%NODEJS_PATH%"=="" (
    echo 设置便携版Node.js路径: %NODEJS_PATH%
    set "PATH=%NODEJS_PATH%;%NODEJS_PATH%\node_modules\.bin;%PATH%"
    set "NODE_PATH=%NODEJS_PATH%\node_modules"
)

echo [1/5] 检查便携版Node.js环境...
if not "%NODEJS_PATH%"=="" (
    "%NODEJS_PATH%\node.exe" --version >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo ❌ 便携版Node.js不可用，尝试系统Node.js
        node --version >nul 2>&1
        if %ERRORLEVEL% NEQ 0 (
            echo ❌ 未找到可用的Node.js
            echo 按任意键退出...
            if not "%1"=="auto" pause
            exit /b 1
        )
    ) else (
        for /f "tokens=*" %%i in ('"%NODEJS_PATH%\node.exe" --version') do set NODE_VERSION=%%i
        echo ✅ 便携版Node.js版本: %NODE_VERSION%
    )
) else (
    node --version >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo ❌ 未找到Node.js
        echo 按任意键退出...
        if not "%1"=="auto" pause
        exit /b 1
    ) else (
        for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
        echo ✅ Node.js版本: %NODE_VERSION%
    )
)

echo [2/5] 设置便携版环境...
set "NPM_CONFIG_CACHE=%CD%\npm-cache"
set "NPM_CONFIG_PREFIX=%CD%\npm-prefix"
set "ELECTRON_CACHE=%CD%\electron-cache"
set CSC_IDENTITY_AUTO_DISCOVERY=false
echo ✅ 便携版环境变量已设置

echo [3/5] 创建临时目录...
if not exist "npm-cache" mkdir "npm-cache"
if not exist "npm-prefix" mkdir "npm-prefix"
if not exist "electron-cache" mkdir "electron-cache"
echo ✅ 临时目录已创建

echo [4/5] 检查依赖...
if not exist "node_modules" (
    echo 正在安装依赖...
    %PKG_MANAGER% install
    if %ERRORLEVEL% NEQ 0 (
        echo ❌ 依赖安装失败
        echo 按任意键退出...
        if not "%1"=="auto" pause
        exit /b 1
    )
)

echo [5/5] 便携版编译...
if exist "node_modules\electron-packager\bin\electron-packager.js" (
    node "node_modules\electron-packager\bin\electron-packager.js" . 七星追剧 --platform=win32 --arch=x64 --out=dist --overwrite --icon=assets/icon.ico
) else (
    %PKG_MANAGER% run pack
)

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo ✅ 便携版编译成功完成！
    echo ========================================
    echo.
    echo 输出位置: %CD%\dist\七星追剧-win32-x64\
    echo 主程序: 七星追剧.exe
    echo.
    echo 编译环境: 便携版Node.js兼容模式
    echo ========================================
) else (
    echo.
    echo ========================================
    echo ❌ 便携版编译失败！
    echo ========================================
    echo.
    echo 可能的解决方案：
    echo 1. 检查便携版Node.js路径是否正确
    echo 2. 确认有足够的磁盘空间
    echo 3. 检查防火墙/杀毒软件是否阻止
    echo 4. 尝试以管理员身份运行
    echo ========================================
)
goto cleanup

:env_test
echo.
echo ========================================
echo            环境兼容性测试
echo ========================================
echo.

echo [测试1] Node.js环境...
for /f "tokens=*" %%i in ('node --version 2^>nul') do set NODE_VERSION=%%i
if "%NODE_VERSION%"=="" (
    echo ❌ Node.js不可用
    set TEST1=FAIL
) else (
    echo ✅ Node.js版本: %NODE_VERSION%
    set TEST1=PASS
)

echo [测试2] %PKG_MANAGER%环境...
for /f "tokens=*" %%i in ('%PKG_MANAGER% --version 2^>nul') do set MANAGER_VERSION=%%i
if "%MANAGER_VERSION%"=="" (
    echo ❌ %PKG_MANAGER%不可用
    set TEST2=FAIL
) else (
    echo ✅ %PKG_MANAGER%版本: %MANAGER_VERSION%
    set TEST2=PASS
)

echo [测试3] 项目依赖...
if not exist "node_modules" (
    echo ❌ node_modules不存在
    set TEST3=FAIL
) else (
    echo ✅ node_modules存在
    set TEST3=PASS
)

echo [测试4] electron-packager...
if exist "node_modules\.bin\electron-packager.cmd" (
    echo ✅ electron-packager已安装
    set TEST4=PASS
) else if exist "node_modules\.bin\electron-packager" (
    echo ✅ electron-packager已安装
    set TEST4=PASS
) else (
    echo ❌ electron-packager未安装
    set TEST4=FAIL
)

echo [测试5] npx可用性...
npx --version 2>nul | findstr /r "." >nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ npx不可用
    set TEST5=FAIL
) else (
    echo ✅ npx可用
    set TEST5=PASS
)

echo.
echo === 测试结果汇总 ===
echo 1. Node.js环境: %TEST1%
echo 2. %PKG_MANAGER%环境: %TEST2%
echo 3. 项目依赖: %TEST3%
echo 4. electron-packager: %TEST4%
echo 5. npx可用性: %TEST5%
echo.

set FAIL_COUNT=0
if "%TEST1%"=="FAIL" set /a FAIL_COUNT+=1
if "%TEST2%"=="FAIL" set /a FAIL_COUNT+=1
if "%TEST3%"=="FAIL" set /a FAIL_COUNT+=1
if "%TEST4%"=="FAIL" set /a FAIL_COUNT+=1
if "%TEST5%"=="FAIL" set /a FAIL_COUNT+=1

if %FAIL_COUNT% EQU 0 (
    echo ✅ 环境完全兼容，建议使用快速编译
) else (
    echo ❌ 发现 %FAIL_COUNT% 个问题
    if "%TEST5%"=="FAIL" echo 建议使用便携版编译模式
)

echo.
if not "%1"=="auto" pause
goto cleanup

:cleanup
REM 可选清理临时文件
echo.
set /p CONTINUE="是否返回主菜单? (y/N): "
if /i "%CONTINUE%"=="y" (
    goto menu
)
goto exit

:exit
echo.
echo 感谢使用七星追剧智能编译器！
if not "%1"=="auto" pause
exit /b 0
