// Electron preload 脚本
const { contextBridge, ipcRenderer, shell } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => {
            // 白名单安全的频道
            const validChannels = ['open-player', 'close-player', 'player-progress', 'window-close', 'window-minimize', 'window-maximize'];
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
                'window-maximize'
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
        maximize: () => ipcRenderer.invoke('window-maximize')
    }
});

// 暴露电子API
contextBridge.exposeInMainWorld('electronAPI', {
    openExternal: (url) => {
        // 验证URL是否安全
        if (url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
            return shell.openExternal(url);
        }
    }
});
