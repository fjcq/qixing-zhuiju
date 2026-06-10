/**
 * urlHistoryManager
 * 包装 storage.js 的 play history API
 * 增强：从 vod_id 前缀 + type_name 字段推断类型（magnet / url / local）
 *
 * 严格遵循 project memory 规范：
 * - 正常路径不输出 [STORAGE] 日志
 * - 异常路径 console.error 后降级（getList 返回 []，写入静默失败）
 *
 * 模块包在 IIFE 内，避免 const 与 inputRecognizer.js 的同名常量冲突
 */

(function () {
    'use strict';

/**
 * 兼容 Node.js (Jest) 和 Electron renderer (无 nodeIntegration)
 * 优先用 require（Jest 测试），失败则降级到 window.StorageService 全局
 */
let StorageService;
if (typeof require !== 'undefined' && typeof window === 'undefined') {
    try {
        StorageService = require('../storage').StorageService;
    } catch (e) {
        // ignored
    }
}
if (!StorageService && typeof window !== 'undefined' && window.StorageService) {
    StorageService = window.StorageService;
}

const TYPE_MAGNET = 'magnet';
const TYPE_URL = 'url';
const TYPE_LOCAL = 'local';
const TYPE_UNKNOWN = 'unknown';

class UrlHistoryManager {
    /**
     * 构造函数
     */
    constructor() {
        this._storage = new StorageService();
    }

    /**
     * 获取历史列表（已按时间倒序）
     * @returns {Array}
     */
    getList() {
        try {
            return this._storage.getPlayHistory();
        } catch (error) {
            console.error('[STORAGE] urlHistoryManager.getList 失败:', error);
            return [];
        }
    }

    /**
     * 添加历史项
     * @param {{ vod_id: string, vod_name?: string, type_name?: string, episode_name?: string, [k: string]: any }} item
     */
    addItem(item) {
        try {
            if (!item || !item.vod_id) {
                return;
            }
            // 透传所有可选项（episode_name 等），未传则按 type 兜底
            const episodeName = item.episode_name
                || (item.type_name === '磁力' ? '选择文件中' : '正片');
            this._storage.addPlayHistory({
                vod_id: item.vod_id,
                vod_name: item.vod_name || item.vod_id,
                vod_pic: item.vod_pic || '',
                type_name: item.type_name || this._typeNameFromId(item.vod_id),
                current_episode: 1,
                episode_name: episodeName,
                watch_time: Date.now(),
                site_name: '',
                site_url: '',
                progress: 0,
                play_duration: 0
            });
        } catch (error) {
            console.error('[STORAGE] urlHistoryManager.addItem 失败:', error);
        }
    }

    /**
     * 删除历史项
     * @param {string} vodId
     */
    removeItem(vodId) {
        try {
            this._storage.removePlayHistory(vodId);
        } catch (error) {
            console.error('[STORAGE] urlHistoryManager.removeItem 失败:', error);
        }
    }

    /**
     * 从 vod_id 前缀推断类型
     * @param {{ vod_id?: string, type_name?: string }} item
     * @returns {'magnet'|'url'|'local'|'unknown'}
     */
    inferType(item) {
        if (!item) return TYPE_UNKNOWN;
        const id = item.vod_id || '';
        if (id.startsWith('magnet:') || /^[a-fA-F0-9]{40}$/.test(id) || /^[A-Z2-7]{32}$/.test(id)) {
            return TYPE_MAGNET;
        }
        if (id.startsWith('file://') || /^[A-Za-z]:[\\/]/.test(id) || id.startsWith('\\\\') || id.startsWith('/')) {
            return TYPE_LOCAL;
        }
        if (id.startsWith('http://') || id.startsWith('https://')) {
            return TYPE_URL;
        }
        if (item.type_name === '磁力') return TYPE_MAGNET;
        if (item.type_name === '本地') return TYPE_LOCAL;
        if (item.type_name === '外链') return TYPE_URL;
        return TYPE_UNKNOWN;
    }

    /**
     * 根据 vod_id 推断得到的类型，反查中文 type_name
     * @param {string} vodId
     * @returns {string}
     */
    _typeNameFromId(vodId) {
        const t = this.inferType({ vod_id: vodId });
        return { magnet: '磁力', local: '本地', url: '外链' }[t] || '外链';
    }
}

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { UrlHistoryManager };
    }
    if (typeof window !== 'undefined') {
        window.UrlHistoryManager = UrlHistoryManager;
    }
})();
