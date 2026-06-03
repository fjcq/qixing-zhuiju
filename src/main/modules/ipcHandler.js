const { ipcMain, BrowserWindow, app } = require('electron');
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
            // 清理磁力链子进程资源
            cleanupMagnetProcess();
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

    // 选择视频文件
    ipcMain.handle('select-video-file', async event => {
        console.log('[MAIN] 收到选择视频文件请求');
        try {
            const { dialog } = require('electron');

            const result = await dialog.showOpenDialog({
                title: '选择视频文件',
                filters: [
                    { name: '视频文件', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm3u8', 'flv', 'wmv'] },
                    { name: '所有文件', extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, message: '未选择文件' };
            }

            const filePath = result.filePaths[0];
            console.log('[MAIN] 选择的文件:', filePath);

            return { success: true, filePath };
        } catch (error) {
            console.error('[MAIN] 选择视频文件失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 磁力链子进程管理器
    let magnetProcess = null;
    let magnetMessageId = 0;
    const magnetPendingRequests = new Map(); // id -> { resolve, reject, timeout }

    /**
     * 启动磁力链子进程
     * 使用系统Node.js运行ESM脚本，NODE_PATH指向magnet-runtime目录
     */
    function startMagnetProcess() {
        if (magnetProcess && !magnetProcess.killed) {
            return magnetProcess;
        }

        const { spawn } = require('child_process');
        const path = require('path');

        // 使用系统Node.js运行磁力链处理脚本（ESM模块，.mjs扩展名）
        const scriptPath = path.join(__dirname, '..', 'scripts', 'magnetHandler.mjs');

        // magnet-runtime目录：开发环境在项目根目录，打包后在resources目录
        let magnetRuntimeDir;
        if (app.isPackaged) {
            // 打包后：extraResources放在resources/magnet-runtime
            magnetRuntimeDir = path.join(process.resourcesPath, 'magnet-runtime');
        } else {
            // 开发环境：项目根目录/magnet-runtime
            magnetRuntimeDir = path.join(__dirname, '..', '..', '..', 'magnet-runtime');
        }
        const nodeModulesPath = path.join(magnetRuntimeDir, 'node_modules');
        console.log('[MAIN] 启动磁力链子进程, 脚本:', scriptPath);
        console.log('[MAIN] NODE_PATH:', nodeModulesPath);

        magnetProcess = spawn('node', [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                NODE_PATH: nodeModulesPath,
                ELECTRON_RUN_AS_NODE: ''
            }
        });

        // 处理stdout消息
        let buffer = '';
        magnetProcess.stdout.on('data', data => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 保留不完整的行

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    handleMagnetMessage(msg);
                } catch (err) {
                    console.log('[MAIN] 磁力链子进程输出:', line);
                }
            }
        });

        // 处理stderr日志
        magnetProcess.stderr.on('data', data => {
            console.log('[MAIN] 磁力链子进程日志:', data.toString().trim());
        });

        magnetProcess.on('error', err => {
            console.error('[MAIN] 磁力链子进程启动失败:', err.message);
            magnetProcess = null;
        });

        magnetProcess.on('exit', (code, signal) => {
            console.log('[MAIN] 磁力链子进程退出, code:', code, 'signal:', signal);
            magnetProcess = null;
        });

        return magnetProcess;
    }

    /**
     * 清理磁力链子进程资源
     * 在关闭播放器或应用退出时调用
     */
    function cleanupMagnetProcess() {
        if (magnetProcess && !magnetProcess.killed) {
            try {
                // 发送destroy命令让子进程优雅关闭
                magnetProcess.stdin.write(JSON.stringify({ action: 'destroy' }) + '\n');
                // 给子进程1秒时间清理，然后强制退出
                setTimeout(() => {
                    if (magnetProcess && !magnetProcess.killed) {
                        magnetProcess.kill();
                        magnetProcess = null;
                    }
                }, 1000);
            } catch (err) {
                magnetProcess.kill();
                magnetProcess = null;
            }
        }
        // 清理所有pending请求
        for (const [id, pending] of magnetPendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('播放器已关闭'));
        }
        magnetPendingRequests.clear();
    }

    /**
     * 发送消息到磁力链子进程并等待响应
     */
    function sendMagnetMessage(msg) {
        return new Promise((resolve, reject) => {
            const proc = startMagnetProcess();
            if (!proc) {
                reject(new Error('无法启动磁力链子进程'));
                return;
            }

            const id = ++magnetMessageId;
            msg.id = id;

            const timeout = setTimeout(() => {
                magnetPendingRequests.delete(id);
                reject(new Error('磁力链处理超时'));
            }, 120000); // 2分钟超时

            magnetPendingRequests.set(id, { resolve, reject, timeout });
            proc.stdin.write(JSON.stringify(msg) + '\n');
        });
    }

    /**
     * 处理磁力链子进程的消息
     */
    function handleMagnetMessage(msg) {
        // 日志消息直接输出
        if (msg.type === 'log') {
            console.log('[MAIN] [MAGNET]', msg.message);
            return;
        }

        if (msg.type === 'wire') {
            console.log('[MAIN] [MAGNET] wire连接:', msg.address);
            return;
        }

        if (msg.type === 'warning') {
            console.warn('[MAIN] [MAGNET] 警告:', msg.message);
            return;
        }

        if (msg.type === 'progress') {
            // 转发下载进度到渲染进程
            if (qixingApp.mainWindow && !qixingApp.mainWindow.isDestroyed()) {
                qixingApp.mainWindow.webContents.send('magnet-download-progress', {
                    fileName: msg.fileName,
                    progress: msg.progress,
                    downloaded: msg.downloaded,
                    total: msg.total,
                    wires: msg.wires,
                    downloadSpeed: msg.downloadSpeed,
                    status: msg.progress >= 100 ? 'completed' : 'downloading'
                });
            }
            return;
        }

        if (msg.type === 'done') {
            console.log('[MAIN] [MAGNET] 下载完成');
            return;
        }

        if (msg.type === 'destroyed') {
            console.log('[MAIN] [MAGNET] 子进程资源已释放');
            return;
        }

        // 带id的响应消息，匹配到pending request
        if (msg.id && magnetPendingRequests.has(msg.id)) {
            const pending = magnetPendingRequests.get(msg.id);
            clearTimeout(pending.timeout);
            magnetPendingRequests.delete(msg.id);

            if (msg.type === 'error') {
                pending.reject(new Error(msg.error));
            } else {
                pending.resolve(msg);
            }
            return;
        }

        // 没有id的消息（如子进程启动通知）
        if (msg.type === 'ready' && msg.message) {
            console.log('[MAIN] [MAGNET]', msg.message);
            return;
        }

        console.log('[MAIN] [MAGNET] 未处理消息:', msg.type);
    }

    // 处理磁力链接
    ipcMain.handle('handle-magnet-link', async (event, magnetUri) => {
        console.log('[MAIN] 收到磁力链接处理请求:', magnetUri);
        try {
            // 验证磁力链接格式（支持标准格式和纯info hash）
            if (typeof magnetUri !== 'string') {
                return { success: false, error: '无效的磁力链接格式' };
            }

            // 如果不是magnet:开头，检查是否为纯info hash
            let normalizedUri = magnetUri;
            let infoHash = '';
            if (!magnetUri.startsWith('magnet:')) {
                // 检查是否为40字符十六进制或32字符base32
                if (/^[a-fA-F0-9]{40}$/i.test(magnetUri)) {
                    infoHash = magnetUri.toLowerCase();
                    normalizedUri = `magnet:?xt=urn:btih:${magnetUri}`;
                    console.log('[MAIN] 纯info hash转换为磁力链接:', normalizedUri);
                } else if (/^[A-Z2-7]{32}$/i.test(magnetUri)) {
                    normalizedUri = `magnet:?xt=urn:btih:${magnetUri}`;
                    console.log('[MAIN] Base32 info hash转换为磁力链接:', normalizedUri);
                } else {
                    return { success: false, error: '无效的磁力链接格式' };
                }
            }

            // 从磁力链接中提取infoHash
            if (!infoHash) {
                const hashMatch = normalizedUri.match(/btih:([a-fA-F0-9]{40})/i);
                if (hashMatch) {
                    infoHash = hashMatch[1].toLowerCase();
                }
            }

            // 发送进度到渲染进程
            event.sender.send('magnet-progress', {
                status: '正在解析磁力链接...',
                progress: 0
            });

            // 使用子进程（系统Node.js + webtorrent v3.x）解析磁力链接
            const result = await sendMagnetMessage({
                action: 'resolve',
                magnetUri: normalizedUri,
                infoHash
            });

            if (result.type === 'files') {
                console.log('[MAIN] 磁力链接解析成功, 文件数:', result.files.length);
                return { success: true, files: result.files, infoHash };
            } else {
                return { success: false, error: result.error || '解析失败' };
            }
        } catch (error) {
            console.error('[MAIN] 处理磁力链接失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 播放磁力链接中的文件
    ipcMain.handle('play-magnet-file', async (event, { magnetUri, fileName, infoHash }) => {
        console.log('[MAIN] 收到播放磁力文件请求:', fileName, 'infoHash:', infoHash);
        try {
            // 发送初始进度
            event.sender.send('magnet-download-progress', {
                fileName,
                progress: 0,
                downloaded: 0,
                total: 0,
                wires: 0,
                downloadSpeed: 0,
                status: 'connecting'
            });

            // 使用子进程播放磁力文件
            // 查找resolve阶段子进程已缓存的torrent文件路径，避免重复获取
            let cachedTorrentPath = null;
            const os = require('os');
            const path = require('path');
            const fs = require('fs');
            const torrentCachePath = path.join(os.tmpdir(), 'qixing-torrents', `${infoHash}.torrent`);
            if (fs.existsSync(torrentCachePath)) {
                cachedTorrentPath = torrentCachePath;
            }

            const result = await sendMagnetMessage({
                action: 'play',
                magnetUri,
                fileName,
                infoHash,
                cachedTorrentPath: cachedTorrentPath || undefined
            });

            if (result.type === 'ready') {
                console.log('[MAIN] 磁力文件流URL:', result.streamUrl, 'isLocal:', result.isLocal);
                return {
                    success: true,
                    streamUrl: result.streamUrl,
                    isLocal: result.isLocal || false
                };
            } else {
                return { success: false, error: result.error || '播放失败' };
            }
        } catch (error) {
            console.error('[MAIN] 播放磁力文件失败:', error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = {
    setupIPC
};
