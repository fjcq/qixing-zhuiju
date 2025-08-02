// 存储模块 - 处理本地数据存储
class StorageService {
    constructor() {
        this.STORAGE_KEYS = {
            PLAY_HISTORY: 'play_history',
            WATCH_PROGRESS: 'watch_progress',
            USER_SETTINGS: 'user_settings',
            VIDEO_SITES: 'video_sites'
        };
    }

    // 获取播放历史
    getPlayHistory() {
        const history = localStorage.getItem(this.STORAGE_KEYS.PLAY_HISTORY);
        return history ? JSON.parse(history) : [];
    }

    // 添加播放历史
    addPlayHistory(videoData) {
        console.log('添加播放历史:', videoData);
        let history = this.getPlayHistory();

        // 移除重复项
        history = history.filter(item => item.vod_id !== videoData.vod_id);

        // 添加到历史记录开头
        const historyItem = {
            vod_id: videoData.vod_id,
            vod_name: videoData.vod_name,
            vod_pic: videoData.vod_pic,
            type_name: videoData.type_name,
            current_episode: videoData.current_episode || 1,
            episode_name: videoData.episode_name || '第1集',
            watch_time: Date.now(),
            site_name: videoData.site_name || '未知站点'
        };

        console.log('创建历史记录项:', historyItem);
        history.unshift(historyItem);

        // 限制历史记录数量（最多保留100条）
        if (history.length > 100) {
            history = history.slice(0, 100);
        }

        localStorage.setItem(this.STORAGE_KEYS.PLAY_HISTORY, JSON.stringify(history));
        console.log('播放历史已保存，总数:', history.length);
    }

    // 删除播放历史项
    removePlayHistory(vodId) {
        let history = this.getPlayHistory();
        history = history.filter(item => item.vod_id !== vodId);
        localStorage.setItem(this.STORAGE_KEYS.PLAY_HISTORY, JSON.stringify(history));
    }

    // 清空播放历史
    clearPlayHistory() {
        localStorage.removeItem(this.STORAGE_KEYS.PLAY_HISTORY);
    }

    // 获取观看进度
    getWatchProgress(vodId, episode) {
        const progress = localStorage.getItem(this.STORAGE_KEYS.WATCH_PROGRESS);
        const progressData = progress ? JSON.parse(progress) : {};
        const key = `${vodId}_${episode}`;
        return progressData[key] || { currentTime: 0, duration: 0, percentage: 0 };
    }

    // 保存观看进度
    saveWatchProgress(vodId, episode, currentTime, duration) {
        const progress = localStorage.getItem(this.STORAGE_KEYS.WATCH_PROGRESS);
        const progressData = progress ? JSON.parse(progress) : {};

        const key = `${vodId}_${episode}`;
        const percentage = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;

        progressData[key] = {
            currentTime: Math.round(currentTime),
            duration: Math.round(duration),
            percentage: percentage,
            updateTime: Date.now()
        };

        localStorage.setItem(this.STORAGE_KEYS.WATCH_PROGRESS, JSON.stringify(progressData));

        // 同时更新播放历史中的进度
        this.updateHistoryProgress(vodId, episode, percentage);
    }

    // 更新历史记录中的进度
    updateHistoryProgress(vodId, episode, percentage) {
        let history = this.getPlayHistory();
        const historyItem = history.find(item => item.vod_id === vodId);

        if (historyItem) {
            historyItem.current_episode = episode;
            historyItem.progress = percentage;
            historyItem.watch_time = Date.now();
            localStorage.setItem(this.STORAGE_KEYS.PLAY_HISTORY, JSON.stringify(history));
        }
    }

    // 获取用户设置
    getUserSettings() {
        const settings = localStorage.getItem(this.STORAGE_KEYS.USER_SETTINGS);
        return settings ? JSON.parse(settings) : this.getDefaultSettings();
    }

    // 获取默认设置
    getDefaultSettings() {
        return {
            autoPlay: true,
            autoNext: true,
            playbackRate: 1.0,
            volume: 1.0,
            quality: 'auto',
            theme: 'dark'
        };
    }

