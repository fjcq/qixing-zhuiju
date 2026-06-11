const { ipcMain, BrowserWindow, app } = require('electron');
const fs = require('fs');
const path = require('path');
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
    // 磁力链原始 URI 缓存（key: infoHash, value: 原始 magnetUri）
    // 关键：子进程首次上报 magnet-status 时只回传 infoHash/fileName，没有原始 magnetUri
    // 但 manifest 记录需要 magnetUri（"继续"按钮的回退路径 magnet-replay 必须用到）
    // 这里在用户首次提交磁力链时（play-magnet-file / magnet-replay 入口）缓存，
    // 子进程状态上报时回填到 manifest —— 解决"有 infoHash 但无 magnetUri 无法续传"的问题
    const magnetUriCache = new Map();
    const rememberMagnetUri = (infoHash, magnetUri) => {
        if (infoHash && magnetUri && magnetUri.startsWith('magnet:')) {
            magnetUriCache.set(String(infoHash).toLowerCase(), magnetUri);
        }
    };
    const getMagnetUri = (infoHash) => {
        if (!infoHash) return '';
        return magnetUriCache.get(String(infoHash).toLowerCase()) || '';
    };

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
    // 关键：不再调 cleanupMagnetProcess()，关闭播放器 ≠ 停止后台下载
    // 现在有专门的下载管理页，下载状态由该页维护，子进程应常驻供续传/并行下载使用
    // 子进程的生命周期仅在「应用退出」时结束（见 app.on('before-quit')）
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

    // 校验文件是否存在（用于下载页面"播放"前先确认文件还在）
    // 入参: filePath 绝对路径
    // 返回: { exists: boolean, size?: number }
    ipcMain.handle('check-file-exists', async (event, filePath) => {
        try {
            if (!filePath || typeof filePath !== 'string') {
                return { exists: false };
            }
            if (!fs.existsSync(filePath)) {
                return { exists: false };
            }
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) {
                return { exists: false };
            }
            return { exists: true, size: stat.size };
        } catch (error) {
            return { exists: false };
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

    // ========== 下载管理 IPC ==========
    const dm = qixingApp.downloadManager;

    // 列出已下载文件
    ipcMain.handle('download-list', async (event, options) => {
        try {
            const list = dm.listFiles(options || {});
            // 把绝对路径和下载根目录也返回，方便前端展示
            return { success: true, list, rootDir: dm.getDownloadDir() };
        } catch (error) {
            console.error('[MAIN] 列出下载文件失败:', error);
            return { success: false, error: error.message, list: [] };
        }
    });

    // 列出活动下载任务
    ipcMain.handle('download-list-active', async () => {
        try {
            return { success: true, tasks: dm.listActiveTasks() };
        } catch (error) {
            return { success: false, error: error.message, tasks: [] };
        }
    });

    // 重命名
    ipcMain.handle('download-rename', async (event, { id, newName }) => {
        try {
            return dm.renameFile(id, newName);
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 删除
    ipcMain.handle('download-delete', async (event, { id }) => {
        try {
            return dm.deleteFile(id);
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 移动到子目录
    ipcMain.handle('download-move', async (event, { id, subDir }) => {
        try {
            return dm.moveFile(id, subDir);
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 打开文件所在目录
    ipcMain.handle('download-reveal', async (event, { id }) => {
        try {
            return dm.revealInFolder(id);
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 打开任意路径（用于"打开下载目录"按钮直接打开 rootDir）
    ipcMain.handle('open-path', async (event, { path: targetPath }) => {
        try {
            if (!targetPath || typeof targetPath !== 'string') {
                return { success: false, error: '无效的路径' };
            }
            if (!fs.existsSync(targetPath)) {
                return { success: false, error: '路径不存在: ' + targetPath };
            }
            // shell.openPath 第二个参数是错误字符串（空字符串表示成功）
            const errMsg = await require('electron').shell.openPath(targetPath);
            if (errMsg) {
                return { success: false, error: errMsg };
            }
            return { success: true, path: targetPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 启动 URL 下载任务
    ipcMain.handle('download-start-url', async (event, opts) => {
        try {
            return dm.startUrlDownload(opts || {});
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 取消下载任务
    ipcMain.handle('download-cancel-task', async (event, { taskId }) => {
        try {
            return dm.cancelTask(taskId);
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 列出子目录
    ipcMain.handle('download-list-folders', async () => {
        try {
            return { success: true, folders: dm.listFolders() };
        } catch (error) {
            return { success: false, error: error.message, folders: [] };
        }
    });

    // 选择本地视频文件并导入到下载管理
    ipcMain.handle('download-import-local', async event => {
        try {
            const { dialog } = require('electron');
            const result = await dialog.showOpenDialog({
                title: '导入本地视频',
                filters: [{ name: '视频文件', extensions: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm3u8', 'flv', 'wmv'] }],
                properties: ['openFile', 'multiSelections']
            });
            if (result.canceled || result.filePaths.length === 0) {
                return { success: false, message: '未选择文件' };
            }
            const imported = [];
            for (const fp of result.filePaths) {
                // 不复制文件，只在清单中添加一条记录指向原路径
                const r = dm.addExistingFile({
                    name: require('path').basename(fp),
                    filePath: fp,
                    sourceType: 'import'
                });
                if (r.success) imported.push(r.record);
            }
            return { success: true, imported };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
    // ========== 下载管理 IPC END ==========

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

        // 脚本路径：打包后在resources/magnet-scripts，开发环境在src/main/scripts
        let scriptPath;
        if (app.isPackaged) {
            scriptPath = path.join(process.resourcesPath, 'magnet-scripts', 'magnetHandler.mjs');
        } else {
            scriptPath = path.join(__dirname, '..', 'scripts', 'magnetHandler.mjs');
        }

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

        // 启动后立即发送 init 消息，告知子进程把磁力文件存到我们应用的下载目录
        // 这样磁力下载的文件才能纳入「下载」页统一管理，并支持断点续传
        try {
            const initMsg = JSON.stringify({
                action: 'init',
                magnetDir: qixingApp.downloadManager.getMagnetDir()
            }) + '\n';
            magnetProcess.stdin.write(initMsg);
            console.log('[MAIN] 已向磁力子进程发送 init 消息, magnetDir:', qixingApp.downloadManager.getMagnetDir());
        } catch (err) {
            console.error('[MAIN] 发送 init 消息失败:', err.message);
        }

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
                    console.log('[MAIN] 磁力链子进程输出(非JSON):', line.substring(0, 200));
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
     * 使用局部 proc 变量 + 立即置空全局引用的方式实现可重入：
     * 多次调用不会重复写 stdin 也不会重复 schedule kill
     */
    function cleanupMagnetProcess() {
        // 立即取出引用并清空全局变量，避免重入时重复处理同一个进程
        const proc = magnetProcess;
        magnetProcess = null;

        if (proc && !proc.killed) {
            try {
                // 发送destroy命令让子进程优雅关闭
                proc.stdin.write(JSON.stringify({ action: 'destroy' }) + '\n');
                // 给子进程1秒时间清理，然后强制退出
                setTimeout(() => {
                    if (!proc.killed) {
                        proc.kill();
                    }
                }, 1000);
            } catch (err) {
                proc.kill();
            }
        }
        // 清理所有pending请求
        for (const [id, pending] of magnetPendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('播放器已关闭'));
        }
        magnetPendingRequests.clear();
    }

    // 暴露到 qixingApp 实例，供 windowManager 等其他模块在窗口关闭时调用
    qixingApp.cleanupMagnetProcess = cleanupMagnetProcess;

    // ========== 应用退出时的资源清理 ==========
    // 关键：磁力子进程在播放器关闭时不应被杀（用户可能仍在后台下载），
    // 但应用退出时必须优雅结束，否则会留下僵尸子进程
    // 用 once 避免重入（多次 quit 事件触发）
    app.once('before-quit', () => {
        console.log('[MAIN] 应用退出，清理磁力链子进程');
        cleanupMagnetProcess();
    });

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
        // 日志消息：主进程控制台输出 + 转发为 magnet-progress 事件到主窗口
        // 解决 resolve 阶段 60s 阻塞等待期间，渲染端进度区一直卡在 0% 的问题
        if (msg.type === 'log') {
            console.log('[MAIN] [MAGNET]', msg.message);
            if (qixingApp.mainWindow && !qixingApp.mainWindow.isDestroyed()) {
                qixingApp.mainWindow.webContents.send('magnet-progress', {
                    status: msg.message,
                    progress: 0,
                    source: 'log',
                    timestamp: Date.now()
                });
            }
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
            // 构建进度数据（保留原始status和numPeers字段）
            const progressData = {
                fileName: msg.fileName,
                progress: msg.progress,
                downloaded: msg.downloaded,
                total: msg.total,
                wires: msg.wires,
                downloadSpeed: msg.downloadSpeed,
                numPeers: msg.numPeers,
                // 透传 ETA 字段（子进程 calcEta 计算），允许 null
                eta: typeof msg.eta === 'number' ? msg.eta : null,
                status: msg.status || (msg.progress >= 100 ? 'completed' : 'downloading')
            };
            // 转发下载进度到主窗口
            if (qixingApp.mainWindow && !qixingApp.mainWindow.isDestroyed()) {
                qixingApp.mainWindow.webContents.send('magnet-download-progress', progressData);
            }
            // 同时转发到播放器窗口
            if (qixingApp.playerWindow && !qixingApp.playerWindow.isDestroyed()) {
                qixingApp.playerWindow.webContents.send('magnet-download-progress', progressData);
            }
            // 透传 infoHash（子进程若带上）：把"下载速度/ETA/peer 数"等增量信息合并到 magnet-status 事件
            // 让下载页能实时刷新这些数字（_handleMagnetStatus 已支持 downloadSpeed/numPeers/eta 字段）
            if (msg.infoHash) {
                const dmInner = qixingApp.downloadManager;
                const matched = dmInner.manifest.find(m =>
                    m.sourceType === 'magnet' && m.infoHash === msg.infoHash &&
                    (!msg.fileName || m.name === msg.fileName)
                );
                if (matched) {
                    const statusPayload = {
                        infoHash: msg.infoHash,
                        fileName: msg.fileName,
                        downloaded: msg.downloaded,
                        total: msg.total,
                        progress: msg.progress,
                        // 关键：使用 manifest 的 user-controlled status（paused/downloading/completed），
                        // 而不是子进程发来的 peer-state status（no-peers/connected-waiting/downloading）
                        // 否则用户暂停后，子进程 setInterval 持续发 'downloading' 会把 'paused' 状态覆盖
                        // 导致下载页暂停按钮闪一下又恢复
                        status: matched.status || 'downloading',
                        downloadSpeed: msg.downloadSpeed,
                        numPeers: msg.numPeers,
                        wires: msg.wires,
                        eta: progressData.eta,
                        timestamp: Date.now()
                    };
                    for (const win of BrowserWindow.getAllWindows()) {
                        if (win && !win.isDestroyed()) {
                            win.webContents.send('magnet-status', statusPayload);
                        }
                    }
                }
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

        // 磁力链状态变化（用于实时同步到「下载」页清单）
        // 由子进程在开始下载/进度上报/暂停/完成/错误时发送
        if (msg.type === 'magnet-status') {
            const dm = qixingApp.downloadManager;
            // 1) 找到/创建清单记录
            let item = dm.manifest.find(m => m.sourceType === 'magnet' && m.infoHash === msg.infoHash);
            // 关键：子进程首次上报时不带 magnetUri，缓存里取（用户在播放页提交时已记住）
            // 否则创建的记录 sourceUrl 为空，"继续"按钮的回退路径 magnet-replay 会失败
            const cachedMagnetUri = getMagnetUri(msg.infoHash);
            if (msg.status !== 'removed' && !item && msg.fileName) {
                // 首次上报：自动创建清单记录
                const expectedPath = require('path').join(dm.getMagnetPath(msg.infoHash), msg.fileName);
                const r = dm.addMagnetFile({
                    name: msg.fileName,
                    filePath: expectedPath,
                    magnetUri: cachedMagnetUri, // 回填缓存的 magnetUri
                    infoHash: msg.infoHash,
                    totalSize: msg.total || 0,
                    downloaded: msg.downloaded || 0,
                    status: msg.status
                });
                if (r.success) item = r.record;
            } else if (item && cachedMagnetUri && !item.sourceUrl) {
                // 旧记录 sourceUrl 为空（例如历史 manifest 缺失）→ 补全
                item.sourceUrl = cachedMagnetUri;
                dm.flushMagnet(item);
            }
            // 2) 根据状态做对应处理
            if (msg.status === 'removed' && item) {
                dm.removeMagnetFile(item.id, { removeFiles: true, removeDir: true });
            } else if (item) {
                if (msg.status === 'paused') {
                    // 暂停时刷新为磁盘上实际已下载的大小
                    dm.refreshMagnetSize(item.id);
                    item.status = 'paused';
                    dm.flushMagnet(item);
                } else if (msg.status === 'completed' || msg.status === 'error') {
                    dm.updateMagnetProgress(msg.infoHash, msg.fileName, {
                        downloaded: msg.downloaded,
                        total: msg.total,
                        status: msg.status
                    });
                    const refreshed = dm.manifest.find(m => m.id === item.id);
                    if (refreshed) dm.flushMagnet(refreshed);
                } else {
                    // downloading 等：节流更新进度
                    dm.updateMagnetProgress(msg.infoHash, msg.fileName, {
                        downloaded: msg.downloaded,
                        total: msg.total,
                        status: msg.status
                    });
                }
            }
            // 3) 转发到所有渲染窗口（主窗口 + 播放器窗口）
            const payload = { ...msg, timestamp: Date.now() };
            for (const win of BrowserWindow.getAllWindows()) {
                if (win && !win.isDestroyed()) {
                    win.webContents.send('magnet-status', payload);
                }
            }
            return;
        }

        // 带id的响应消息，匹配到pending request
        if (msg.id && magnetPendingRequests.has(msg.id)) {
            const pending = magnetPendingRequests.get(msg.id);
            clearTimeout(pending.timeout);
            magnetPendingRequests.delete(msg.id);

            // 业务级"软错误"（type: 'error'）也走 resolve 而非 reject，
            // 避免 reject 时把 msg 序列化成 Error 后只丢出 error.message、**code 字段被吃掉**。
            // 原来 pause/resume 因此误把 TORRENT_NOT_FOUND 当作"真错误"提示给用户
            // —— 现在保留完整 msg（含 code），渲染端可正确区分"软错误"和"真异常"。
            // 真异常（进程启动失败、超时等）由外层 try/catch 处理
            pending.resolve(msg);
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
            // 缓存原始 magnetUri（用于后续 magnet-replay 断点续传）
            rememberMagnetUri(infoHash, magnetUri);
            // 发送初始进度
            const initialProgress = {
                fileName,
                progress: 0,
                downloaded: 0,
                total: 0,
                wires: 0,
                downloadSpeed: 0,
                numPeers: 0,
                status: 'connecting'
            };
            event.sender.send('magnet-download-progress', initialProgress);
            // 同时发送到播放器窗口
            if (qixingApp.playerWindow && !qixingApp.playerWindow.isDestroyed()) {
                qixingApp.playerWindow.webContents.send('magnet-download-progress', initialProgress);
            } else {
                console.log('[MAIN] 播放器窗口尚未创建，稍后重试发送初始进度');
                // 延迟 500ms 再次尝试，应对播放器窗口创建慢的情况
                setTimeout(() => {
                    if (qixingApp.playerWindow && !qixingApp.playerWindow.isDestroyed()) {
                        qixingApp.playerWindow.webContents.send('magnet-download-progress', {
                            ...initialProgress,
                            status: 'reconnected'
                        });
                        console.log('[MAIN] 延迟重试：初始进度已发送至播放器窗口');
                    }
                }, 500);
                // 再延迟 2s 尝试
                setTimeout(() => {
                    if (qixingApp.playerWindow && !qixingApp.playerWindow.isDestroyed()) {
                        qixingApp.playerWindow.webContents.send('magnet-download-progress', {
                            ...initialProgress,
                            status: 'reconnected-late'
                        });
                        console.log('[MAIN] 第二次延迟重试：进度已发送至播放器窗口');
                    }
                }, 2000);
            }

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

    // ========== 磁力下载管理 IPC（用于下载页面的暂停/继续/删除控制） ==========

    // 暂停指定 infoHash 的磁力下载
    // 入参: { infoHash, fileName } —— 必传，子进程用 infoHash 找到对应 torrent；
    //       不传则按 currentTorrent 处理（兼容旧调用方）
    // 返回: { type: 'paused' | 'error', error?: string, code?: 'TORRENT_NOT_FOUND' }
    //       code=TORRENT_NOT_FOUND 表示子进程没有这个 torrent（多见于播放器关闭后子进程被销毁），
    //       渲染端收到此码应将文件状态直接置为 paused（磁力下载此时实际上已经停了）
    ipcMain.handle('magnet-pause', async (event, payload = {}) => {
        try {
            return await sendMagnetMessage({
                action: 'pause',
                infoHash: payload.infoHash || '',
                fileName: payload.fileName || ''
            });
        } catch (error) {
            return { type: 'error', error: error.message };
        }
    });

    // 继续指定 infoHash 的磁力下载
    // 入参: { infoHash, fileName } —— 同上
    // 返回: { type: 'resumed' | 'error', code?: 'TORRENT_NOT_FOUND' }
    //       code=TORRENT_NOT_FOUND 表示子进程没有这个 torrent，渲染端应回退到 magnet-replay 重新启动
    ipcMain.handle('magnet-resume', async (event, payload = {}) => {
        try {
            return await sendMagnetMessage({
                action: 'resume',
                infoHash: payload.infoHash || '',
                fileName: payload.fileName || ''
            });
        } catch (error) {
            return { type: 'error', error: error.message };
        }
    });

    // 直接更新 manifest 中某条磁力记录的状态（用于子进程已销毁场景：
    // 用户点暂停时磁力下载其实已经停了，UI 需要把状态切回 paused 让用户感知）
    // 入参: { id, status } —— id 是 manifest 条目的 id，status 是 'paused' / 'downloading' / 'error' 等
    ipcMain.handle('magnet-set-status', async (event, payload = {}) => {
        try {
            const dmLocal = qixingApp.downloadManager;
            const item = dmLocal.manifest.find(m => m.id === payload.id);
            if (!item) return { success: false, error: '记录不存在' };
            if (payload.status) item.status = payload.status;
            item.mtime = Date.now();
            // 关键状态切换立即刷盘
            dmLocal.flushMagnet(item);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // 删除磁力下载（销毁 torrent + 清理磁盘 + 从清单移除）
    // 入参: { infoHash?, fileName? } —— 传 infoHash 可精确删除指定 torrent（不一定是 currentTorrent）
    // 不传则删除 currentTorrent（兼容旧调用方）
    ipcMain.handle('magnet-remove', async (event, payload = {}) => {
        try {
            return await sendMagnetMessage({
                action: 'remove',
                infoHash: payload.infoHash || '',
                fileName: payload.fileName || ''
            });
        } catch (error) {
            return { type: 'error', error: error.message };
        }
    });

    // 重新启动一个磁力下载（用于从下载页"继续"未完成的）
    // 复用现有 play 通道，但额外把记录预先登记到 manifest
    ipcMain.handle('magnet-replay', async (event, { magnetUri, fileName, infoHash }) => {
        console.log('[MAIN] 收到继续磁力下载请求:', fileName, 'infoHash:', infoHash);
        try {
            // 缓存 magnetUri（replay 入口可能传入新的 magnetUri，覆盖旧的）
            rememberMagnetUri(infoHash, magnetUri);
            // 1) 预先登记到 manifest（让用户立刻能在下载页看到记录）
            if (infoHash && fileName) {
                const dm = qixingApp.downloadManager;
                const expectedPath = require('path').join(dm.getMagnetPath(infoHash), fileName);
                dm.addMagnetFile({
                    name: fileName,
                    filePath: expectedPath,
                    magnetUri: magnetUri || '',
                    infoHash,
                    totalSize: 0,
                    downloaded: 0,
                    status: 'downloading'
                });
            }
            // 2) 调用子进程 play（从断点恢复：path 选项相同，自动复用已下载部分）
            const result = await sendMagnetMessage({
                action: 'play',
                magnetUri,
                fileName,
                infoHash
            });
            if (result.type === 'ready') {
                return {
                    success: true,
                    streamUrl: result.streamUrl,
                    isLocal: result.isLocal || false
                };
            } else {
                return { success: false, error: result.error || '恢复失败' };
            }
        } catch (error) {
            console.error('[MAIN] 继续磁力下载失败:', error);
            return { success: false, error: error.message };
        }
    });

    // ========== 旧缓存迁移 IPC（已移除：不需要迁移功能） ==========
}

module.exports = {
    setupIPC
};
