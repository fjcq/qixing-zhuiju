// 自动更新管理器
const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');
const { isDev } = require('./logger');

class UpdateManager {
    constructor(qixingApp) {
        this.qixingApp = qixingApp;
        this.isCheckingUpdate = false;
        
        // 配置自动更新
        this.configureAutoUpdater();
        
        // 设置事件监听
        this.setupEventListeners();
    }
    
    // 配置自动更新
    configureAutoUpdater() {
        // 开发模式下禁用自动更新
        if (isDev) {
            autoUpdater.autoDownload = false;
            return;
        }
        
        // 配置自动下载
        autoUpdater.autoDownload = true;
        
        // 配置日志级别
        autoUpdater.logger = {
            info: (message) => {
                console.log(`[UPDATE] ${message}`);
            },
            warn: (message) => {
                console.warn(`[UPDATE] ${message}`);
            },
            error: (message) => {
                console.error(`[UPDATE] ${message}`);
            }
        };
        
        // 配置更新渠道
        autoUpdater.channel = 'latest';
        
        // 配置检查间隔（1小时）
        this.checkInterval = 60 * 60 * 1000;
    }
    
    // 设置事件监听
    setupEventListeners() {
        // 更新可用
        autoUpdater.on('update-available', (info) => {
            console.log('[UPDATE] 发现新版本:', info.version);
            console.log('[UPDATE] 更新日志:', info.releaseNotes);
            
            // 向主窗口发送更新可用事件
            if (this.qixingApp.mainWindow && !this.qixingApp.mainWindow.isDestroyed()) {
                this.qixingApp.mainWindow.webContents.send('update-available', info);
            }
        });
        
        // 更新下载进度
        autoUpdater.on('download-progress', (progressObj) => {
            console.log('[UPDATE] 下载进度:', Math.round(progressObj.percent) + '%');
            
            // 向主窗口发送下载进度事件
            if (this.qixingApp.mainWindow && !this.qixingApp.mainWindow.isDestroyed()) {
                this.qixingApp.mainWindow.webContents.send('download-progress', progressObj);
            }
        });
        
        // 更新下载完成
        autoUpdater.on('update-downloaded', (info) => {
            console.log('[UPDATE] 新版本下载完成:', info.version);
            
            // 向主窗口发送更新下载完成事件
            if (this.qixingApp.mainWindow && !this.qixingApp.mainWindow.isDestroyed()) {
                this.qixingApp.mainWindow.webContents.send('update-downloaded', info);
            }
            
            // 显示安装对话框
            this.showUpdateInstallDialog(info);
        });
        
        // 更新错误
        autoUpdater.on('error', (error) => {
            console.error('[UPDATE] 更新失败:', error.message);
            
            // 向主窗口发送更新错误事件
            if (this.qixingApp.mainWindow && !this.qixingApp.mainWindow.isDestroyed()) {
                this.qixingApp.mainWindow.webContents.send('update-error', error);
            }
        });
        
        // 没有更新可用
        autoUpdater.on('update-not-available', (info) => {
            console.log('[UPDATE] 当前已是最新版本:', info.version);
            
            // 向主窗口发送没有更新事件
            if (this.qixingApp.mainWindow && !this.qixingApp.mainWindow.isDestroyed()) {
                this.qixingApp.mainWindow.webContents.send('update-not-available', info);
            }
        });
        
        // 更新检查开始
        autoUpdater.on('checking-for-update', () => {
            console.log('[UPDATE] 开始检查更新...');
            
            // 向主窗口发送检查更新开始事件
            if (this.qixingApp.mainWindow && !this.qixingApp.mainWindow.isDestroyed()) {
                this.qixingApp.mainWindow.webContents.send('checking-for-update');
            }
        });
    }
    
    // 显示更新安装对话框
    showUpdateInstallDialog(info) {
        dialog.showMessageBox({
            type: 'info',
            title: '更新可用',
            message: `发现新版本 ${info.version}`,
            detail: `是否立即安装新版本？\n\n更新内容：\n${info.releaseNotes || '优化了性能和修复了一些bug'}`,
            buttons: ['立即安装', '稍后安装'],
            defaultId: 0,
            cancelId: 1
        }).then((result) => {
            if (result.response === 0) {
                // 立即安装
                this.installUpdate();
            }
        });
    }
    
    // 检查更新
    async checkForUpdates(manual = false) {
        if (this.isCheckingUpdate) {
            console.log('[UPDATE] 正在检查更新中，请勿重复请求');
            return;
        }
        
        this.isCheckingUpdate = true;
        
        try {
            // 开发模式下不检查更新
            if (isDev) {
                console.log('[UPDATE] 开发模式下不检查更新');
                return {
                    success: false,
                    message: '开发模式下不检查更新'
                };
            }
            
            console.log('[UPDATE] 开始检查更新...');
            await autoUpdater.checkForUpdates();
            
            return {
                success: true,
                message: '更新检查已开始'
            };
        } catch (error) {
            console.error('[UPDATE] 检查更新失败:', error);
            return {
                success: false,
                message: `检查更新失败: ${error.message}`
            };
        } finally {
            this.isCheckingUpdate = false;
        }
    }
    
    // 安装更新
    installUpdate() {
        console.log('[UPDATE] 开始安装更新...');
        autoUpdater.quitAndInstall();
    }
    
    // 取消更新
    cancelUpdate() {
        console.log('[UPDATE] 取消更新');
        autoUpdater.abortDownload();
    }
    
    // 开始自动检查更新
    startAutoCheck() {
        if (isDev) {
            return;
        }
        
        console.log('[UPDATE] 开始自动检查更新，间隔:', this.checkInterval / 1000 / 60, '分钟');
        
        // 立即检查一次
        this.checkForUpdates();
        
        // 设置定时检查
        this.updateTimer = setInterval(() => {
            this.checkForUpdates();
        }, this.checkInterval);
    }
    
    // 停止自动检查更新
    stopAutoCheck() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
            console.log('[UPDATE] 停止自动检查更新');
        }
    }
    
    // 获取当前版本
    getCurrentVersion() {
        return require('electron').app.getVersion();
    }
}

module.exports = UpdateManager;