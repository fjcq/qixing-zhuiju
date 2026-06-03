// Electron preload 脚本
const { contextBridge, ipcRenderer, shell, clipboard } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => {
            // 白名单安全的频道
            const validChannels = ['open-player', 'close-player', 'player-progress', 'window-close', 'window-minimize', 'window-maximize', 'toggle-always-on-top', 'start-system-casting', 'stop-casting'];
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
                'play-magnet-file'
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
        on: (channel, func) => {
            const validChannels = [
                'player-closed',
                'video-progress',
                'video-data',
                'episode-changed',
                'magnet-download-progress'
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
                'magnet-download-progress'
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
