const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const os = require('os');

// 设置进程编码，确保中文正确显示
if (process.platform === 'win32') {
    // 检测终端编码环境
    try {
        if (process.env.VSCODE_PID) {
            // 在VS Code环境中
            console.log('[MAIN] 检测到VS Code环境，使用UTF-8编码');
        } else {
            // 在独立终端中
            console.log('[MAIN] 检测到独立终端环境');
        }
    } catch (err) {
        console.error('[MAIN] 编码设置失败:', err.message);
    }
}

// 导入DLNA客户端
const DLNAClient = require('./src/dlna/dlna-client');

// 创建日志文件记录错误
function logToFile(message) {
    try {
        const logPath = path.join(os.tmpdir(), 'qixing-zhuiju.log');
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(logPath, logMessage, 'utf8');
    } catch (err) {
        // 如果无法写入日志文件，静默忽略
    }
}

// 重写console.log和console.error以便在生产环境中也能记录
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function (...args) {
    const message = args.join(' ');
    originalConsoleLog(...args);
    logToFile(`LOG: ${message}`);
};

console.error = function (...args) {
    const message = args.join(' ');
    originalConsoleError(...args);
    logToFile(`ERROR: ${message}`);
};

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

        // 当试图运行第二个实例时，激活现有窗口
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

        return true;
    }
}

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
    const currentProcessName = path.basename(process.execPath, '.exe');

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
            exec(cmd, { timeout: 5000 }, (error, stdout, stderr) => {
                if (!error && stdout && stdout.trim()) {
                    console.log(`[MAIN] 进程查询结果: ${stdout.trim()}`);

                    // 解析CSV输出
                    const lines = stdout.split('\n');
                    lines.forEach(line => {
                        if (line.trim() && !line.includes('INFO:')) {
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

class QixingZhuiju {
    constructor() {
        this.mainWindow = null;
        this.playerWindow = null;
        this.castWindow = null; // 投屏窗口
        this.dlnaClient = new DLNAClient(); // DLNA客户端
        this.discoveredDevices = []; // 发现的设备列表
        this.currentVideoUrl = null; // 当前播放的视频URL（用于投屏）
        this.isDev = process.argv.includes('--dev');
    }

    async createMainWindow() {
        console.log('[MAIN] 创建主窗口...');

        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            minWidth: 800,
            minHeight: 600,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: false,
                allowRunningInsecureContent: true,
                experimentalFeatures: false,
                enableRemoteModule: false,
                backgroundThrottling: false,
                preload: path.join(__dirname, 'src', 'preload.js')
            },
            icon: path.join(__dirname, 'assets', 'icon.png'),
            frame: false,  // 取消标题栏
            transparent: true,  // 启用透明窗口
            backgroundColor: '#00000000',  // 完全透明的背景
            vibrancy: 'dark',  // macOS亚克力效果（仅macOS）
            backgroundMaterial: 'acrylic',  // Windows亚克力效果（仅Windows 10+）
            autoHideMenuBar: true,  // 隐藏菜单栏
            show: false,
            title: '七星追剧'
        });

        // 隐藏菜单栏
        this.mainWindow.setMenuBarVisibility(false);

        // 加载主页面
        try {
            const htmlPath = path.join(__dirname, 'src', 'renderer', 'index.html');
            console.log(`[MAIN] 尝试加载主页面: ${htmlPath}`);
            console.log(`[MAIN] 当前工作目录: ${process.cwd()}`);
            console.log(`[MAIN] __dirname: ${__dirname}`);

            // 检查文件是否存在
            const fs = require('fs');
            if (fs.existsSync(htmlPath)) {
                console.log('[MAIN] 主页面文件存在');
            } else {
                console.error('[MAIN] 主页面文件不存在:', htmlPath);
                throw new Error(`主页面文件不存在: ${htmlPath}`);
            }

            await this.mainWindow.loadFile(htmlPath);
            console.log('[MAIN] 主页面加载成功');
        } catch (error) {
            console.error('[MAIN] 主页面加载失败:', error);
            throw error;
        }

        // 显示窗口
        this.mainWindow.once('ready-to-show', () => {
            console.log('[MAIN] 主窗口准备显示');
            this.mainWindow.show();
            console.log('[MAIN] 主窗口已显示');

            if (this.isDev) {
                this.mainWindow.webContents.openDevTools();
            }
        });

        // 强制显示窗口（作为备选方案）
        setTimeout(() => {
            if (this.mainWindow && !this.mainWindow.isVisible()) {
                console.log('[MAIN] 备选方案：强制显示主窗口');
                this.mainWindow.show();
            }
        }, 2000);

        // 窗口关闭事件
        this.mainWindow.on('closed', () => {
            console.log('[MAIN] 主窗口已关闭');
            this.mainWindow = null;
            if (this.playerWindow) {
                this.playerWindow.close();
            }
        });

        // 渲染进程崩溃监听
        this.mainWindow.webContents.on('crashed', () => {
            console.error('[MAIN] 渲染进程崩溃!');

            // 尝试重新加载页面
            setTimeout(() => {
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    console.log('[MAIN] 尝试重新加载页面...');
                    try {
                        this.mainWindow.webContents.reload();
                    } catch (error) {
                        console.error('[MAIN] 重新加载失败:', error);
                    }
                }
            }, 1000);
        });

        this.mainWindow.webContents.on('unresponsive', () => {
            console.error('[MAIN] 渲染进程无响应!');
        });

        this.mainWindow.webContents.on('responsive', () => {
            console.log('[MAIN] 渲染进程恢复响应');
        });

        // 监听渲染进程的控制台消息
        this.mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
            console.log(`[RENDERER-${level}] ${message} (${sourceId}:${line})`);
        });

        // 窗口最小化事件
        this.mainWindow.on('minimize', () => {
            console.log('[MAIN] 主窗口已最小化');
        });

        // 窗口恢复事件
        this.mainWindow.on('restore', () => {
            console.log('[MAIN] 主窗口已恢复');
        });

        // 窗口聚焦事件
        this.mainWindow.on('focus', () => {
            console.log('[MAIN] 主窗口获得焦点');
        });

        // 防止窗口意外关闭（可选）
        this.mainWindow.on('close', (event) => {
            console.log('[MAIN] 主窗口收到关闭事件');
            if (this.isDev) {
                // 开发模式直接关闭
                console.log('[MAIN] 开发模式，允许关闭');
                return;
            }

            // 生产模式可以添加确认对话框或最小化到托盘
            console.log('[MAIN] 生产模式，主窗口即将关闭');
        });

        // 监听页面加载完成事件
        this.mainWindow.webContents.on('did-finish-load', () => {
            console.log('[MAIN] 页面DOM加载完成');
        });

        // 监听页面加载失败事件
        this.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
            console.error('[MAIN] 页面加载失败:', errorCode, errorDescription, validatedURL);
        });

        // 监听渲染进程崩溃
        this.mainWindow.webContents.on('render-process-gone', (event, details) => {
            console.error('[MAIN] 渲染进程崩溃:', details);
            console.error('[MAIN] 崩溃原因:', details.reason);
            console.error('[MAIN] 退出代码:', details.exitCode);

            // 尝试重新加载页面
            setTimeout(() => {
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    console.log('[MAIN] 尝试重新加载页面...');
                    try {
                        this.mainWindow.webContents.reload();
                    } catch (error) {
                        console.error('[MAIN] 重新加载失败:', error);
                    }
                }
            }, 1000);
        });

        // 设置菜单
        this.createMenu();
    }

    createPlayerWindow(videoData) {
        console.log('[MAIN] 创建播放器窗口:', videoData?.title || '未知视频');

        if (this.playerWindow) {
            console.log('[MAIN] 播放器窗口已存在，聚焦现有窗口');
            this.playerWindow.focus();
            return;
        }

        this.playerWindow = new BrowserWindow({
            width: 1000,
            height: 600,
            minWidth: 600,
            minHeight: 400,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: false,
                allowRunningInsecureContent: true,
                preload: path.join(__dirname, 'src', 'preload.js')
            },
            icon: path.join(__dirname, 'assets', 'icon.png'),
            parent: this.mainWindow,
            show: false,
            frame: false,  // 取消标题栏
            transparent: true,  // 启用透明窗口
            backgroundColor: '#00000000',  // 完全透明的背景
            vibrancy: 'dark',  // macOS亚克力效果（仅macOS）
            backgroundMaterial: 'acrylic',  // Windows亚克力效果（仅Windows 10+）
            autoHideMenuBar: true,  // 自动隐藏菜单栏
            title: videoData?.title || '七星追剧播放器'
        });

        // 完全移除菜单栏
        this.playerWindow.setMenuBarVisibility(false);

        // 加载播放器页面
        const playerHtmlPath = path.join(__dirname, 'src', 'renderer', 'player.html');
        console.log(`[MAIN] 尝试加载播放器页面: ${playerHtmlPath}`);

        this.playerWindow.loadFile(playerHtmlPath)
            .then(() => {
                console.log('[MAIN] 播放器页面加载成功');
            })
            .catch(error => {
                console.error('[MAIN] 播放器页面加载失败:', error);
            });

        this.playerWindow.once('ready-to-show', () => {
            console.log('[MAIN] 播放器窗口准备显示');
            this.playerWindow.show();

            // 发送视频数据到播放器窗口
            if (videoData) {
                console.log('[MAIN] 发送视频数据到播放器窗口:', videoData.title);
                this.playerWindow.webContents.send('video-data', videoData);
            }
        });

        this.playerWindow.on('closed', () => {
            console.log('[MAIN] 播放器窗口已关闭');
            this.playerWindow = null;
        });

        // 播放器窗口错误处理
        this.playerWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
            console.error('[MAIN] 播放器页面加载失败:', errorCode, errorDescription, validatedURL);
        });
    }

    createMenu() {
        console.log('[MAIN] 创建应用菜单...');

        const template = [
            {
                label: '文件',
                submenu: [
                    {
                        label: '退出',
                        accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                        click: () => {
                            console.log('[MAIN] 菜单退出被点击');
                            app.quit();
                        }
                    }
                ]
            },
            {
                label: '查看',
                submenu: [
                    { role: 'reload', label: '重新加载' },
                    { role: 'forceReload', label: '强制重新加载' },
                    { role: 'toggleDevTools', label: '开发者工具' },
                    { type: 'separator' },
                    { role: 'resetZoom', label: '实际大小' },
                    { role: 'zoomIn', label: '放大' },
                    { role: 'zoomOut', label: '缩小' },
                    { type: 'separator' },
                    { role: 'togglefullscreen', label: '全屏' }
                ]
            }
        ];

        try {
            const menu = Menu.buildFromTemplate(template);

            // 在所有平台上设置应用菜单
            Menu.setApplicationMenu(menu);

            console.log('[MAIN] 应用菜单创建完成');
        } catch (error) {
            console.error('[MAIN] 创建菜单失败:', error);
        }
    }

    setupIPC() {
        // 打开播放器窗口
        ipcMain.handle('open-player', async (event, videoData) => {
            try {
                console.log('[MAIN] 收到打开播放器请求:', videoData);

                // 🔥 保存当前播放的视频URL，用于投屏
                this.currentVideoUrl = videoData.url;
                console.log('[MAIN] 保存视频URL用于投屏:', this.currentVideoUrl);

                this.createPlayerWindow(videoData);
                return { success: true, message: '播放器已打开' };
            } catch (error) {
                console.error('[MAIN] 打开播放器失败:', error);
                return { success: false, message: error.message };
            }
        });

        // 关闭播放器窗口
        ipcMain.handle('close-player', () => {
            try {
                if (this.playerWindow) {
                    this.playerWindow.close();
                }
                return { success: true };
            } catch (error) {
                console.error('[MAIN] 关闭播放器失败:', error);
                return { success: false, message: error.message };
            }
        });

        // 获取应用版本
        ipcMain.handle('get-app-version', () => {
            return app.getVersion();
        });

        // 打开外部链接
        ipcMain.handle('open-external-url', async (event, url) => {
            try {
                console.log('[MAIN] 收到打开外部链接请求:', url);

                // 验证URL是否安全
                if (!url || typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
                    console.error('[MAIN] 无效的URL:', url);
                    return { success: false, error: 'Invalid URL' };
                }

                await shell.openExternal(url);
                console.log('[MAIN] 外部链接打开成功:', url);
                return { success: true };
            } catch (error) {
                console.error('[MAIN] 打开外部链接失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 窗口控制处理器
        ipcMain.handle('window-close', (event) => {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (window) {
                window.close();
            }
        });

        ipcMain.handle('window-minimize', (event) => {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (window) {
                window.minimize();
            }
        });

        ipcMain.handle('window-maximize', (event) => {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (window) {
                if (window.isMaximized()) {
                    window.unmaximize();
                } else {
                    window.maximize();
                }
            }
        });

        ipcMain.handle('toggle-always-on-top', (event) => {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (window) {
                const currentState = window.isAlwaysOnTop();
                const newState = !currentState;

                console.log(`[MAIN] ========== 置顶状态切换请求 ==========`);
                console.log(`[MAIN] 当前置顶状态: ${currentState}`);
                console.log(`[MAIN] 请求切换到: ${newState}`);

                // 设置置顶状态，并使用更高的级别确保有效
                try {
                    if (newState) {
                        // 尝试多种置顶级别以确保成功
                        window.setAlwaysOnTop(true, 'screen-saver');
                        console.log(`[MAIN] 设置置顶级别: screen-saver`);
                    } else {
                        window.setAlwaysOnTop(false, 'normal');
                        console.log(`[MAIN] 取消置顶，恢复正常级别`);
                    }

                    // 验证设置是否生效
                    const actualState = window.isAlwaysOnTop();
                    console.log(`[MAIN] 设置后实际状态: ${actualState}`);

                    if (newState && !actualState) {
                        // 如果screen-saver级别失败，尝试其他级别
                        console.log('[MAIN] screen-saver级别失败，尝试floating级别');
                        window.setAlwaysOnTop(true, 'floating');

                        const retryState = window.isAlwaysOnTop();
                        console.log(`[MAIN] floating级别设置后状态: ${retryState}`);

                        if (!retryState) {
                            console.log('[MAIN] floating级别也失败，尝试normal级别');
                            window.setAlwaysOnTop(true, 'normal');

                            const finalState = window.isAlwaysOnTop();
                            console.log(`[MAIN] normal级别设置后状态: ${finalState}`);
                        }
                    }

                    const finalResult = window.isAlwaysOnTop();
                    console.log(`[MAIN] ========== 最终置顶状态: ${finalResult} ==========`);

                    return finalResult;
                } catch (error) {
                    console.error('[MAIN] 设置置顶状态时出错:', error);
                    return currentState; // 返回原始状态
                }
            }
            console.error('[MAIN] 无法找到窗口实例');
            return false;
        });

        // 设备发现处理
        ipcMain.handle('discover-cast-devices', async (event) => {
            console.log('[MAIN] 收到设备发现请求');
            try {
                return await this.discoverCastDevices();
            } catch (error) {
                console.error('[MAIN] 设备发现失败:', error);
                return { success: false, error: error.message, devices: [] };
            }
        });

        // DLNA投屏处理
        ipcMain.handle('cast-to-dlna-device', async (event, deviceId, mediaUrl, metadata) => {
            console.log('[MAIN] 收到DLNA投屏请求:', { deviceId, mediaUrl });

            // 🔥 修复：如果mediaUrl为空，使用保存的视频URL
            if (!mediaUrl && this.currentVideoUrl) {
                mediaUrl = this.currentVideoUrl;
                console.log('[MAIN] 使用保存的视频URL:', mediaUrl);
            }

            try {
                return await this.castToDLNADevice(deviceId, mediaUrl, metadata);
            } catch (error) {
                console.error('[MAIN] DLNA投屏失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 停止DLNA投屏
        ipcMain.handle('stop-dlna-casting', async (event, deviceId) => {
            console.log('[MAIN] 收到停止DLNA投屏请求:', deviceId);
            try {
                return await this.stopDLNACasting(deviceId);
            } catch (error) {
                console.error('[MAIN] 停止DLNA投屏失败:', error);
                return { success: false, error: error.message };
            }
        });

        // 剪切板读取处理
        ipcMain.handle('read-clipboard', async (event) => {
            try {
                const { clipboard } = require('electron');
                return clipboard.readText();
            } catch (error) {
                console.error('[MAIN] 读取剪切板失败:', error);
                return '';
            }
        });

        // 剪切板写入处理
        ipcMain.handle('write-clipboard', async (event, text) => {
            try {
                const { clipboard } = require('electron');
                clipboard.writeText(text);
                return true;
            } catch (error) {
                console.error('[MAIN] 写入剪切板失败:', error);
                return false;
            }
        });

        // 播放器日志输出到cmd控制台
        ipcMain.handle('player-log', async (event, level, message, ...args) => {
            const fullMessage = `[PLAYER-${level.toUpperCase()}] ${message}` + (args.length > 0 ? ' ' + args.join(' ') : '');

            if (level === 'error') {
                console.error(fullMessage);
            } else if (level === 'warn') {
                console.warn(fullMessage);
            } else {
                console.log(fullMessage);
            }

            return true;
        });

        // 播放器集数变化通知
        ipcMain.handle('player-episode-changed', async (event, updateData) => {
            try {
                console.log('[MAIN] 播放器集数变化通知:', updateData);

                // 转发集数更新通知到主窗口
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('episode-changed', updateData);
                    console.log('[MAIN] 已转发集数更新通知到主窗口');
                }

                return { success: true };
            } catch (error) {
                console.error('[MAIN] 处理播放器集数变化通知失败:', error);
                return { success: false, error: error.message };
            }
        });
    }

    // 系统投屏功能 (已移除)
    async startSystemCasting(castInfo) {
        console.log('[MAIN] 系统投屏功能已被移除');
        throw new Error('系统投屏功能已被移除，请使用DLNA投屏');
    }

    // Windows 投屏
    async startWindowsCasting(url, title, currentTime) {
        console.log('[MAIN] 启动 Windows 投屏...');

        try {
            // 方法1: 使用 Windows 的投影到此电脑功能
            // 创建一个简单的投屏接收页面
            const castWindow = new BrowserWindow({
                width: 1920,
                height: 1080,
                fullscreen: true,
                frame: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: false
                },
                show: false
            });

            // 创建投屏页面内容
            const castPageHtml = this.createCastPageContent(url, title, currentTime);
            await castWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(castPageHtml)}`);

            // 显示投屏窗口
            castWindow.show();
            castWindow.setFullScreen(true);

            // 保存投屏窗口引用
            this.castWindow = castWindow;

            // 监听窗口关闭事件
            castWindow.on('closed', () => {
                console.log('[MAIN] 投屏窗口已关闭');
                this.castWindow = null;
            });

            console.log('[MAIN] Windows 投屏窗口已创建');
            return { success: true, method: 'window' };

        } catch (error) {
            console.error('[MAIN] Windows 投屏失败:', error);

            // 备用方案：尝试打开默认浏览器进行投屏
            try {
                await shell.openExternal(url);
                return { success: true, method: 'browser' };
            } catch (browserError) {
                throw new Error(`投屏失败: ${error.message}`);
            }
        }
    }

    // macOS 投屏
    async startMacCasting(url, title, currentTime) {
        console.log('[MAIN] 启动 macOS 投屏...');

        try {
            // macOS 上可以使用 AirPlay
            // 这里我们创建一个全屏窗口作为投屏显示
            const castWindow = new BrowserWindow({
                width: 1920,
                height: 1080,
                fullscreen: true,
                frame: false,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: false
                },
                show: false
            });

            const castPageHtml = this.createCastPageContent(url, title, currentTime);
            await castWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(castPageHtml)}`);

            castWindow.show();
            castWindow.setFullScreen(true);

            this.castWindow = castWindow;

            castWindow.on('closed', () => {
                console.log('[MAIN] macOS 投屏窗口已关闭');
                this.castWindow = null;
            });

            return { success: true, method: 'airplay' };

        } catch (error) {
            console.error('[MAIN] macOS 投屏失败:', error);
            throw error;
        }
    }

    // 通用投屏（Linux等）
    async startGenericCasting(url, title, currentTime) {
        console.log('[MAIN] 启动通用投屏...');

        try {
            // 使用外部浏览器打开
            await shell.openExternal(url);
            return { success: true, method: 'external' };

        } catch (error) {
            console.error('[MAIN] 通用投屏失败:', error);
            throw error;
        }
    }

    // 创建投屏页面内容
    createCastPageContent(videoUrl, title, startTime = 0) {
        return `
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title} - 投屏播放</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    background: #000;
                    color: #fff;
                    font-family: Arial, sans-serif;
                    overflow: hidden;
                }
                
                .cast-container {
                    position: relative;
                    width: 100vw;
                    height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                video {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                }
                
                .cast-info {
                    position: absolute;
                    top: 20px;
                    left: 20px;
                    background: rgba(0, 0, 0, 0.7);
                    padding: 10px 20px;
                    border-radius: 8px;
                    z-index: 100;
                }
                
                .cast-title {
                    font-size: 24px;
                    font-weight: bold;
                    margin-bottom: 5px;
                }
                
                .cast-status {
                    font-size: 16px;
                    color: #0bc;
                }
                
                .loading {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    text-align: center;
                }
                
                .spinner {
                    border: 4px solid #333;
                    border-top: 4px solid #0bc;
                    border-radius: 50%;
                    width: 50px;
                    height: 50px;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 20px;
                }
                
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                
                .error {
                    color: #f44;
                    background: rgba(255, 68, 68, 0.1);
                    padding: 20px;
                    border-radius: 8px;
                    text-align: center;
                }
            </style>
        </head>
        <body>
            <div class="cast-container">
                <div class="cast-info">
                    <div class="cast-title">${title}</div>
                    <div class="cast-status">投屏播放中...</div>
                </div>
                
                <div class="loading" id="loading">
                    <div class="spinner"></div>
                    <div>视频加载中...</div>
                </div>
                
                <video id="cast-video" controls autoplay>
                    <source src="${videoUrl}" type="video/mp4">
                    <p class="error">您的浏览器不支持视频播放。</p>
                </video>
            </div>
            
            <script>
                const video = document.getElementById('cast-video');
                const loading = document.getElementById('loading');
                
                // 设置开始播放时间
                video.currentTime = ${startTime};
                
                video.addEventListener('loadstart', () => {
                    loading.style.display = 'block';
                });
                
                video.addEventListener('canplay', () => {
                    loading.style.display = 'none';
                    video.play();
                });
                
                video.addEventListener('error', (e) => {
                    loading.innerHTML = '<div class="error">视频加载失败，请检查网络连接</div>';
                });
                
                // 全屏播放
                video.addEventListener('click', () => {
                    if (video.requestFullscreen) {
                        video.requestFullscreen();
                    }
                });
                
                // 键盘控制
                document.addEventListener('keydown', (e) => {
                    switch(e.key) {
                        case ' ':
                            e.preventDefault();
                            if (video.paused) {
                                video.play();
                            } else {
                                video.pause();
                            }
                            break;
                        case 'Escape':
                            window.close();
                            break;
                        case 'f':
                        case 'F':
                            if (video.requestFullscreen) {
                                video.requestFullscreen();
                            }
                            break;
                    }
                });
            </script>
        </body>
        </html>
        `;
    }

    // 系统级设备发现
    async discoverCastDevices() {
        console.log('[MAIN] 开始DLNA设备发现...');

        try {
            // 清空之前的设备列表
            this.discoveredDevices = [];

            // 设置DLNA客户端事件监听
            this.dlnaClient.removeAllListeners(); // 清除之前的监听器
            console.log('[MAIN] 已清除旧的事件监听器');

            this.dlnaClient.on('deviceFound', (device) => {
                console.log('[MAIN] 发现DLNA设备:', device.name, 'IP:', device.address);

                // 检查是否已存在相同设备（基于ID去重）
                const existingDeviceIndex = this.discoveredDevices.findIndex(d => d.id === device.id);

                // 转换为统一的设备格式
                const formattedDevice = {
                    id: device.id,
                    name: device.name,
                    type: device.type,
                    icon: device.icon,
                    status: device.status,
                    protocol: device.protocol,
                    address: device.address,
                    manufacturer: device.manufacturer,
                    modelName: device.modelName,
                    supportedServices: device.supportedServices ? Array.from(device.supportedServices) : [],
                    lastSeen: device.lastSeen || device.discoveredAt,
                    originalDevice: device // 保存原始设备对象
                };

                if (existingDeviceIndex >= 0) {
                    // 更新已存在的设备信息
                    this.discoveredDevices[existingDeviceIndex] = formattedDevice;
                    console.log(`[MAIN] 设备信息已更新: ${device.name} (${device.address})`);
                } else {
                    // 添加新设备
                    this.discoveredDevices.push(formattedDevice);
                    console.log(`[MAIN] 设备已添加到列表: ${device.name} (${device.address})`);
                }

                console.log(`[MAIN] 当前设备列表总数: ${this.discoveredDevices.length}`);
            });

            this.dlnaClient.on('discoveryComplete', (devices) => {
                console.log(`[MAIN] DLNA设备发现完成事件触发，传入设备数量: ${devices.length}`);
                console.log(`[MAIN] 当前发现设备列表长度: ${this.discoveredDevices.length}`);
            });

            console.log('[MAIN] 事件监听器已设置，开始设备发现...');

            // 开始设备发现
            const startResult = await this.dlnaClient.startDiscovery(5000); // 5秒超时
            console.log('[MAIN] startDiscovery 返回结果:', startResult);

            // 等待发现过程完成
            console.log('[MAIN] 等待设备发现完成...');
            await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    console.log('[MAIN] 设备发现超时，强制结束');
                    resolve();
                }, 6000); // 6秒超时，给DLNA客户端足够时间

                this.dlnaClient.once('discoveryComplete', () => {
                    console.log('[MAIN] 收到 discoveryComplete 事件，结束等待');
                    clearTimeout(timeout);
                    resolve();
                });

                // 添加额外的检查
                setTimeout(() => {
                    console.log(`[MAIN] 中途检查：当前发现设备数量 ${this.discoveredDevices.length}`);
                }, 2500);
            });

            console.log(`[MAIN] 最终发现 ${this.discoveredDevices.length} 个DLNA设备`);
            return this.discoveredDevices;

        } catch (error) {
            console.error('[MAIN] DLNA设备发现失败:', error);
            return this.discoveredDevices; // 返回已发现的设备
        }
    }

    // DLNA投屏到设备
    async castToDLNADevice(deviceId, mediaUrl, metadata = {}) {
        console.log(`[MAIN] 开始DLNA投屏: ${deviceId}`);

        try {
            // 查找设备
            const device = this.discoveredDevices.find(d => d.id === deviceId);
            if (!device) {
                throw new Error('设备不存在或已离线');
            }

            console.log(`[MAIN] 投屏到设备: ${device.name} (${device.address})`);

            // 使用DLNA客户端进行投屏
            const result = await this.dlnaClient.castToDevice(deviceId, mediaUrl, {
                title: metadata.title || '七星追剧',
                artist: metadata.artist || '未知',
                album: metadata.album || '影视剧集'
            });

            if (result.success) {
                console.log(`[MAIN] DLNA投屏成功: ${device.name}`);
                return {
                    success: true,
                    message: `已投屏到 ${device.name}`,
                    device: device
                };
            } else {
                // 详细的错误处理
                const errorMsg = result.error || '投屏失败';
                console.error(`[MAIN] DLNA投屏失败: ${errorMsg}`);
                console.error(`[MAIN] 设备信息: ${device.name} (${device.address})`);
                console.error(`[MAIN] 媒体URL: ${mediaUrl}`);

                // 根据错误类型提供更有帮助的错误信息
                if (errorMsg.includes('UPnP错误码: 501')) {
                    throw new Error('投屏失败：媒体URL为空或无效，请确保视频正在播放且使用直接视频链接（非网页播放器）');
                } else if (errorMsg.includes('SOAP错误')) {
                    throw new Error(`设备不支持此操作或媒体格式不兼容: ${errorMsg}`);
                } else if (errorMsg.includes('网络')) {
                    throw new Error(`网络连接问题: ${errorMsg}`);
                } else if (errorMsg.includes('超时')) {
                    throw new Error(`设备响应超时，请检查设备状态: ${errorMsg}`);
                } else {
                    throw new Error(`投屏失败: ${errorMsg}`);
                }
            }

        } catch (error) {
            console.error('[MAIN] DLNA投屏失败:', error);
            throw error;
        }
    }

    // 停止DLNA投屏
    async stopDLNACasting(deviceId) {
        console.log(`[MAIN] 停止DLNA投屏: ${deviceId}`);

        try {
            // 这里可以实现停止播放的DLNA命令
            // 目前简化实现，返回成功
            return {
                success: true,
                message: '投屏已停止'
            };

        } catch (error) {
            console.error('[MAIN] 停止DLNA投屏失败:', error);
            throw error;
        }
    }

    // Windows 设备发现
    async discoverWindowsDevices() {
        const devices = [];

        try {
            console.log('[MAIN] 搜索 Windows 投屏设备...');

            // 1. 使用 PowerShell 查找 Miracast 设备
            const miracastDevices = await this.findMiracastDevices();
            devices.push(...miracastDevices);

            // 2. 查找网络中的 Chromecast 设备
            const chromecastDevices = await this.findChromecastDevices();
            devices.push(...chromecastDevices);

            // 3. 查找外部显示器（可能支持投屏）
            const displayDevices = await this.findDisplayDevices();
            devices.push(...displayDevices);

        } catch (error) {
            console.error('[MAIN] Windows 设备发现失败:', error);
        }

        return devices;
    }

    // 查找 Miracast 设备
    async findMiracastDevices() {
        return new Promise((resolve) => {
            const devices = [];

            try {
                // 使用 PowerShell 命令查找 Miracast 设备
                const { spawn } = require('child_process');
                const powershell = spawn('powershell', [
                    '-Command',
                    'Get-PnpDevice -Class Display | Where-Object {$_.Status -eq "OK" -and $_.FriendlyName -like "*Wireless*"} | Select-Object FriendlyName, InstanceId'
                ]);

                let output = '';
                powershell.stdout.on('data', (data) => {
                    output += data.toString();
                });

                powershell.on('close', (code) => {
                    if (code === 0 && output.trim()) {
                        const lines = output.split('\n').filter(line => line.trim());
                        lines.forEach(line => {
                            if (line.includes('Wireless') || line.includes('Display')) {
                                devices.push({
                                    id: `miracast_${Date.now()}_${Math.random()}`,
                                    name: line.trim() || 'Miracast 设备',
                                    type: 'Miracast',
                                    icon: '🖥️',
                                    status: 'available',
                                    protocol: 'miracast'
                                });
                            }
                        });
                    }
                    resolve(devices);
                });

                powershell.on('error', (error) => {
                    console.warn('[MAIN] PowerShell Miracast 查询失败:', error);
                    resolve(devices);
                });

                // 设置超时
                setTimeout(() => {
                    powershell.kill();
                    resolve(devices);
                }, 5000);

            } catch (error) {
                console.warn('[MAIN] Miracast 设备查找失败:', error);
                resolve(devices);
            }
        });
    }

    // 查找 Chromecast 设备（通过网络扫描）
    async findChromecastDevices() {
        return new Promise((resolve) => {
            const devices = [];

            try {
                // 使用 Node.js 的 dgram 模块进行 mDNS 查询
                const dgram = require('dgram');
                const client = dgram.createSocket('udp4');

                // mDNS 查询包
                const query = Buffer.from([
                    0x00, 0x00, // Transaction ID
                    0x01, 0x00, // Flags (standard query)
                    0x00, 0x01, // Questions
                    0x00, 0x00, // Answer RRs
                    0x00, 0x00, // Authority RRs
                    0x00, 0x00, // Additional RRs
                    // Query for _googlecast._tcp.local
                    0x0b, 0x5f, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x63, 0x61, 0x73, 0x74, // _googlecast
                    0x04, 0x5f, 0x74, 0x63, 0x70, // _tcp
                    0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c, // local
                    0x00, // null terminator
                    0x00, 0x0c, // Type PTR
                    0x00, 0x01  // Class IN
                ]);

                client.on('message', (msg, rinfo) => {
                    try {
                        // 简单解析 mDNS 响应
                        if (msg.length > 12) {
                            devices.push({
                                id: `chromecast_${rinfo.address}`,
                                name: `Chromecast (${rinfo.address})`,
                                type: 'Chromecast',
                                icon: '📺',
                                status: 'available',
                                protocol: 'chromecast',
                                address: rinfo.address
                            });
                        }
                    } catch (error) {
                        console.warn('[MAIN] mDNS 响应解析失败:', error);
                    }
                });

                client.on('error', (error) => {
                    console.warn('[MAIN] mDNS 查询失败:', error);
                });

                // 发送查询到 mDNS 多播地址
                client.send(query, 5353, '224.0.0.251', (error) => {
                    if (error) {
                        console.warn('[MAIN] mDNS 查询发送失败:', error);
                    }
                });

                // 设置超时
                setTimeout(() => {
                    client.close();
                    resolve(devices);
                }, 3000);

            } catch (error) {
                console.warn('[MAIN] Chromecast 设备查找失败:', error);
                resolve(devices);
            }
        });
    }

    // 查找外部显示设备
    async findDisplayDevices() {
        return new Promise((resolve) => {
            const devices = [];

            try {
                // 使用 Electron 的 screen API 查找外部显示器
                const { screen } = require('electron');
                const displays = screen.getAllDisplays();

                displays.forEach((display, index) => {
                    if (!display.internal) {
                        devices.push({
                            id: `display_${display.id}`,
                            name: `外部显示器 ${index + 1} (${display.size.width}x${display.size.height})`,
                            type: 'Display',
                            icon: '🖥️',
                            status: 'available',
                            protocol: 'display',
                            display: display
                        });
                    }
                });

                resolve(devices);

            } catch (error) {
                console.warn('[MAIN] 显示设备查找失败:', error);
                resolve(devices);
            }
        });
    }

    // macOS 设备发现
    async discoverMacDevices() {
        const devices = [];

        try {
            console.log('[MAIN] 搜索 macOS 投屏设备...');

            // 使用 system_profiler 查找 AirPlay 设备
            const { exec } = require('child_process');

            return new Promise((resolve) => {
                exec('system_profiler SPAirPortDataType', (error, stdout, stderr) => {
                    if (!error && stdout) {
                        // 解析 AirPlay 设备信息
                        if (stdout.includes('AirPlay') || stdout.includes('Apple TV')) {
                            devices.push({
                                id: 'airplay_device',
                                name: 'AirPlay 设备',
                                type: 'AirPlay',
                                icon: '🍎',
                                status: 'available',
                                protocol: 'airplay'
                            });
                        }
                    }

                    // 查找外部显示器
                    exec('system_profiler SPDisplaysDataType', (dispError, dispStdout) => {
                        if (!dispError && dispStdout) {
                            const lines = dispStdout.split('\n');
                            lines.forEach((line, index) => {
                                if (line.includes('External') || line.includes('Thunderbolt')) {
                                    devices.push({
                                        id: `mac_display_${index}`,
                                        name: line.trim() || '外部显示器',
                                        type: 'Display',
                                        icon: '🖥️',
                                        status: 'available',
                                        protocol: 'display'
                                    });
                                }
                            });
                        }
                        resolve(devices);
                    });
                });
            });

        } catch (error) {
            console.error('[MAIN] macOS 设备发现失败:', error);
        }

        return devices;
    }

    // Linux 设备发现
    async discoverLinuxDevices() {
        const devices = [];

        try {
            console.log('[MAIN] 搜索 Linux 投屏设备...');

            const { exec } = require('child_process');

            return new Promise((resolve) => {
                // 查找连接的显示器
                exec('xrandr --query', (error, stdout, stderr) => {
                    if (!error && stdout) {
                        const lines = stdout.split('\n');
                        lines.forEach((line, index) => {
                            if (line.includes('connected') && !line.includes('disconnected')) {
                                const displayName = line.split(' ')[0];
                                if (displayName !== 'eDP-1' && displayName !== 'LVDS-1') { // 排除内置显示器
                                    devices.push({
                                        id: `linux_display_${displayName}`,
                                        name: `显示器 ${displayName}`,
                                        type: 'Display',
                                        icon: '🖥️',
                                        status: 'available',
                                        protocol: 'display'
                                    });
                                }
                            }
                        });
                    }
                    resolve(devices);
                });
            });

        } catch (error) {
            console.error('[MAIN] Linux 设备发现失败:', error);
        }

        return devices;
    }

    // 停止系统投屏 (已移除)
    async stopSystemCasting() {
        console.log('[MAIN] 系统投屏功能已被移除');
        return { success: false, error: '系统投屏功能已被移除' };
    }

    async initialize() {
        console.log('[MAIN] 开始初始化应用...');

        // 等待应用准备就绪
        await app.whenReady();

        // 设置IPC通信
        this.setupIPC();

        // 创建主窗口
        await this.createMainWindow();

        console.log('[MAIN] 应用初始化完成');
    }
}

