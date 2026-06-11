/**
 * Node.js 运行环境服务（渲染端）
 * 封装 IPC 调用，向 UI 暴露简洁的状态查询接口
 *
 * 关键设计：
 * - 单例，避免重复查询 IPC
 * - 提供 getStatus() / refresh() / openPortableDir() 三个方法
 * - 缓存状态：避免每次设置页打开都查一次（5 秒内复用）
 * - 错误友好：失败时返回 ok=false，UI 不需要 try-catch
 *
 * 使用示例：
 *   const rt = new RuntimeEnvironmentService();
 *   const status = await rt.getStatus();
 *   if (!status.ok) showWarn(status.issues.join('; '));
 */
(function() {
    'use strict';

    // 缓存有效期：5 秒内复用，避免频繁 IPC
    const CACHE_TTL_MS = 5000;

    class RuntimeEnvironmentService {
        /**
         * 构造函数
         */
        constructor() {
            this._cache = null;
            this._cacheAt = 0;
            this._inflight = null;
        }

        /**
         * 获取 Node.js 运行环境状态
         * 失败时返回的 status.ok=false，issues 数组给出原因
         * @returns {Promise<{
         *   ok: boolean,
         *   source: string,
         *   sourceLabel: string,
         *   nodePath: string,
         *   version: string,
         *   description: string,
         *   electronBundled: boolean,
         *   portableAvailable: boolean,
         *   portableDir: string,
         *   systemAvailable: boolean,
         *   magnetRuntimeOk: boolean,
         *   magnetRuntimePath: string,
         *   issues: string[]
         * }>}
         */
        // eslint-disable-next-line require-await
        async getStatus(forceRefresh = false) {
            const now = Date.now();
            // 命中缓存（不强制刷新 + 缓存有效）
            if (!forceRefresh && this._cache && (now - this._cacheAt) < CACHE_TTL_MS) {
                return this._cache;
            }
            // 防并发：同一次刷新复用同一个 Promise
            if (this._inflight) {
                return this._inflight;
            }
            this._inflight = (async () => {
                try {
                    if (!window.electron || !window.electron.ipcRenderer) {
                        return this._buildErrorResult('electron API 不可用');
                    }
                    const result = await window.electron.ipcRenderer.invoke('get-runtime-environment');
                    if (result && result.success && result.status) {
                        this._cache = result.status;
                        this._cacheAt = Date.now();
                        return result.status;
                    }
                    // IPC 失败：返回错误结构而不是抛异常
                    return this._buildErrorResult(
                        (result && result.error) || '环境状态查询失败'
                    );
                } catch (err) {
                    return this._buildErrorResult(err && err.message || String(err));
                } finally {
                    this._inflight = null;
                }
            })();
            return this._inflight;
        }

        /**
         * 强制刷新环境状态（绕过缓存）
         * 用户点击"刷新"按钮时调用
         * @returns {Promise<object>}
         */
        async refresh() {
            this._cache = null;
            this._cacheAt = 0;
            if (!window.electron || !window.electron.ipcRenderer) {
                return this._buildErrorResult('electron API 不可用');
            }
            try {
                const result = await window.electron.ipcRenderer.invoke('refresh-runtime-environment');
                if (result && result.success && result.status) {
                    this._cache = result.status;
                    this._cacheAt = Date.now();
                    return result.status;
                }
                return this._buildErrorResult((result && result.error) || '环境刷新失败');
            } catch (err) {
                return this._buildErrorResult(err && err.message || String(err));
            }
        }

        /**
         * 打开便携版 Node.js 安装目录
         * 引导用户自己放一个便携版 Node.js 时调用
         * @returns {Promise<{success: boolean, error?: string, path?: string}>}
         */
        async openPortableDir() {
            if (!window.electron || !window.electron.ipcRenderer) {
                return { success: false, error: 'electron API 不可用' };
            }
            try {
                const result = await window.electron.ipcRenderer.invoke('open-portable-node-dir');
                return result || { success: false, error: '未知错误' };
            } catch (err) {
                return { success: false, error: err && err.message || String(err) };
            }
        }

        /**
         * 下载便携版 Node.js
         * 关键：进度通过 onProgress 回调实时返回
         * 完成后状态自动写入 nodeEnvironment 缓存，下次 getStatus 会命中便携版
         * @param {object} [opts]
         * @param {string} [opts.version] - 要下载的版本（默认 18.19.0）
         * @param {function} [opts.onProgress] - ({phase, percent, message}) => void
         * @returns {Promise<{success: boolean, nodePath?: string, version?: string, error?: string}>}
         */
        async downloadPortable(opts = {}) {
            if (!window.electron || !window.electron.ipcRenderer) {
                return { success: false, error: 'electron API 不可用' };
            }
            try {
                // 监听进度事件（一次性）
                // eslint-disable-next-line no-empty-function
                let cleanup = () => {};
                if (opts.onProgress && window.electron.ipcRenderer.onRuntimeEnvProgress) {
                    const handler = (event, data) => opts.onProgress(data);
                    window.electron.ipcRenderer.onRuntimeEnvProgress(handler);
                    cleanup = () => {
                        try {
                            if (window.electron.ipcRenderer.removeRuntimeEnvProgressListener) {
                                window.electron.ipcRenderer.removeRuntimeEnvProgressListener();
                            }
                        } catch (e) { /* 忽略 */ }
                    };
                }
                try {
                    const result = await window.electron.ipcRenderer.invoke('download-portable-node', {
                        version: opts.version
                    });
                    // 成功后失效缓存，下次 getStatus 会重新解析
                    if (result && result.success) {
                        this._cache = null;
                        this._cacheAt = 0;
                    }
                    return result || { success: false, error: '未知错误' };
                } finally {
                    cleanup();
                }
            } catch (err) {
                return { success: false, error: err && err.message || String(err) };
            }
        }

        /**
         * 构建错误结果对象
         * 关键：所有错误统一结构，方便 UI 渲染时无需判空
         */
        _buildErrorResult(message) {
            return {
                ok: false,
                source: 'none',
                sourceLabel: '未找到',
                nodePath: '',
                version: '',
                description: '',
                electronBundled: false,
                portableAvailable: false,
                portableDir: '',
                systemAvailable: false,
                magnetRuntimeOk: false,
                magnetRuntimePath: '',
                issues: [message]
            };
        }

        /**
         * 获取来源的友好标签
         * @param {string} source
         * @returns {string}
         */
        getSourceLabel(source) {
            const labels = {
                'electron-bundled': '应用内置',
                'portable': '便携版',
                'system': '系统安装',
                'none': '未找到'
            };
            return labels[source] || '未知';
        }

        /**
         * 获取来源的图标（emoji）
         */
        getSourceIcon(source) {
            const icons = {
                'electron-bundled': '🚀',
                'portable': '📦',
                'system': '🖥️',
                'none': '❓'
            };
            return icons[source] || '❓';
        }
    }

    // 暴露到 window（渲染端）和 module.exports（测试）
    if (typeof window !== 'undefined') {
        window.RuntimeEnvironmentService = RuntimeEnvironmentService;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = RuntimeEnvironmentService;
    }
})();
