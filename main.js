const { app } = require('electron');
const path = require('path');

// 彻底禁用GPU加速，解决GPU进程崩溃问题
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-webgl');
app.commandLine.appendSwitch('disable-software-rasterizer');

// 设置进程编码，确保中文正确显示
if (process.platform === 'win32') {
    try {
        if (process.env.VSCODE_PID) {
            console.log('[MAIN] 检测到VS Code环境，使用UTF-8编码');
        } else {
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
const { setupMainProcessErrorHandling, ErrorTypes, globalErrorHandler } = require('./src/main/modules/errorHandler');
const DownloadManager = require('./src/main/modules/DownloadManager');

// 初始化日志
setupLogger();

// 初始化全局错误处理
setupMainProcessErrorHandling();

class QixingZhuiju {
    constructor() {
        this.mainWindow = null;
        this.playerWindow = null;
        this.castWindow = null; // 投屏窗口
        this.isDev = isDev;
        this.dlnaManager = new DLNAManager(this.isDev); // 使用DLNA管理器
        this.updateManager = new UpdateManager(this); // 使用自动更新管理器
        this.downloadManager = new DownloadManager(); // 下载管理器
        this.currentVideoUrl = null; // 当前播放的视频URL（用于投屏）
        // 初始化 streaming 模块（边下边播系统）
        this._initStreamingModules();
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

    // 初始化 streaming 模块（边下边播系统）
    _initStreamingModules() {
        try {
            const SpeedLimiter = require('./src/main/modules/streaming/scheduler/SpeedLimiter');
            const DownloadQueue = require('./src/main/modules/streaming/scheduler/DownloadQueue');
            const StorageManager = require('./src/main/modules/streaming/scheduler/StorageManager');
            const ResumeManager = require('./src/main/modules/streaming/scheduler/ResumeManager');
            const ManifestStore = require('./src/main/modules/streaming/persistence/ManifestStore');
            const IntegrityChecker = require('./src/main/modules/streaming/IntegrityChecker');
            const RetryController = require('./src/main/modules/streaming/RetryController');
            const AdaptiveBitrateController = require('./src/main/modules/streaming/AdaptiveBitrateController');
            const StreamEngine = require('./src/main/modules/streaming/StreamEngine');

            // manifest 文件路径（用户数据目录下，保证跨平台一致）
            const manifestPath = path.join(app.getPath('userData'), 'streaming-manifest.json');
            // 默认下载路径（用户下载目录，始终存在）
            const downloadPath = app.getPath('downloads');

            // 创建各模块实例
            this.speedLimiter = new SpeedLimiter({});
            this.downloadQueue = new DownloadQueue({ maxConcurrent: 3 });
            this.storageManager = new StorageManager({ downloadPath });
            this.resumeManager = new ResumeManager({});
            this.manifestStore = new ManifestStore({ manifestPath });
            this.integrityChecker = new IntegrityChecker({});
            this.retryController = new RetryController({});

            // transportFactory：根据 source.type 返回对应 transport
            // 懒加载 HttpTransport，magnet/local 待 Task 19/21 实现
            this.transportFactory = (source) => {
                if (!source || !source.type) {
                    throw new Error('invalid source: missing type');
                }
                if (source.type === 'url') {
                    const HttpTransport = require('./src/main/modules/streaming/transports/HttpTransport');
                    return new HttpTransport();
                }
                throw new Error(`unsupported source type: ${source.type} (Task 19/21 pending)`);
            };

            // StreamEngine 实例（streamPort=0 表示随机端口，onReady 后更新）
            this.streamEngine = new StreamEngine({
                transportFactory: this.transportFactory,
                downloadQueue: this.downloadQueue,
                speedLimiter: this.speedLimiter,
                resumeManager: this.resumeManager,
                manifestStore: this.manifestStore,
                storageManager: this.storageManager,
                integrityChecker: this.integrityChecker,
                retryController: this.retryController,
                streamPort: 0,
                prebufferTarget: 5
            });

            // AdaptiveBitrateController 实例
            this.adaptiveBitrateController = new AdaptiveBitrateController({
                streamEngine: this.streamEngine
            });

            // 暴露给 ipcHandler 路由使用（设计文档要求）
            global.__streamEngine = this.streamEngine;

            // IPC cleanup 函数（setupStreaming 后填充）
            this._streamingCleanup = null;

            console.log('[MAIN] streaming 模块初始化完成');
        } catch (error) {
            // 初始化失败不阻塞应用启动，仅记录错误
            console.error('[MAIN] streaming 模块初始化失败:', error);
            this._streamingCleanup = null;
        }
    }

    // 装配 streaming IPC 网关 + 启动事件转发 + 异常恢复
    async setupStreaming() {
        if (!this.streamEngine || !this.manifestStore) {
            console.warn('[MAIN] streaming 模块未初始化，跳过 IPC 装配');
            return;
        }
        try {
            const { setupStreamingIPC } = require('./src/main/modules/streaming/ipcGateway');

            // 加载 manifest（异常恢复用）
            await this.manifestStore.load();
            // 恢复异常退出任务（downloading 状态归位为 paused）
            await this.streamEngine.recover();
            // 启动 AdaptiveBitrateController 监听
            this.adaptiveBitrateController.start();

            // 注册 IPC 频道 + 启动本地 HTTP 服务器 + 转发事件
            this._streamingCleanup = setupStreamingIPC({
                streamEngine: this.streamEngine,
                storageManager: this.storageManager,
                retryController: this.retryController,
                speedLimiter: this.speedLimiter,
                streamPort: 0,
                onReady: (port) => {
                    console.log(`[MAIN] streaming HTTP server listening on 127.0.0.1:${port}`);
                    this.streamEngine.streamPort = port;
                }
            });

            console.log('[MAIN] streaming IPC 网关已注册');
        } catch (error) {
            console.error('[MAIN] streaming IPC 装配失败:', error);
        }
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
            // 初始化下载管理器
            qixingApp.downloadManager.initialize();
            // 创建主窗口
            await qixingApp.createMainWindow();
            // 设置IPC通信
            qixingApp.setupIPC();
            // 装配 streaming 模块（边下边播 IPC + HTTP 服务器）
            await qixingApp.setupStreaming();
            // 开始自动检查更新
            qixingApp.startAutoCheckUpdates();
        } catch (error) {
            console.error('[MAIN] 应用启动失败:', error);
            app.quit();
        }
    });

    // 应用退出前清理 streaming 资源
    app.on('before-quit', (event) => {
        if (qixingApp && qixingApp._streamingCleanup) {
            event.preventDefault();
            try {
                qixingApp.adaptiveBitrateController.stop();
                qixingApp._streamingCleanup();
                qixingApp.retryController.destroy();
                console.log('[MAIN] streaming 资源已清理');
            } catch (err) {
                console.error('[MAIN] streaming 清理失败:', err);
            }
            // 避免重复清理，重新触发退出
            qixingApp._streamingCleanup = null;
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
        // 兜底清理磁力链子进程，防止主窗口关闭后播放器窗口残留下载
        if (qixingApp && typeof qixingApp.cleanupMagnetProcess === 'function') {
            qixingApp.cleanupMagnetProcess();
        }
    });
}

// 启动应用
main().catch(error => {
    console.error('[MAIN] 应用启动出错:', error);
    process.exit(1);
});
