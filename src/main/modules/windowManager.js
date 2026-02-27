const { BrowserWindow, Menu } = require('electron');
const path = require('path');
const { isDev } = require('./logger');

// 创建主窗口
async function createMainWindow(qixingApp) {
    if (isDev) console.log('[MAIN] 创建主窗口...');

    qixingApp.mainWindow = new BrowserWindow({
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
            backgroundThrottling: false, // 防止后台时CPU节流
            preload: path.join(__dirname, '..', '..', 'preload.js'),
            disableBlinkFeatures: 'Auxclick', // 禁用一些不必要的Blink特性
            disableSiteIsolationTrials: true, // 禁用站点隔离试验以提高性能
            hardwareAcceleration: false // 禁用硬件加速，防止GPU崩溃
        },
        icon: path.join(__dirname, '..', '..', '..', 'assets', 'icon.png'),
        frame: false,  // 取消标题栏
        transparent: true,  // 启用透明窗口
        backgroundColor: '#00000000',  // 完全透明的背景
        vibrancy: isDev ? 'dark' : undefined, // 仅在开发模式下启用vibrancy
        backgroundMaterial: isDev ? 'acrylic' : undefined, // 仅在开发模式下启用acrylic效果
        autoHideMenuBar: true,  // 自动隐藏菜单栏
        show: false,
        title: '七星追剧',
        // 添加GPU相关配置，防止GPU崩溃
        offscreen: false,
        enableLargerThanScreen: false
    });

    // 完全移除菜单栏
    qixingApp.mainWindow.setMenuBarVisibility(false);

    // 加载主页面
    try {
        const htmlPath = path.join(__dirname, '..', '..', 'renderer', 'index.html');
        await qixingApp.mainWindow.loadFile(htmlPath);
        if (isDev) console.log('[MAIN] 主页面加载成功');
    } catch (error) {
        console.error('[MAIN] 主页面加载失败:', error);
        throw error;
    }

    // 显示窗口 - 使用多种方式确保窗口显示
    qixingApp.mainWindow.once('ready-to-show', () => {
        if (isDev) console.log('[MAIN] 主窗口准备显示');
        qixingApp.mainWindow.show();
        qixingApp.mainWindow.focus();
        if (isDev) console.log('[MAIN] 主窗口已显示');

        if (isDev) {
            qixingApp.mainWindow.webContents.openDevTools();
        }
    });

    // 备用显示机制：如果3秒后ready-to-show还没触发，强制显示
    setTimeout(() => {
        if (qixingApp.mainWindow && !qixingApp.mainWindow.isVisible()) {
            console.log('[MAIN] 备用显示机制触发');
            qixingApp.mainWindow.show();
            qixingApp.mainWindow.focus();
        }
    }, 3000);

    // 窗口关闭事件
    qixingApp.mainWindow.on('closed', () => {
        if (isDev) console.log('[MAIN] 主窗口已关闭');
        qixingApp.mainWindow = null;
        if (qixingApp.playerWindow) {
            qixingApp.playerWindow.close();
        }
    });

    // 渲染进程崩溃监听 - 只保留必要的恢复逻辑
    qixingApp.mainWindow.webContents.on('crashed', () => {
        console.error('[MAIN] 渲染进程崩溃!');

        // 尝试重新加载页面
        setTimeout(() => {
            if (qixingApp.mainWindow && !qixingApp.mainWindow.isDestroyed()) {
                try {
                    qixingApp.mainWindow.webContents.reload();
                } catch (error) {
                    console.error('[MAIN] 重新加载失败:', error);
                }
            }
        }, 1000);
    });

    // 监听渲染进程崩溃（新API）
    qixingApp.mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.error('[MAIN] 渲染进程崩溃:', details.reason, '退出代码:', details.exitCode);

        // 尝试重新加载页面
        setTimeout(() => {
            if (qixingApp.mainWindow && !qixingApp.mainWindow.isDestroyed()) {
                try {
                    qixingApp.mainWindow.webContents.reload();
                } catch (error) {
                    console.error('[MAIN] 重新加载失败:', error);
                }
            }
        }, 1000);
    });

    // 页面加载失败事件
    qixingApp.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('[MAIN] 页面加载失败:', errorCode, errorDescription, validatedURL);
    });

    // 延迟创建菜单，避免阻塞窗口初始化
    setTimeout(() => {
        createMenu();
    }, 100);
}

