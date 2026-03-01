const { ipcMain, BrowserWindow } = require('electron');
const {
    validateVideoData,
    validateDeviceId,
    validateMediaUrl,
    validateSearchKeyword,
    sanitizeInput
} = require('./securityValidator');

/**
 * 设置IPC通信处理
 * @param {object} qixingApp - 应用实例
 */
function setupIPC(qixingApp) {
    // 打开播放器窗口
    ipcMain.handle('open-player', async (event, videoData) => {
        try {
            console.log('[MAIN] 收到打开播放器请求');

            // 安全验证：验证视频数据
            const validation = validateVideoData(videoData);
            if (!validation.valid) {
                console.error('[MAIN] 视频数据验证失败:', validation.error);
                return { success: false, message: validation.error };
            }

            // 使用清理后的数据
            const safeData = validation.sanitized || videoData;

            // 保存当前播放的视频URL，用于投屏
            qixingApp.currentVideoUrl = safeData.url;
            console.log('[MAIN] 保存视频URL用于投屏:', qixingApp.currentVideoUrl);

            qixingApp.createPlayerWindow(safeData);
            return { success: true, message: '播放器已打开' };
        } catch (error) {
            console.error('[MAIN] 打开播放器失败:', error);
            return { success: false, message: '处理请求时发生错误' };
        }
    });

    // 关闭播放器窗口
    ipcMain.handle('close-player', () => {
        try {
            if (qixingApp.playerWindow) {
                qixingApp.playerWindow.close();
            }
            return { success: true };
        } catch (error) {
            console.error('[MAIN] 关闭播放器失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 获取应用版本
    ipcMain.handle('get-app-version', () => require('electron').app.getVersion());

    // 打开外部链接
    ipcMain.handle('open-external-url', async (event, url) => {
        try {
            // 安全验证：验证URL
            const validation = validateMediaUrl(url);
            if (!validation.valid) {
                console.error('[MAIN] 外部链接验证失败:', validation.error);
                return { success: false, error: validation.error };
            }

            await require('electron').shell.openExternal(validation.sanitized || url);
            return { success: true };
        } catch (error) {
            console.error('[MAIN] 打开外部链接失败:', error);
            return { success: false, error: '打开链接失败' };
        }
    });

    // 窗口控制处理器
    ipcMain.handle('window-close', event => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            window.close();
        }
    });

    ipcMain.handle('window-minimize', event => {
        const window = BrowserWindow.fromWebContents(event.sender);
        window.minimize();
    });

    ipcMain.handle('window-maximize', event => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            if (window.isMaximized()) {
                window.unmaximize();
            } else {
                window.maximize();
            }
        }
    });

    ipcMain.handle('window-set-title', (event, title) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            window.setTitle(title);
            return { success: true };
        }
        return { success: false };
    });

    ipcMain.handle('toggle-always-on-top', event => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (window) {
            const currentState = window.isAlwaysOnTop();
            const newState = !currentState;

            console.log('[MAIN] ========== 置顶状态切换请求 ==========');
            console.log(`[MAIN] 当前置顶状态: ${currentState}`);
            console.log(`[MAIN] 请求切换到: ${newState}`);

            // 设置置顶状态，并使用更高的级别确保有效
            try {
                if (newState) {
                    // 尝试多种置顶级别以确保成功
                    window.setAlwaysOnTop(true, 'screen-saver');
                    console.log('[MAIN] 设置置顶级别: screen-saver');
                } else {
                    window.setAlwaysOnTop(false, 'normal');
                    console.log('[MAIN] 取消置顶，恢复正常级别');
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
    ipcMain.handle('discover-cast-devices', async event => {
        console.log('[MAIN] 收到设备发现请求');
        try {
            return await qixingApp.discoverCastDevices();
        } catch (error) {
            console.error('[MAIN] 设备发现失败:', error);
            return { success: false, error: error.message, devices: [] };
        }
    });

    // DLNA投屏处理
    ipcMain.handle('cast-to-dlna-device', async (event, deviceId, mediaUrl, metadata) => {
        console.log('[MAIN] 收到DLNA投屏请求');

        // 安全验证：验证设备ID
        const deviceValidation = validateDeviceId(deviceId);
        if (!deviceValidation.valid) {
            console.error('[MAIN] 设备ID验证失败:', deviceValidation.error);
            return { success: false, error: deviceValidation.error };
        }

        // 如果mediaUrl为空，使用保存的视频URL
        if (!mediaUrl && qixingApp.currentVideoUrl) {
            mediaUrl = qixingApp.currentVideoUrl;
            console.log('[MAIN] 使用保存的视频URL:', mediaUrl);
        }

        // 安全验证：验证媒体URL
        if (mediaUrl) {
            const urlValidation = validateMediaUrl(mediaUrl);
            if (!urlValidation.valid) {
                console.error('[MAIN] 媒体URL验证失败:', urlValidation.error);
                return { success: false, error: urlValidation.error };
            }
        }

        try {
            return await qixingApp.castToDLNADevice(deviceId, mediaUrl, metadata);
        } catch (error) {
            console.error('[MAIN] DLNA投屏失败:', error);
            return { success: false, error: '投屏操作失败' };
        }
    });

    // 停止DLNA投屏
    ipcMain.handle('stop-dlna-casting', async (event, deviceId) => {
        console.log('[MAIN] 收到停止DLNA投屏请求');

        const deviceValidation = validateDeviceId(deviceId);
        if (!deviceValidation.valid) {
            return { success: false, error: deviceValidation.error };
        }

        try {
            return await qixingApp.stopDLNACasting(deviceId);
        } catch (error) {
            console.error('[MAIN] 停止DLNA投屏失败:', error);
            return { success: false, error: '停止投屏失败' };
        }
    });

    // 暂停DLNA投屏
    ipcMain.handle('pause-dlna-casting', async (event, deviceId) => {
        console.log('[MAIN] 收到暂停DLNA投屏请求');

        const deviceValidation = validateDeviceId(deviceId);
        if (!deviceValidation.valid) {
            return { success: false, error: deviceValidation.error };
        }

        try {
            return await qixingApp.pauseDLNACasting(deviceId);
        } catch (error) {
            console.error('[MAIN] 暂停DLNA投屏失败:', error);
            return { success: false, error: '暂停投屏失败' };
        }
    });

    // 跳转到指定位置
    ipcMain.handle('seek-dlna-casting', async (event, deviceId, position) => {
        console.log('[MAIN] 收到跳转到指定位置请求');

        const deviceValidation = validateDeviceId(deviceId);
        if (!deviceValidation.valid) {
            return { success: false, error: deviceValidation.error };
        }

        if (typeof position !== 'number' || isNaN(position) || position < 0) {
            return { success: false, error: '无效的位置参数' };
        }

        try {
            return await qixingApp.seekDLNACasting(deviceId, position);
        } catch (error) {
            console.error('[MAIN] 跳转DLNA投屏失败:', error);
            return { success: false, error: '跳转操作失败' };
        }
    });

    // 设置DLNA投屏音量
    ipcMain.handle('set-volume-dlna-casting', async (event, deviceId, volume) => {
        console.log('[MAIN] 收到设置DLNA投屏音量请求');

        const deviceValidation = validateDeviceId(deviceId);
        if (!deviceValidation.valid) {
            return { success: false, error: deviceValidation.error };
        }

        if (typeof volume !== 'number' || isNaN(volume) || volume < 0 || volume > 100) {
            return { success: false, error: '无效的音量值，必须在0-100之间' };
        }

        try {
            return await qixingApp.setVolumeDLNACasting(deviceId, volume);
        } catch (error) {
            console.error('[MAIN] 设置DLNA投屏音量失败:', error);
            return { success: false, error: '设置音量失败' };
        }
    });

    // 获取DLNA投屏位置信息
    ipcMain.handle('get-dlna-position-info', async (event, deviceId) => {
        console.log('[MAIN] 收到获取DLNA投屏位置信息请求');

        const deviceValidation = validateDeviceId(deviceId);
        if (!deviceValidation.valid) {
            return { success: false, error: deviceValidation.error };
        }

        try {
            return await qixingApp.getDLNAPositionInfo(deviceId);
        } catch (error) {
            console.error('[MAIN] 获取DLNA投屏位置信息失败:', error);
            return { success: false, error: '获取位置信息失败' };
        }
    });

    // 获取DLNA投屏传输状态
    ipcMain.handle('get-dlna-transport-info', async (event, deviceId) => {
        console.log('[MAIN] 收到获取DLNA投屏传输状态请求:', deviceId);
        // 安全检查：验证设备ID
        if (typeof deviceId !== 'string' || !deviceId) {
            return { success: false, error: '无效的设备ID' };
        }
        try {
            return await qixingApp.getDLNATransportInfo(deviceId);
        } catch (error) {
            console.error('[MAIN] 获取DLNA投屏传输状态失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 剪切板读取处理
    ipcMain.handle('read-clipboard', async event => {
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
            // 安全检查：验证输入类型
            if (typeof text !== 'string') {
                return false;
            }
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
        // 安全检查：验证日志级别
        const validLevels = ['error', 'warn', 'info', 'log', 'debug'];
        if (typeof level !== 'string' || !validLevels.includes(level)) {
            console.error(`[PLAYER-ERROR] 无效的日志级别: ${level}`);
            return false;
        }
        // 安全检查：验证日志消息
        if (typeof message !== 'string') {
            console.error('[PLAYER-ERROR] 无效的日志消息类型');
            return false;
        }
        const fullMessage = `[PLAYER-${level.toUpperCase()}] ${message}${args.length > 0 ? ` ${args.join(' ')}` : ''}`;

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
            if (qixingApp.mainWindow && !qixingApp.mainWindow.isDestroyed()) {
                qixingApp.mainWindow.webContents.send('episode-changed', updateData);
                console.log('[MAIN] 已转发集数更新通知到主窗口');
            }

            return { success: true };
        } catch (error) {
            console.error('[MAIN] 处理播放器集数变化通知失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 自动更新相关IPC处理
    // 检查更新
    ipcMain.handle('check-for-updates', async event => {
        console.log('[MAIN] 收到检查更新请求');
        try {
            return await qixingApp.checkForUpdates();
        } catch (error) {
            console.error('[MAIN] 检查更新失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 安装更新
    ipcMain.handle('install-update', async event => {
        console.log('[MAIN] 收到安装更新请求');
        try {
            qixingApp.installUpdate();
            return { success: true, message: '更新安装已启动' };
        } catch (error) {
            console.error('[MAIN] 安装更新失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 取消更新
    ipcMain.handle('cancel-update', async event => {
        console.log('[MAIN] 收到取消更新请求');
        try {
            qixingApp.cancelUpdate();
            return { success: true, message: '更新已取消' };
        } catch (error) {
            console.error('[MAIN] 取消更新失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 获取远程内容 - 用于TVBOX配置加载
    ipcMain.handle('fetch-remote-content', async (event, url) => {
        console.log('[MAIN] 收到获取远程内容请求:', url);
        try {
            // 安全检查：验证URL格式
            if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
                return { success: false, error: '无效的URL格式' };
            }

            const https = require('https');
            const http = require('http');
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;

            return new Promise((resolve, reject) => {
                const timeout = 15000;
                const timer = setTimeout(() => {
                    reject(new Error('请求超时'));
                }, timeout);

                const options = {
                    hostname: urlObj.hostname,
                    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                    path: urlObj.pathname + urlObj.search,
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/json, text/plain, */*',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'Connection': 'keep-alive'
                    }
                };

                const req = protocol.request(options, res => {
                    let data = '';
                    res.setEncoding('utf8');

                    res.on('data', chunk => {
                        data += chunk;
                    });

                    res.on('end', () => {
                        clearTimeout(timer);
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            console.log('[MAIN] 远程内容获取成功, 大小:', data.length);
                            resolve({ success: true, data, statusCode: res.statusCode });
                        } else {
                            console.error('[MAIN] 远程内容获取失败, 状态码:', res.statusCode);
                            resolve({ success: false, error: `HTTP错误: ${res.statusCode}`, statusCode: res.statusCode });
                        }
                    });
                });

                req.on('error', e => {
                    clearTimeout(timer);
                    console.error('[MAIN] 远程内容获取失败:', e.message);
                    resolve({ success: false, error: e.message });
                });

                req.end();
            });
        } catch (error) {
            console.error('[MAIN] 获取远程内容失败:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    setupIPC
};
