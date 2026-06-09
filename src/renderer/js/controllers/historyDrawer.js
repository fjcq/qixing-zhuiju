/**
 * historyDrawer
 * 外链页内联历史抽屉：展开/折叠/列表渲染/点击再播/删除/复制
 *
 * 依赖（由构造函数注入）：
 * - container: HTMLElement 抽屉容器
 * - historyManager: { getList(): Array, removeItem(vodId: string): void }
 * - inferType: (item: object) => 'magnet'|'url'|'local'|'unknown' 类型推断函数
 * - onItemClick: (item: object) => void 点击项回调
 *
 * 兼容 Node.js (Jest) 和 Electron renderer (无 nodeIntegration)
 */

const TYPE_ICONS = {
    magnet: '🧲',
    url: '🌐',
    local: '📁',
    unknown: '❓'
};
const TYPE_LABELS = {
    magnet: '磁力',
    url: 'URL',
    local: '本地',
    unknown: '未知'
};

class HistoryDrawer {
    /**
     * @param {{
     *   container: HTMLElement,
     *   historyManager: { getList: () => Array, removeItem: (id: string) => void },
     *   inferType: (item: object) => string,
     *   onItemClick: (item: object) => void
     * }} options
     */
    constructor(options) {
        this.container = options.container;
        this.historyManager = options.historyManager;
        this.inferType = options.inferType;
        this.onItemClick = options.onItemClick || (() => {});
        this._isOpen = false;
    }

    /**
     * 切换展开/折叠
     */
    toggle() {
        if (this._isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * 展开抽屉
     */
    open() {
        if (!this.container) return;
        this._isOpen = true;
        this.container.classList.add('is-open');
        this.render();
    }

    /**
     * 折叠抽屉
     */
    close() {
        if (!this.container) return;
        this._isOpen = false;
        this.container.classList.remove('is-open');
    }

    /**
     * 是否已展开
     * @returns {boolean}
     */
    isOpen() {
        return this._isOpen;
    }

    /**
     * 重新渲染列表（仅在展开状态下执行实际渲染）
     */
    render() {
        if (!this.container || !this._isOpen) return;

        const list = this._safeGetList();
        if (!list || list.length === 0) {
            this.container.innerHTML = `
                <div class="play-url-history-empty">
                    <p>暂无历史记录</p>
                </div>
            `;
            return;
        }

        this.container.innerHTML = `
            <div class="play-url-history-list">
                ${list.map((item, i) => this._renderItem(item, i)).join('')}
            </div>
        `;

        // 绑定事件
        this.container.querySelectorAll('.play-url-history-item').forEach(el => {
            const vodId = el.getAttribute('data-vod-id');
            const idx = parseInt(el.getAttribute('data-idx'), 10);
            const item = list[idx];

            el.addEventListener('click', e => {
                if (e.target.closest('.play-url-history-action')) return;
                this.onItemClick(item);
            });

            const deleteBtn = el.querySelector('.play-url-history-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    this.historyManager.removeItem(vodId);
                    this.render();
                });
            }

            const copyBtn = el.querySelector('.play-url-history-copy');
            if (copyBtn) {
                copyBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    this._copyToClipboard(vodId);
                });
            }
        });
    }

    _renderItem(item, idx) {
        const type = (this.inferType && this.inferType(item)) || 'unknown';
        const typeIcon = TYPE_ICONS[type] || '❓';
        const typeLabel = TYPE_LABELS[type] || '未知';
        const title = item.vod_name || item.vod_id || '未命名';
        const timeText = this._formatTime(item.watch_time);

        return `
            <div class="play-url-history-item" data-vod-id="${this._escapeAttr(item.vod_id || '')}" data-idx="${idx}">
                <span class="play-url-history-icon">${typeIcon}</span>
                <div class="play-url-history-info">
                    <div class="play-url-history-title">${this._escapeHtml(title)}</div>
                    <div class="play-url-history-meta">${typeLabel} · ${this._escapeHtml(timeText)}</div>
                </div>
                <div class="play-url-history-actions">
                    <button class="play-url-history-action play-url-history-copy" title="复制链接" type="button">📋</button>
                    <button class="play-url-history-action play-url-history-delete" title="删除" type="button">🗑️</button>
                </div>
            </div>
        `;
    }

    _formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        if (isNaN(d.getTime())) return '';
        const now = Date.now();
        const diff = now - ts;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
        if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`;
        return d.toLocaleDateString('zh-CN');
    }

    _copyToClipboard(text) {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(() => {
                this._fallbackCopy(text);
            });
        } else {
            this._fallbackCopy(text);
        }
    }

    _fallbackCopy(text) {
        if (typeof document === 'undefined') return;
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
        } catch (e) {
            // ignored
        }
        document.body.removeChild(ta);
    }

    _safeGetList() {
        try {
            return this.historyManager.getList();
        } catch (error) {
            if (typeof console !== 'undefined') {
                console.error('[HISTORY] drawer.getList 失败:', error);
            }
            return [];
        }
    }

    _escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    _escapeAttr(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/"/g, '&quot;');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HistoryDrawer };
}
