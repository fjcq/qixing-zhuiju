// Electron preload 脚本
const { contextBridge, ipcRenderer, shell, clipboard } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => {
            // 白名单安全的频道
            // 关键:'player-canplay' 必须在此白名单中
            // —— player.js 在 video canplay 时通过该 channel 通知主进程转发给主窗口,
            // 用于关闭下载页的磁力播放浮动条。漏了它会导致浮动条永远不自动关闭。
            const validChannels = [
                'open-player',
                'close-player',
                'player-progress',
                'player-canplay',
                'player-loaded',
                'window-close',
                'window-minimize',
                'window-maximize',
                'toggle-always-on-top',
                'start-system-casting',
                'stop-casting',
                'renderer-log'
            ];
            if (validChannels.includes(channel)) {
                ipcRenderer.send(channel, data);
            }
        },
        invoke: (channel, data) => {
            const validChannels = [
                'open-player',
                'close-player',
                'get-video-info',
                'get-app-version',
                'window-close',
                'window-minimize',
                'window-maximize',
                'window-set-title',
                'toggle-always-on-top',
                'open-external-url',
                'start-system-casting',
                'stop-casting',
                'discover-cast-devices',
                'cast-to-dlna-device',
                'stop-dlna-casting',
                'read-clipboard',
                'write-clipboard',
                'player-log',
                'player-episode-changed',
                'fetch-remote-content',
                'select-video-file',
                'handle-magnet-link',
                'play-magnet-file',
                'magnet-pause',
                'magnet-resume',
                'magnet-remove',
                'magnet-replay',
                // 下载管理相关
                'download-list',
                'download-list-active',
                'download-rename',
                'download-delete',
                'download-move',
                'download-reveal',
                'open-path',
                'download-start-url',
                'download-cancel-task',
                'download-list-folders',
                'download-import-local',
                'check-file-exists',
                'magnet-check-local',
                // Node.js 运行环境相关
                'get-runtime-environment',
                'refresh-runtime-environment',
                'open-portable-node-dir',
                'download-portable-node'
            ];
            if (validChannels.includes(channel)) {
                return ipcRenderer.invoke(channel, data);
            }
        },
        onMagnetProgress: callback => {
            ipcRenderer.on('magnet-progress', (event, data) => callback(data));
        },
        removeMagnetProgressListener: () => {
            ipcRenderer.removeAllListeners('magnet-progress');
        },
        onRuntimeEnvProgress: callback => {
            ipcRenderer.on('runtime-env-progress', (event, data) => callback(data));
        },
        removeRuntimeEnvProgressListener: () => {
            ipcRenderer.removeAllListeners('runtime-env-progress');
        },
        onPlayerLoaded: (callback) => {
            if (typeof callback !== 'function') return;
            ipcRenderer.on('player-loaded', (_event, data) => {
                try { callback(data); } catch (err) { console.error('player-loaded 回调异常:', err); }
            });
        },
        onPlayerCanplay: (callback) => {
            if (typeof callback !== 'function') return;
            ipcRenderer.on('player-canplay', (_event, data) => {
                try { callback(data); } catch (err) { console.error('player-canplay 回调异常:', err); }
            });
        },
        removePlayerLoadedListener: () => {
            ipcRenderer.removeAllListeners('player-loaded');
        },
        removePlayerCanplayListener: () => {
            ipcRenderer.removeAllListeners('player-canplay');
        },
        on: (channel, func) => {
            const validChannels = [
                'player-closed',
                'video-progress',
                'video-data',
                'episode-changed',
                'magnet-download-progress',
                'magnet-status',
                'download-task-progress'
            ];
            if (validChannels.includes(channel)) {
                const wrappedFunc = (event, ...args) => func(...args);
                // 保存映射关系，以便removeListener能正确移除
                if (!global._ipcListenerMap) {
                    global._ipcListenerMap = new Map();
                }
                const key = channel + '_' + func.toString().substring(0, 100);
                global._ipcListenerMap.set(key, { original: func, wrapped: wrappedFunc });
                ipcRenderer.on(channel, wrappedFunc);
            }
        },
        removeListener: (channel, func) => {
            const validChannels = [
                'player-closed',
                'video-progress',
                'video-data',
                'episode-changed',
                'magnet-download-progress',
                'magnet-status',
                'download-task-progress'
            ];
            if (validChannels.includes(channel)) {
                // 查找包装后的函数引用
                if (global._ipcListenerMap) {
                    for (const [key, { original, wrapped }] of global._ipcListenerMap) {
                        if (original === func && key.startsWith(channel + '_')) {
                            ipcRenderer.removeListener(channel, wrapped);
                            global._ipcListenerMap.delete(key);
                            return;
                        }
                    }
                }
                // 回退：直接尝试移除原始函数
                ipcRenderer.removeListener(channel, func);
            }
        }
    },
    shell: {
        openExternal: url => {
            // 验证URL是否安全
            if (url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
                return shell.openExternal(url);
            }
        }
    },
    // 窗口控制API
    window: {
        close: () => ipcRenderer.invoke('window-close'),
        minimize: () => ipcRenderer.invoke('window-minimize'),
        maximize: () => ipcRenderer.invoke('window-maximize'),
        toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
        setTitle: title => ipcRenderer.invoke('window-set-title', title)
    },
    // 剪切板API
    clipboard: {
        readText: () => ipcRenderer.invoke('read-clipboard'),
        writeText: text => ipcRenderer.invoke('write-clipboard', text)
    },
    // 播放器日志API - 发送到主进程cmd控制台
    playerLog: {
        info: (message, ...args) => ipcRenderer.invoke('player-log', 'info', message, ...args),
        warn: (message, ...args) => ipcRenderer.invoke('player-log', 'warn', message, ...args),
        error: (message, ...args) => ipcRenderer.invoke('player-log', 'error', message, ...args),
        debug: (message, ...args) => ipcRenderer.invoke('player-log', 'debug', message, ...args)
    },
    // 边下边播 streaming API（新增）- 直接调用 ipcRenderer.invoke，无需走白名单
    streaming: {
        // 启动任务
        // params: { source, savePath?, priority?, speedLimit?, autoPlay, mode? }
        // 返回: { success, taskId, playUrl? }
        start: (params) => ipcRenderer.invoke('streaming:start', params),
        // 暂停任务
        // 返回: { success }
        pause: (taskId) => ipcRenderer.invoke('streaming:pause', { taskId }),
        // 恢复任务
        // 返回: { success }
        resume: (taskId) => ipcRenderer.invoke('streaming:resume', { taskId }),
        // 取消任务（removeFiles=true 时删除已下载文件）
        // 返回: { success }
        cancel: (taskId, removeFiles = false) => ipcRenderer.invoke('streaming:cancel', { taskId, removeFiles }),
        // 设置任务优先级（priority ∈ {'high','normal','low'}）
        // 返回: { success }
        setPriority: (taskId, priority) => ipcRenderer.invoke('streaming:setPriority', { taskId, priority }),
        // 设置限速（taskId 为 null 时设置全局限速）
        // 返回: { success }
        setSpeedLimit: (bytesPerSec, taskId = null) => ipcRenderer.invoke('streaming:setSpeedLimit', { taskId, bytesPerSec }),
        // 列出任务（filter: { status?, sourceType? }）
        // 返回: { success, tasks[] }
        listTasks: (filter = {}) => ipcRenderer.invoke('streaming:listTasks', filter),
        // 获取单个任务详情
        // 返回: { success, task }
        getTask: (taskId) => ipcRenderer.invoke('streaming:getTask', { taskId }),
        // 触发完整性校验
        // 返回: { success, integrity }
        verify: (taskId) => ipcRenderer.invoke('streaming:verify', { taskId }),
        // 设置下载根目录（migrate=true 时迁移现有文件）
        // 返回: { success, migrated }
        setStoragePath: (downloadPath, migrate = false) => ipcRenderer.invoke('streaming:setStoragePath', { path: downloadPath, migrate }),
        // 查询磁盘空间与当前下载路径
        // 返回: { success, total, free, used, downloadPath }
        getStorageInfo: () => ipcRenderer.invoke('streaming:getStorageInfo'),
        // 清理 N 天前的已完成任务
        // 返回: { success, removed }
        cleanup: (beforeDays) => ipcRenderer.invoke('streaming:cleanup', { beforeDays }),
        // 手动重试失败任务
        // 返回: { success }
        retry: (taskId) => ipcRenderer.invoke('streaming:retry', { taskId }),
        // 订阅 streaming 事件，返回取消订阅函数
        // eventName 必须在白名单内，callback 必须为函数
        on: (eventName, callback) => {
            const validEvents = [
                'streaming:progress',
                'streaming:state-change',
                'streaming:prebuffer',
                'streaming:integrity',
                'streaming:error',
                'streaming:queue-changed',
                'streaming:retry',
                'streaming:completed'
            ];
            if (!validEvents.includes(eventName)) {
                console.warn(`[preload] unknown streaming event: ${eventName}`);
                return () => {};
            }
            if (typeof callback !== 'function') {
                console.warn('[preload] streaming.on callback must be a function');
                return () => {};
            }
            const handler = (event, payload) => callback(payload);
            ipcRenderer.on(eventName, handler);
            // 返回取消订阅函数
            return () => {
                ipcRenderer.removeListener(eventName, handler);
            };
        }
    }
});

// 暴露电子API
contextBridge.exposeInMainWorld('electronAPI', {
    openExternal: async url => {
        console.log('[PRELOAD] 尝试通过IPC打开外部链接:', url);
        try {
            // 使用IPC通信而不是直接调用shell
            const result = await ipcRenderer.invoke('open-external-url', url);
            console.log('[PRELOAD] IPC外部链接打开结果:', result);
            return result;
        } catch (error) {
            console.error('[PRELOAD] IPC外部链接打开失败:', error);
            return { success: false, error: error.message };
        }
    },
    // 获取远程内容 - 用于TVBOX配置加载
    fetchRemoteContent: async url => {
        console.log('[PRELOAD] 尝试获取远程内容:', url);
        try {
            const result = await ipcRenderer.invoke('fetch-remote-content', url);
            console.log('[PRELOAD] 远程内容获取结果:', result ? '成功' : '失败');
            return result;
        } catch (error) {
            console.error('[PRELOAD] 远程内容获取失败:', error);
            return { success: false, error: error.message };
        }
    }
});
