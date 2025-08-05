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
                'toggle-always-on-top',
                'open-external-url',
                'start-system-casting',
                'stop-casting',
                'discover-cast-devices',
                'read-clipboard',
                'write-clipboard'
            ];
            if (validChannels.includes(channel)) {
                return ipcRenderer.invoke(channel, data);
            }
        },
        on: (channel, func) => {
            const validChannels = [
                'player-closed',
                'video-progress',
                'video-data'
            ];
            if (validChannels.includes(channel)) {
                ipcRenderer.on(channel, (event, ...args) => func(...args));
            }
        }
    },
    shell: {
        openExternal: (url) => {
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
        toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top')
    },
    // 剪切板API
    clipboard: {
        readText: () => ipcRenderer.invoke('read-clipboard'),
        writeText: (text) => ipcRenderer.invoke('write-clipboard', text)
    }
});

// 暴露电子API
contextBridge.exposeInMainWorld('electronAPI', {
    openExternal: async (url) => {
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
    }
});