// 应用实例
const qixingApp = new QixingZhuiju();

// 在应用启动前进行单实例检查
if (!setupSingleInstance()) {
    console.log('[MAIN] 应用已在运行，退出当前实例');
    process.exit(0);
}

// 应用事件处理
app.whenReady().then(async () => {
    try {
        console.log('[MAIN] Electron应用准备就绪');
        await qixingApp.initialize();
    } catch (error) {
        console.error('[MAIN] 应用初始化失败:', error);

        // 显示错误对话框
        if (app.isReady()) {
            dialog.showErrorBox('启动失败', `应用启动失败: ${error.message}`);
        }

        app.quit();
    }
});

app.on('window-all-closed', () => {
    console.log('[MAIN] 所有窗口已关闭事件触发');
    console.log('[MAIN] 当前平台:', process.platform);
    console.log('[MAIN] 所有窗口数量:', BrowserWindow.getAllWindows().length);

    if (process.platform !== 'darwin') {
        console.log('[MAIN] 非macOS平台，准备退出应用');
        app.quit();
    } else {
        console.log('[MAIN] macOS平台，保持应用运行');
    }
});

app.on('activate', async () => {
    console.log('[MAIN] 应用被激活');
    console.log('[MAIN] 当前窗口数量:', BrowserWindow.getAllWindows().length);

    if (BrowserWindow.getAllWindows().length === 0) {
        console.log('[MAIN] 没有窗口，创建新的主窗口');
        await qixingApp.createMainWindow();
    } else if (qixingApp.mainWindow) {
        console.log('[MAIN] 主窗口存在，显示并聚焦');
        // 显示并聚焦现有窗口
        qixingApp.mainWindow.show();
        qixingApp.mainWindow.focus();
    }
});

