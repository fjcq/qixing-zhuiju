const { app, BrowserWindow } = require('electron');
const os = require('os');
const { exec } = require('child_process');
const iconv = require('iconv-lite');

// 清理残余进程
function cleanupOrphanedProcesses() {
    try {
        const platform = os.platform();

        if (platform === 'win32') {
            // Windows平台清理
            cleanupWindowsProcesses();
        } else if (platform === 'darwin') {
            // macOS平台清理
            cleanupMacProcesses();
        } else {
            // Linux平台清理
            cleanupLinuxProcesses();
        }
    } catch (error) {
        console.warn('[MAIN] 清理残余进程时出错:', error.message);
    }
}

// Windows平台进程清理
function cleanupWindowsProcesses() {
    console.log('[MAIN] 清理Windows残余进程...');

    // 获取当前进程信息
    const currentPID = process.pid;
    const currentProcessName = require('path').basename(process.execPath, '.exe');

    console.log(`[MAIN] 当前进程: ${currentProcessName} (PID: ${currentPID})`);

    // 延迟执行清理，避免在应用启动初期干扰渲染进程
    setTimeout(() => {
        // 查找并清理可能的残余Electron进程
        const commands = [
            // 查找七星追剧相关进程
            'tasklist /FI "IMAGENAME eq 七星追剧.exe" /FO CSV /NH',
            'tasklist /FI "IMAGENAME eq qixing-zhuiju.exe" /FO CSV /NH',
        ];

        commands.forEach(cmd => {
            exec(cmd, { timeout: 5000, encoding: 'buffer' }, (error, stdout, stderr) => {
                const stdoutStr = iconv.decode(stdout, 'gbk');
                if (!error && stdoutStr && stdoutStr.trim()) {
                    console.log(`[MAIN] 进程查询结果: ${stdoutStr.trim()}`);

                    // 解析CSV输出
                    const lines = stdoutStr.split('\n');
                    lines.forEach(line => {
                        if (line.trim() && !line.includes('信息:') && !line.includes('INFO:')) {
                            // CSV格式: "进程名","PID","会话名","会话号","内存使用"
                            const match = line.match(/"([^"]+)","(\d+)"/);
                            if (match) {
                                const processName = match[1];
                                const pid = parseInt(match[2]);

                                // 不要杀死当前进程和它的子进程
                                if (pid !== currentPID) {
                                    // 检查这个进程是否是当前应用的子进程
                                    exec(`wmic process where processid=${pid} get parentprocessid /value`, { timeout: 2000 }, (ppidError, ppidStdout) => {
                                        if (!ppidError && ppidStdout) {
                                            const ppidMatch = ppidStdout.match(/ParentProcessId=(\d+)/);
                                            const parentPid = ppidMatch ? parseInt(ppidMatch[1]) : null;

                                            // 如果父进程不是当前进程，才清理
                                            if (parentPid !== currentPID) {
                                                console.log(`[MAIN] 发现可清理的残余进程: ${processName} (PID: ${pid}, PPID: ${parentPid})`);

                                                // 尝试优雅地结束进程
                                                exec(`taskkill /PID ${pid} /T`, { timeout: 3000 }, (killError, killStdout) => {
                                                    if (!killError) {
                                                        console.log(`[MAIN] 成功清理残余进程 PID: ${pid}`);
                                                    } else {
                                                        console.log(`[MAIN] 跳过进程清理 PID: ${pid} (可能是当前应用的子进程)`);
                                                    }
                                                });
                                            } else {
                                                console.log(`[MAIN] 跳过子进程 PID: ${pid} (父进程: ${parentPid})`);
                                            }
                                        } else {
                                            console.log(`[MAIN] 无法确定进程 ${pid} 的父进程，跳过清理`);
                                        }
                                    });
                                }
                            }
                        }
                    });
                }
            });
        });
    }, 5000); // 延迟5秒执行清理，确保应用完全启动
}

