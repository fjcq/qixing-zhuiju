const { app } = require('electron');
const path = require('path');

// 彻底禁用GPU加速，解决GPU进程崩溃问题
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-webgl');
app.commandLine.appendSwitch('disable-software-rasterizer');

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

// 导入模块化组件
const { setupLogger, isDev } = require('./src/main/modules/logger');
const { setupSingleInstance, handleSecondInstance } = require('./src/main/modules/singleInstance');
const { createMainWindow, createPlayerWindow } = require('./src/main/modules/windowManager');
const { setupIPC } = require('./src/main/modules/ipcHandler');
const DLNAManager = require('./src/main/modules/dlnaManager');
const UpdateManager = require('./src/main/modules/updateManager');

// 初始化日志
setupLogger();

class QixingZhuiju {
    constructor() {
        this.mainWindow = null;
        this.playerWindow = null;
        this.castWindow = null; // 投屏窗口
        this.isDev = isDev;
        this.dlnaManager = new DLNAManager(this.isDev); // 使用DLNA管理器
        this.updateManager = new UpdateManager(this); // 使用自动更新管理器
        this.currentVideoUrl = null; // 当前播放的视频URL（用于投屏）
    }

    // 检查更新
    async checkForUpdates() {
        return await this.updateManager.checkForUpdates(true);
    }

    // 安装更新
    installUpdate() {
        this.updateManager.installUpdate();
    }

    // 取消更新
    cancelUpdate() {
        this.updateManager.cancelUpdate();
    }

    // 开始自动检查更新
    startAutoCheckUpdates() {
        this.updateManager.startAutoCheck();
    }

    // 停止自动检查更新
    stopAutoCheckUpdates() {
        this.updateManager.stopAutoCheck();
    }

    // 创建主窗口（使用模块化组件）
    async createMainWindow() {
        await createMainWindow(this);
    }

    // 创建播放器窗口（使用模块化组件）
    createPlayerWindow(videoData) {
        createPlayerWindow(this, videoData);
        // 保存当前视频URL用于投屏
        if (videoData?.url) {
            this.currentVideoUrl = videoData.url;
            this.dlnaManager.setCurrentVideoUrl(videoData.url);
        }
    }

    // 设置IPC通信（使用模块化组件）
    setupIPC() {
        setupIPC(this);
    }

    // DLNA设备发现（使用DLNA管理器）
    async discoverCastDevices() {
        return await this.dlnaManager.discoverCastDevices();
    }

    // DLNA投屏到设备（使用DLNA管理器）
    async castToDLNADevice(deviceId, mediaUrl, metadata = {}) {
        // 如果mediaUrl为空，使用保存的视频URL
        if (!mediaUrl && this.currentVideoUrl) {
            mediaUrl = this.currentVideoUrl;
        }
        return await this.dlnaManager.castToDLNADevice(deviceId, mediaUrl, metadata);
    }

    // 停止DLNA投屏（使用DLNA管理器）
    async stopDLNACasting(deviceId) {
        return await this.dlnaManager.stopDLNACasting(deviceId);
    }

    // 系统投屏功能 (已移除)
    async startSystemCasting(castInfo) {
        console.log('[MAIN] 系统投屏功能已被移除');
        throw new Error('系统投屏功能已被移除，请使用DLNA投屏');
    }
}

// 应用主逻辑
let qixingApp;

async function main() {
    console.log('[MAIN] 七星追剧应用启动流程开始');

    // 单实例检查
    const canStart = setupSingleInstance();
    if (!canStart) {
        return;
    }

    // 初始化应用实例
    qixingApp = new QixingZhuiju();

    // 设置第二个实例处理
    handleSecondInstance(qixingApp);

    // 监听应用就绪事件
    app.on('ready', async () => {
        console.log('[MAIN] 应用就绪，创建主窗口...');
        try {
            // 创建主窗口
            await qixingApp.createMainWindow();
            // 设置IPC通信
            qixingApp.setupIPC();
            // 开始自动检查更新
            qixingApp.startAutoCheckUpdates();
        } catch (error) {
            console.error('[MAIN] 应用启动失败:', error);
            app.quit();
        }
    });

    // 监听所有窗口关闭事件
    app.on('window-all-closed', () => {
        console.log('[MAIN] 所有窗口已关闭');
        // 在macOS上，除非用户用Cmd+Q明确退出，否则应用及其菜单栏会保持激活状态
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    // 在macOS上，当点击dock图标并且没有其他窗口打开时，重新创建一个窗口
    app.on('activate', async () => {
        console.log('[MAIN] 应用激活，检查主窗口...');
        if (qixingApp.mainWindow === null) {
            await qixingApp.createMainWindow();
        }
    });

    // 监听应用退出事件
    app.on('will-quit', () => {
        console.log('[MAIN] 应用即将退出');
    });
}

// 启动应用
main().catch(error => {
    console.error('[MAIN] 应用启动出错:', error);
    process.exit(1);
});
