@echo off
echo 正在重新构建七星追剧...
echo.

echo [1/3] 清理旧的构建文件...
if exist "dist" (
    rmdir /s /q "dist"
    echo 已清理 dist 目录
)

echo.
echo [2/3] 开始构建...
call npm run build

echo.
echo [3/3] 构建完成！
echo 可执行文件位置: dist\win-unpacked\七星追剧.exe
echo.

echo 按任意键启动构建后的应用进行测试...
pause > nul

echo 启动应用...
start "" "dist\win-unpacked\七星追剧.exe"

echo.
echo 如需查看控制台输出，请在命令行中运行：
echo "dist\win-unpacked\七星追剧.exe"
echo.
pause