// macOS平台进程清理
function cleanupMacProcesses() {
    console.log('[MAIN] 清理macOS残余进程...');

    exec('ps aux | grep "七星追剧\\|qixing-zhuiju\\|Electron" | grep -v grep', { timeout: 5000 }, (error, stdout, stderr) => {
        if (!error && stdout) {
            const lines = stdout.split('\n');
            lines.forEach(line => {
                if (line.trim()) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[1];

                    // 不要杀死当前进程
                    if (pid && parseInt(pid) !== process.pid) {
                        exec(`kill -9 ${pid}`, (killError) => {
                            if (!killError) {
                                console.log(`[MAIN] 清理了残余进程 PID: ${pid}`);
                            }
                        });
                    }
                }
            });
        }
    });
}

// Linux平台进程清理
function cleanupLinuxProcesses() {
    console.log('[MAIN] 清理Linux残余进程...');

    exec('ps aux | grep "七星追剧\\|qixing-zhuiju\\|electron" | grep -v grep', { timeout: 5000 }, (error, stdout, stderr) => {
        if (!error && stdout) {
            const lines = stdout.split('\n');
            lines.forEach(line => {
                if (line.trim()) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[1];

                    // 不要杀死当前进程
                    if (pid && parseInt(pid) !== process.pid) {
                        exec(`kill -9 ${pid}`, (killError) => {
                            if (!killError) {
                                console.log(`[MAIN] 清理了残余进程 PID: ${pid}`);
                            }
                        });
                    }
                }
            });
        }
    });
}

// 单实例检查和残余进程清理
function setupSingleInstance() {
    // 打印系统和应用信息
    console.log('='.repeat(60));
    console.log('[MAIN] 七星追剧应用启动');
    console.log(`[MAIN] 版本: ${app.getVersion()}`);
    console.log(`[MAIN] Electron版本: ${process.versions.electron}`);
    console.log(`[MAIN] Node.js版本: ${process.versions.node}`);
    console.log(`[MAIN] 平台: ${os.platform()} ${os.arch()}`);
    console.log(`[MAIN] 系统版本: ${os.release()}`);
    console.log(`[MAIN] 进程PID: ${process.pid}`);
    console.log(`[MAIN] 工作目录: ${process.cwd()}`);
    console.log(`[MAIN] 可执行文件: ${process.execPath}`);
    console.log('='.repeat(60));

    console.log('[MAIN] 检查单实例和残余进程...');

    // 尝试获取单实例锁
    const gotTheLock = app.requestSingleInstanceLock();

    if (!gotTheLock) {
        console.log('[MAIN] 检测到应用已运行，正在激活现有窗口...');
        // 应用已经运行，退出当前实例
        app.quit();
        return false;
    } else {
        console.log('[MAIN] 获得单实例锁，正在清理残余进程...');

        // 清理可能的残余进程
        cleanupOrphanedProcesses();

        return true;
    }
}

// 处理第二个实例启动事件
function handleSecondInstance(qixingApp) {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        console.log('[MAIN] 检测到第二个实例启动，激活主窗口');
        console.log('[MAIN] 命令行参数:', commandLine);

        if (qixingApp && qixingApp.mainWindow) {
            try {
                // 如果窗口被最小化，恢复它
                if (qixingApp.mainWindow.isMinimized()) {
                    console.log('[MAIN] 恢复最小化的窗口');
                    qixingApp.mainWindow.restore();
                }

                // 如果窗口不可见，显示它
                if (!qixingApp.mainWindow.isVisible()) {
                    console.log('[MAIN] 显示隐藏的窗口');
                    qixingApp.mainWindow.show();
                }

                // 将窗口置顶并聚焦
                qixingApp.mainWindow.setAlwaysOnTop(true);
                qixingApp.mainWindow.focus();
                qixingApp.mainWindow.setAlwaysOnTop(false);

                // 确保窗口在任务栏中显示
                qixingApp.mainWindow.setSkipTaskbar(false);

                console.log('[MAIN] 主窗口已激活');
            } catch (error) {
                console.error('[MAIN] 激活主窗口时出错:', error);
            }
        } else {
            console.warn('[MAIN] 主窗口不存在，无法激活');
        }
    });
}

module.exports = {
    setupSingleInstance,
    handleSecondInstance
};
