const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const os = require('os');

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
            titleBarStyle: 'default',
            autoHideMenuBar: true,  // 自动隐藏菜单栏
            show: false,
            title: '七星追剧'
        });

        // 完全移除菜单栏
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

            // 在 macOS 上设置应用菜单
            if (process.platform === 'darwin') {
                Menu.setApplicationMenu(menu);
            } else {
                // 在 Windows 和 Linux 上，由于我们隐藏了菜单栏，不设置菜单
                Menu.setApplicationMenu(null);
            }

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

// 禁用硬件加速以解决GPU崩溃问题
app.disableHardwareAcceleration();

// 添加命令行参数解决GPU问题
app.commandLine.appendSwitch('--disable-gpu');
app.commandLine.appendSwitch('--disable-gpu-sandbox');
app.commandLine.appendSwitch('--disable-software-rasterizer');
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