// 创建播放器窗口
function createPlayerWindow(qixingApp, videoData) {
    if (isDev) console.log('[MAIN] 创建播放器窗口:', videoData?.title || '未知视频');

    if (qixingApp.playerWindow) {
        if (isDev) console.log('[MAIN] 播放器窗口已存在，发送新视频数据并聚焦窗口');
        // 发送新的视频数据到现有播放器窗口
        if (videoData) {
            qixingApp.playerWindow.webContents.send('video-data', videoData);
        }
        qixingApp.playerWindow.focus();
        return;
    }

    qixingApp.playerWindow = new BrowserWindow({
        width: 1000,
        height: 600,
        minWidth: 600,
        minHeight: 400,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false,
            allowRunningInsecureContent: true,
            preload: path.join(__dirname, '..', '..', 'preload.js'),
            disableBlinkFeatures: 'Auxclick', // 禁用一些不必要的Blink特性
            disableSiteIsolationTrials: true, // 禁用站点隔离试验以提高性能
            hardwareAcceleration: false // 禁用硬件加速，防止GPU崩溃
        },
        icon: path.join(__dirname, '..', '..', '..', 'assets', 'icon.png'),
        show: false,
        frame: false,  // 取消标题栏
        transparent: true,  // 启用透明窗口
        backgroundColor: '#00000000',  // 完全透明的背景
        vibrancy: isDev ? 'dark' : undefined, // 仅在开发模式下启用vibrancy
        backgroundMaterial: isDev ? 'acrylic' : undefined, // 仅在开发模式下启用acrylic效果
        autoHideMenuBar: true,  // 自动隐藏菜单栏
        title: videoData?.title || '七星追剧播放器',
        // 添加GPU相关配置，防止GPU崩溃
        offscreen: false,
        enableLargerThanScreen: false
    });

    // 完全移除菜单栏
    qixingApp.playerWindow.setMenuBarVisibility(false);

    // 加载播放器页面
    const playerHtmlPath = path.join(__dirname, '..', '..', 'renderer', 'player.html');
    qixingApp.playerWindow.loadFile(playerHtmlPath)
        .then(() => {
            if (isDev) console.log('[MAIN] 播放器页面加载成功');
        })
        .catch(error => {
            console.error('[MAIN] 播放器页面加载失败:', error);
        });

    qixingApp.playerWindow.once('ready-to-show', () => {
        if (isDev) console.log('[MAIN] 播放器窗口准备显示');
        qixingApp.playerWindow.show();

        // 发送视频数据到播放器窗口
        if (videoData) {
            qixingApp.playerWindow.webContents.send('video-data', videoData);
        }
    });

    qixingApp.playerWindow.on('closed', () => {
        if (isDev) console.log('[MAIN] 播放器窗口已关闭');
        qixingApp.playerWindow = null;
    });

    // 播放器窗口错误处理
    qixingApp.playerWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('[MAIN] 播放器页面加载失败:', errorCode, errorDescription, validatedURL);
    });
}

// 创建应用菜单
function createMenu() {
    // 仅在开发模式下创建完整菜单
    if (!isDev) {
        return;
    }

    if (isDev) console.log('[MAIN] 创建应用菜单...');

    const template = [
        {
            label: '文件',
            submenu: [
                {
                    label: '退出',
                    accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
                    click: () => {
                        if (isDev) console.log('[MAIN] 菜单退出被点击');
                        require('electron').app.quit();
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
        Menu.setApplicationMenu(menu);
        if (isDev) console.log('[MAIN] 应用菜单创建完成');
    } catch (error) {
        console.error('[MAIN] 创建菜单失败:', error);
    }
}

module.exports = {
    createMainWindow,
    createPlayerWindow
};
