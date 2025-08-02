// Electron preload 脚本
const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, data) => {
            // 白名单安全的频道
            const validChannels = ['open-player', 'close-player', 'player-progress'];
            if (validChannels.includes(channel)) {
                ipcRenderer.send(channel, data);
            }
        },
        invoke: (channel, data) => {
            const validChannels = [
                'open-player',
                'close-player',
                'get-video-info',
                'get-app-version'
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
    }
});
