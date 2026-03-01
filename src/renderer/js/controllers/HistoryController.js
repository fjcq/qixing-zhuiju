/**
 * 历史控制器
 * 管理播放历史和搜索历史
 */
class HistoryController {
    /**
     * 构造函数
     * @param {object} options - 配置选项
     * @param {object} options.storageService - 存储服务实例
     * @param {object} options.componentService - 组件服务实例
     * @param {Function} options.onPlayVideo - 播放视频回调
     */
    constructor(options) {
        this.storageService = options.storageService;
        this.componentService = options.componentService;
        this.onPlayVideo = options.onPlayVideo;

        // 存储键名
        this.SEARCH_HISTORY_KEY = 'SEARCH_HISTORY';
        this.MAX_SEARCH_HISTORY = 20;
        this.MAX_PLAY_HISTORY = 100;
    }

    /**
     * 保存搜索历史
     * @param {string} keyword - 搜索关键词
     */
    saveSearchHistory(keyword) {
        if (!keyword || keyword.trim() === '') return;

        const history = this.getSearchHistory();

        // 移除重复的关键词
        const filteredHistory = history.filter(item => item !== keyword);

        // 添加到历史记录开头
        filteredHistory.unshift(keyword);

        // 限制历史记录数量
        const limitedHistory = filteredHistory.slice(0, this.MAX_SEARCH_HISTORY);

        // 保存到localStorage
        localStorage.setItem(this.SEARCH_HISTORY_KEY, JSON.stringify(limitedHistory));

        console.log('[HistoryController] 保存搜索历史:', keyword);
    }

    /**
     * 获取搜索历史
     * @returns {Array<string>} 搜索历史列表
     */
    getSearchHistory() {
        try {
            return JSON.parse(localStorage.getItem(this.SEARCH_HISTORY_KEY) || '[]');
        } catch {
            return [];
        }
    }

    /**
     * 加载搜索历史到UI
     */
    loadSearchHistory() {
        const historyList = document.getElementById('search-history-list');
        if (!historyList) return;

        const history = this.getSearchHistory();

        if (history.length === 0) {
            historyList.innerHTML = '<div class="empty-history">暂无搜索历史</div>';
            return;
        }

        // 创建历史关键词元素
        const historyHtml = history.map(keyword => `
            <div class="history-keyword" data-keyword="${keyword}">
                <span class="keyword-text">${keyword}</span>
                <button class="keyword-remove" title="删除此历史记录">×</button>
            </div>
        `).join('');

        historyList.innerHTML = historyHtml;

        // 添加点击事件
        this.bindSearchHistoryEvents();
    }

    /**
     * 绑定搜索历史事件
     */
    bindSearchHistoryEvents() {
        const historyKeywords = document.querySelectorAll('.history-keyword');
        historyKeywords.forEach(item => {
            // 关键词点击事件
            const keywordText = item.querySelector('.keyword-text');
            keywordText.addEventListener('click', () => {
                const { keyword } = item.dataset;
                const searchInput = document.getElementById('search-input');
                if (searchInput && keyword) {
                    searchInput.value = keyword;
                    // 触发搜索
                    const searchBtn = document.getElementById('search-btn');
                    if (searchBtn) {
                        searchBtn.click();
                    }
                }
            });

            // 删除按钮点击事件
            const removeBtn = item.querySelector('.keyword-remove');
            removeBtn.addEventListener('click', e => {
                e.stopPropagation();
                const { keyword } = item.dataset;
                this.removeSearchHistoryItem(keyword);
                item.remove();

                // 如果历史为空，显示空状态
                if (this.getSearchHistory().length === 0) {
                    const historyList = document.getElementById('search-history-list');
                    if (historyList) {
                        historyList.innerHTML = '<div class="empty-history">暂无搜索历史</div>';
                    }
                }
            });
        });
    }

    /**
     * 删除单条搜索历史
     * @param {string} keyword - 要删除的关键词
     */
    removeSearchHistoryItem(keyword) {
        const history = this.getSearchHistory();
        const filteredHistory = history.filter(item => item !== keyword);
        localStorage.setItem(this.SEARCH_HISTORY_KEY, JSON.stringify(filteredHistory));
        console.log('[HistoryController] 删除搜索历史:', keyword);
    }

    /**
     * 清空搜索历史
     */
    clearSearchHistory() {
        localStorage.removeItem(this.SEARCH_HISTORY_KEY);
        this.loadSearchHistory();
        this.componentService.showNotification('搜索历史已清空', 'success');
        console.log('[HistoryController] 搜索历史已清空');
    }

