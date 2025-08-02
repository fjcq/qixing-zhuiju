const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');

class QixingZhuiju {
    constructor() {
        this.mainWindow = null;
        this.playerWindow = null;
        this.isDev = process.argv.includes('--dev');
    }

    async createMainWindow() {
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
                preload: path.join(__dirname, 'src', 'preload.js')
            },
            icon: path.join(__dirname, 'assets', 'icon.png'),
            titleBarStyle: 'default',
            autoHideMenuBar: true,  // 自动隐藏菜单栏
            show: false
        });

        // 完全移除菜单栏
        this.mainWindow.setMenuBarVisibility(false);

        // 加载主页面
        await this.mainWindow.loadFile('src/renderer/index.html');

        // 显示窗口
        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow.show();
            if (this.isDev) {
                this.mainWindow.webContents.openDevTools();
            }
        });

        // 窗口关闭事件
        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
            if (this.playerWindow) {
                this.playerWindow.close();
            }
        });

        // 设置菜单
        this.createMenu();
    }

    createPlayerWindow(videoData) {
        if (this.playerWindow) {
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
            autoHideMenuBar: true  // 自动隐藏菜单栏
        });

        // 完全移除菜单栏
        this.playerWindow.setMenuBarVisibility(false);

        this.playerWindow.loadFile('src/renderer/player.html');

        this.playerWindow.once('ready-to-show', () => {
            this.playerWindow.show();
            // 发送视频数据到播放器窗口
            this.playerWindow.webContents.send('video-data', videoData);
        });

        this.playerWindow.on('closed', () => {
            this.playerWindow = null;
        });
    }

    createMenu() {
        const template = [
            {
                label: '文件',
                submenu: [
                    {
                        label: '退出',
                        accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                        click: () => {
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

        const menu = Menu.buildFromTemplate(template);
        Menu.setApplicationMenu(menu);
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
        // 等待应用准备就绪
        await app.whenReady();

        // 设置IPC通信
        this.setupIPC();

        // 创建主窗口
        await this.createMainWindow();
    }
}

// 应用实例
const qixingApp = new QixingZhuiju();

// 应用事件处理
app.whenReady().then(() => {
    qixingApp.initialize();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        await qixingApp.createMainWindow();
    }
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