// 应用即将退出时的清理工作
app.on('before-quit', (event) => {
    console.log('[MAIN] 应用即将退出，执行清理工作...');

    // 关闭所有窗口
    if (qixingApp.playerWindow) {
        qixingApp.playerWindow.close();
    }

    if (qixingApp.mainWindow) {
        qixingApp.mainWindow.close();
    }
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
    console.error('[MAIN] 未捕获的异常:', error);

    // 尝试显示错误信息（如果可能的话）
    if (app.isReady()) {
        dialog.showErrorBox('应用错误', `发生未处理的错误: ${error.message}`);
    }

    // 优雅地退出应用
    app.quit();
});

// 处理未处理的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
    console.error('[MAIN] 未处理的Promise拒绝:', reason);
});

// 禁用安全警告
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

// 启用透明窗口和亚克力效果所需的设置
// 注意：为了支持透明效果，我们需要启用硬件加速
// app.disableHardwareAcceleration(); // 注释掉，因为透明窗口需要GPU支持

// 添加命令行参数优化渲染
// app.commandLine.appendSwitch('--disable-gpu'); // 注释掉，透明窗口需要GPU
app.commandLine.appendSwitch('--enable-transparent-visuals');  // 启用透明视觉效果
app.commandLine.appendSwitch('--disable-gpu-sandbox');
// app.commandLine.appendSwitch('--disable-software-rasterizer'); // 注释掉
app.commandLine.appendSwitch('--disable-background-timer-throttling');
app.commandLine.appendSwitch('--disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('--disable-renderer-backgrounding');
app.commandLine.appendSwitch('--disable-features', 'TranslateUI');
app.commandLine.appendSwitch('--disable-web-security');
app.commandLine.appendSwitch('--no-sandbox');
app.commandLine.appendSwitch('--disable-dev-shm-usage');
app.commandLine.appendSwitch('--disable-extensions');
app.commandLine.appendSwitch('--disable-plugins');
app.commandLine.appendSwitch('--disable-background-networking');
app.commandLine.appendSwitch('--disable-default-apps');