    /**
     * 加载播放历史
     */
    loadPlayHistory() {
        console.log('[HistoryController] 加载播放历史');
        const history = this.storageService.getPlayHistory();
        this.displayPlayHistory(history);
    }

    /**
     * 显示播放历史
     * @param {Array} history - 播放历史列表
     */
    displayPlayHistory(history) {
        const historyContainer = document.getElementById('history-container');
        if (!historyContainer) return;

        if (!history || history.length === 0) {
            historyContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📺</div>
                    <div class="empty-text">暂无播放历史</div>
                    <div class="empty-hint">观看的视频将自动记录在这里</div>
                </div>
            `;
            return;
        }

        // 按观看时间排序（最新的在前）
        const sortedHistory = [...history].sort((a, b) => b.watch_time - a.watch_time);

        const historyHtml = sortedHistory.map(item => this.createHistoryItemHtml(item)).join('');
        historyContainer.innerHTML = `<div class="history-list">${historyHtml}</div>`;

        // 绑定事件
        this.bindPlayHistoryEvents();
    }

    /**
     * 创建播放历史项HTML
     * @param {object} item - 历史记录项
     * @returns {string} HTML字符串
     */
    createHistoryItemHtml(item) {
        const watchTime = new Date(item.watch_time);
        const timeStr = this.formatTime(watchTime);
        const progress = item.progress || 0;

        return `
            <div class="history-item" data-vod-id="${item.vod_id}" data-site-name="${item.site_name || ''}">
                <div class="history-poster">
                    <img src="${item.vod_pic || ''}" alt="${item.vod_name}" onerror="this.src='assets/default-poster.png'">
                    ${progress > 0 ? `<div class="progress-bar"><div class="progress-fill" style="width: ${progress}%"></div></div>` : ''}
                </div>
                <div class="history-info">
                    <div class="history-title">${item.vod_name || '未知视频'}</div>
                    <div class="history-meta">
                        <span class="history-episode">${item.episode_name || '正片'}</span>
                        <span class="history-site">${item.site_name || ''}</span>
                    </div>
                    <div class="history-time">${timeStr}</div>
                </div>
                <div class="history-actions">
                    <button class="history-play-btn" title="继续播放">▶</button>
                    <button class="history-delete-btn" title="删除记录">×</button>
                </div>
            </div>
        `;
    }

    /**
     * 格式化时间
     * @param {Date} date - 日期对象
     * @returns {string} 格式化后的时间字符串
     */
    formatTime(date) {
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        if (hours < 24) return `${hours}小时前`;
        if (days < 7) return `${days}天前`;

        return date.toLocaleDateString('zh-CN');
    }

    /**
     * 绑定播放历史事件
     */
    bindPlayHistoryEvents() {
        const historyItems = document.querySelectorAll('.history-item');
        historyItems.forEach(item => {
            // 播放按钮
            const playBtn = item.querySelector('.history-play-btn');
            playBtn.addEventListener('click', () => {
                const { vodId } = item.dataset;
                const { siteName } = item.dataset;
                if (this.onPlayVideo) {
                    this.onPlayVideo(vodId, siteName);
                }
            });

            // 删除按钮
            const deleteBtn = item.querySelector('.history-delete-btn');
            deleteBtn.addEventListener('click', e => {
                e.stopPropagation();
                const { vodId } = item.dataset;
                this.removePlayHistoryItem(vodId);
                item.remove();
            });

            // 整个卡片点击
            item.addEventListener('click', e => {
                if (!e.target.closest('.history-actions')) {
                    const { vodId } = item.dataset;
                    const { siteName } = item.dataset;
                    if (this.onPlayVideo) {
                        this.onPlayVideo(vodId, siteName);
                    }
                }
            });
        });
    }

    /**
     * 删除单条播放历史
     * @param {string} vodId - 视频ID
     */
    removePlayHistoryItem(vodId) {
        this.storageService.removePlayHistory(vodId);
        this.componentService.showNotification('已删除播放记录', 'success');
        console.log('[HistoryController] 删除播放历史:', vodId);

        // 检查是否还有历史记录
        const history = this.storageService.getPlayHistory();
        if (history.length === 0) {
            this.loadPlayHistory();
        }
    }

    /**
     * 清空播放历史
     */
    clearPlayHistory() {
        this.storageService.clearPlayHistory();
        this.loadPlayHistory();
        this.componentService.showNotification('播放历史已清空', 'success');
        console.log('[HistoryController] 播放历史已清空');
    }

    /**
     * 确认清空播放历史
     */
    confirmClearHistory() {
        if (confirm('确定要清空所有播放历史吗？此操作不可恢复。')) {
            this.clearPlayHistory();
        }
    }
}

// 导出给渲染进程使用
window.HistoryController = HistoryController;
