/**
 * magnetParserAdapter
 * 包装现有 IPC：
 * - invoke('handle-magnet-link', magnetUri) 解析磁力链（返回 { success, files, infoHash }）
 * - invoke('play-magnet-file', { magnetUri, fileName, infoHash }) 播放指定文件（返回 { success, streamUrl, isLocal }）
 * - onMagnetProgress(callback) 订阅 magnet-progress 事件
 * - removeMagnetProgressListener() 解绑 magnet-progress 事件
 *
 * 不修改主进程，不动 magnetHandler.mjs
 * 兼容 Electron renderer (nodeIntegration: false)，通过 window.electron 访问
 *
 * 单一职责：仅做 IPC 转发与进度订阅，不做 UI 渲染，不做状态管理。
 */

/**
 * 进度数据约定（来自 ipcHandler.js 在 resolve 阶段通过 event.sender.send 发送）：
 * { status: string, progress: number, ... }
 * 例如：{ status: '正在解析磁力链接...', progress: 0 }
 */

class MagnetParserAdapter {
    /**
     * 构造函数
     */
    constructor() {
        this._ipc = (typeof window !== 'undefined' && window.electron) ? window.electron : null;
        this._progressCallback = null;
        this._boundOnProgress = null;
    }

    /**
     * 检查 IPC 是否可用（Electron renderer 环境下应为 true，Node / Jest 环境下为 false）
     * @returns {boolean}
     */
    isAvailable() {
        return !!(this._ipc && this._ipc.ipcRenderer && typeof this._ipc.ipcRenderer.invoke === 'function');
    }

    /**
     * 订阅 magnet-progress 进度事件
     * preload.js 已经把 ipcRenderer.on('magnet-progress', ...) 包装成 onMagnetProgress(callback)
     * 注意：preload 内部使用 ipcRenderer.on（非 once），每次调用 onMagnetProgress 都会新增一个监听器
     * 所以订阅前应该先 removeProgressListener，避免重复订阅造成内存泄露
     * @param {(data: { status: string, progress: number }) => void} callback - 进度回调
     */
    onProgress(callback) {
        if (!this.isAvailable() || typeof this._ipc.onMagnetProgress !== 'function') {
            return;
        }
        // 防御性清理：避免重复订阅导致同一个事件多次触发
        this.removeProgressListener();
        this._progressCallback = callback;
        // preload 内部已经处理 (event, data) → data 的拆包，callback 收到的就是 data
        this._boundOnProgress = data => {
            if (typeof this._progressCallback === 'function' && data) {
                this._progressCallback(data);
            }
        };
        this._ipc.onMagnetProgress(this._boundOnProgress);
    }

    /**
     * 移除 magnet-progress 进度监听
     * preload 实现是 ipcRenderer.removeAllListeners('magnet-progress')，可彻底清空
     */
    removeProgressListener() {
        if (!this.isAvailable()) {
            this._progressCallback = null;
            this._boundOnProgress = null;
            return;
        }
        if (typeof this._ipc.removeMagnetProgressListener === 'function') {
            this._ipc.removeMagnetProgressListener();
        }
        this._progressCallback = null;
        this._boundOnProgress = null;
    }

    /**
     * 解析磁力链（对应主进程 handle-magnet-link IPC 的 resolve action）
     * @param {string} magnetUri - 磁力链接或纯 info hash
     * @returns {Promise<{ success: boolean, files?: Array, infoHash?: string, error?: string }>}
     */
    async parse(magnetUri) {
        if (!this.isAvailable()) {
            return { success: false, error: 'Electron IPC 不可用' };
        }
        if (typeof magnetUri !== 'string' || !magnetUri) {
            return { success: false, error: '无效的磁力链接' };
        }
        try {
            // preload.invoke 只会把 (channel, data) 转发给主进程，data 是单个参数
            const result = await this._ipc.ipcRenderer.invoke('handle-magnet-link', magnetUri);
            if (result && result.success) {
                return {
                    success: true,
                    files: Array.isArray(result.files) ? result.files : [],
                    infoHash: result.infoHash || ''
                };
            }
            return { success: false, error: (result && result.error) || '磁力链解析失败' };
        } catch (error) {
            return { success: false, error: (error && error.message) || String(error) };
        }
    }

    /**
     * 播放指定文件（对应主进程 play-magnet-file IPC，区别于 handle-magnet-link）
     * @param {string} magnetUri - 磁力链接或纯 info hash
     * @param {string} fileName - 待播放的文件名
     * @param {string} [infoHash] - 可选的 info hash，主进程 resolve 阶段已提取过，传过去能命中本地缓存
     * @returns {Promise<{ success: boolean, streamUrl?: string, isLocal?: boolean, error?: string }>}
     */
    async play(magnetUri, fileName, infoHash) {
        if (!this.isAvailable()) {
            return { success: false, error: 'Electron IPC 不可用' };
        }
        if (typeof magnetUri !== 'string' || !magnetUri) {
            return { success: false, error: '无效的磁力链接' };
        }
        if (typeof fileName !== 'string' || !fileName) {
            return { success: false, error: '无效的文件名' };
        }
        try {
            // 注意：play 走的是独立 IPC 通道 play-magnet-file（白名单已在 preload 注册），
            // 入参是对象 { magnetUri, fileName, infoHash }，与 resolve 用的 handle-magnet-link 不同
            const payload = { magnetUri, fileName };
            if (infoHash) {
                payload.infoHash = infoHash;
            }
            const result = await this._ipc.ipcRenderer.invoke('play-magnet-file', payload);
            if (result && result.success) {
                return {
                    success: true,
                    streamUrl: result.streamUrl || '',
                    isLocal: !!result.isLocal
                };
            }
            return { success: false, error: (result && result.error) || '播放失败' };
        } catch (error) {
            return { success: false, error: (error && error.message) || String(error) };
        }
    }
}

/**
 * 兼容 Node.js (Jest) 和 Electron renderer (无 nodeIntegration)
 * Node / Jest 走 module.exports；浏览器走全局 window.MagnetParserAdapter
 */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MagnetParserAdapter };
}
if (typeof window !== 'undefined') {
    window.MagnetParserAdapter = MagnetParserAdapter;
}