    // 保存用户设置
    saveUserSettings(settings) {
        const currentSettings = this.getUserSettings();
        const newSettings = { ...currentSettings, ...settings };
        localStorage.setItem(this.STORAGE_KEYS.USER_SETTINGS, JSON.stringify(newSettings));
    }

    // 获取收藏列表
    getFavorites() {
        const favorites = localStorage.getItem('favorites');
        return favorites ? JSON.parse(favorites) : [];
    }

    // 添加收藏
    addFavorite(videoData) {
        let favorites = this.getFavorites();

        // 检查是否已收藏
        if (!favorites.find(item => item.vod_id === videoData.vod_id)) {
            const favoriteItem = {
                vod_id: videoData.vod_id,
                vod_name: videoData.vod_name,
                vod_pic: videoData.vod_pic,
                type_name: videoData.type_name,
                add_time: Date.now(),
                site_name: videoData.site_name || '未知站点'
            };

            favorites.unshift(favoriteItem);
            localStorage.setItem('favorites', JSON.stringify(favorites));
            return true;
        }
        return false;
    }

    // 移除收藏
    removeFavorite(vodId) {
        let favorites = this.getFavorites();
        favorites = favorites.filter(item => item.vod_id !== vodId);
        localStorage.setItem('favorites', JSON.stringify(favorites));
    }

    // 检查是否已收藏
    isFavorite(vodId) {
        const favorites = this.getFavorites();
        return favorites.some(item => item.vod_id === vodId);
    }

    // 清理过期数据
    cleanupOldData() {
        try {
            // 清理30天前的观看进度数据
            const progress = localStorage.getItem(this.STORAGE_KEYS.WATCH_PROGRESS);
            if (progress) {
                const progressData = JSON.parse(progress);
                const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

                Object.keys(progressData).forEach(key => {
                    if (progressData[key].updateTime < thirtyDaysAgo) {
                        delete progressData[key];
                    }
                });

                localStorage.setItem(this.STORAGE_KEYS.WATCH_PROGRESS, JSON.stringify(progressData));
            }
        } catch (error) {
            console.warn('清理过期数据失败:', error);
        }
    }

    // 导出数据
    exportData() {
        return {
            playHistory: this.getPlayHistory(),
            watchProgress: localStorage.getItem(this.STORAGE_KEYS.WATCH_PROGRESS),
            userSettings: this.getUserSettings(),
            favorites: this.getFavorites(),
            videoSites: localStorage.getItem(this.STORAGE_KEYS.VIDEO_SITES),
            exportTime: Date.now()
        };
    }

    // 导入数据
    importData(data) {
        try {
            if (data.playHistory) {
                localStorage.setItem(this.STORAGE_KEYS.PLAY_HISTORY, JSON.stringify(data.playHistory));
            }
            if (data.watchProgress) {
                localStorage.setItem(this.STORAGE_KEYS.WATCH_PROGRESS, data.watchProgress);
            }
            if (data.userSettings) {
                localStorage.setItem(this.STORAGE_KEYS.USER_SETTINGS, JSON.stringify(data.userSettings));
            }
            if (data.favorites) {
                localStorage.setItem('favorites', JSON.stringify(data.favorites));
            }
            if (data.videoSites) {
                localStorage.setItem(this.STORAGE_KEYS.VIDEO_SITES, data.videoSites);
            }
            return true;
        } catch (error) {
            console.error('导入数据失败:', error);
            return false;
        }
    }

    // 获取存储使用情况
    getStorageUsage() {
        let totalSize = 0;
        const usage = {};

        Object.values(this.STORAGE_KEYS).forEach(key => {
            const data = localStorage.getItem(key);
            if (data) {
                const size = new Blob([data]).size;
                usage[key] = {
                    size: size,
                    sizeText: this.formatBytes(size)
                };
                totalSize += size;
            }
        });

        // 检查其他数据
        const favorites = localStorage.getItem('favorites');
        if (favorites) {
            const size = new Blob([favorites]).size;
            usage.favorites = {
                size: size,
                sizeText: this.formatBytes(size)
            };
            totalSize += size;
        }

        return {
            total: totalSize,
            totalText: this.formatBytes(totalSize),
            details: usage
        };
    }

    // 格式化字节大小
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// 导出存储服务实例
window.StorageService = StorageService;
