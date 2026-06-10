// 存储模块 - 处理本地数据存储
class StorageService {
    constructor() {
        this.STORAGE_KEYS = {
            PLAY_HISTORY: 'play_history',
            WATCH_PROGRESS: 'watch_progress',
            USER_SETTINGS: 'user_settings',
            VIDEO_SITES: 'video_sites',
            ROUTE_ALIASES: 'route_aliases'
        };
    }

    // 获取播放历史
    getPlayHistory() {
        try {
            const history = localStorage.getItem(this.STORAGE_KEYS.PLAY_HISTORY);
            const parsedHistory = history ? JSON.parse(history) : [];

            return parsedHistory;
        } catch (error) {
            console.error('[STORAGE] 读取播放历史失败:', error);
            return [];
        }
    }

    // 添加播放历史
    addPlayHistory(videoData) {
        try {
            // 验证输入数据
            if (!videoData || !videoData.vod_id) {
                return;
            }

            let history = this.getPlayHistory();

            // 移除重复项
            history = history.filter(item => item.vod_id !== videoData.vod_id);

            // 获取站点名称 - 默认空；按需填充
            // - 直接传入的 siteName 优先
            // - 站内视频：按 site_url 反查，反查不到才用"未知站点"兜底
            // - 外链 URL：取 vod_id 的 hostname（差异化信息，避免与 type_name 重复）
            // - 本地/磁力外链：保持空（无附加信息；渲染时只显示 type_name）
            let siteName = '';
            const siteUrl = videoData.site_url || '';
            const externalTypes = ['外链', '本地', '磁力'];
            const isExternal = !siteUrl && externalTypes.includes(videoData.type_name);

            if (videoData.siteName) {
                siteName = videoData.siteName;
            } else if (siteUrl) {
                // 从localStorage获取站点列表 - 使用正确的键名
                const sites = JSON.parse(localStorage.getItem('video_sites') || '[]');
                const site = sites.find(s => s.url === siteUrl);
                if (site && site.name) {
                    siteName = site.name;
                } else {
                    siteName = '未知站点';
                }
            } else if (isExternal && videoData.type_name === '外链' && videoData.vod_id) {
                try {
                    const host = new URL(videoData.vod_id).hostname;
                    if (host) siteName = host;
                } catch (e) {
                    // 非标准 URL，忽略
                }
            }
            // 本地/磁力外链：siteName 保持为空字符串，避免与 type_name 重复显示

            // 添加到历史记录开头
            const historyItem = {
                vod_id: videoData.vod_id,
                vod_name: videoData.vod_name,
                vod_pic: videoData.vod_pic,
                type_name: videoData.type_name,
                current_episode: videoData.current_episode || 1,
                episode_name: videoData.episode_name || '第1集',
                watch_time: Date.now(),
                site_name: siteName,
                site_url: siteUrl,
                progress: videoData.progress || 0,
                play_duration: videoData.play_duration || 0
            };

            history.unshift(historyItem);

            // 限制历史记录数量（最多保留100条）
            if (history.length > 100) {
                history = history.slice(0, 100);
            }

            localStorage.setItem(this.STORAGE_KEYS.PLAY_HISTORY, JSON.stringify(history));
        } catch (error) {
            console.error('[STORAGE] 添加播放历史失败:', error);
        }
    }

    // 删除播放历史项
    removePlayHistory(vodId) {
        try {
            let history = this.getPlayHistory();
            history = history.filter(item => item.vod_id !== vodId);
            localStorage.setItem(this.STORAGE_KEYS.PLAY_HISTORY, JSON.stringify(history));
        } catch (error) {
            console.error('[STORAGE] 删除播放历史失败:', error);
        }
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
        try {
            const progress = localStorage.getItem(this.STORAGE_KEYS.WATCH_PROGRESS);
            const progressData = progress ? JSON.parse(progress) : {};

            const key = `${vodId}_${episode}`;
            const percentage = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;

            progressData[key] = {
                currentTime: Math.round(currentTime),
                duration: Math.round(duration),
                percentage,
                updateTime: Date.now()
            };

            localStorage.setItem(this.STORAGE_KEYS.WATCH_PROGRESS, JSON.stringify(progressData));

            // 同时更新播放历史中的进度和播放时长
            this.updateHistoryProgress(vodId, episode, percentage, Math.round(currentTime));
        } catch (error) {
            console.error('[STORAGE] 保存观看进度失败:', error);
        }
    }

    // 更新历史记录中的进度
    updateHistoryProgress(vodId, episode, percentage, playDuration = null) {
        try {
            const history = this.getPlayHistory();
            const historyItem = history.find(item => item.vod_id === vodId);

            if (historyItem) {
                historyItem.current_episode = episode;
                historyItem.progress = percentage;
                historyItem.watch_time = Date.now();

                // 更新播放时长（如果提供了的话）
                if (playDuration !== null && playDuration > 0) {
                    historyItem.play_duration = playDuration;
                }

                localStorage.setItem(this.STORAGE_KEYS.PLAY_HISTORY, JSON.stringify(history));
            }
        } catch (error) {
            console.error('[STORAGE] 更新历史进度失败:', error);
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
        const favorites = this.getFavorites();

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
                const { size } = new Blob([data]);
                usage[key] = {
                    size,
                    sizeText: this.formatBytes(size)
                };
                totalSize += size;
            }
        });

        // 检查其他数据
        const favorites = localStorage.getItem('favorites');
        if (favorites) {
            const { size } = new Blob([favorites]);
            usage.favorites = {
                size,
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
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    // 获取线路别名配置
    getRouteAliases() {
        const aliases = localStorage.getItem(this.STORAGE_KEYS.ROUTE_ALIASES);
        return aliases ? JSON.parse(aliases) : {};
    }

    // 保存线路别名配置
    saveRouteAliases(aliases) {
        localStorage.setItem(this.STORAGE_KEYS.ROUTE_ALIASES, JSON.stringify(aliases));
    }

    // 获取线路别名
    getRouteAlias(routeName) {
        const aliases = this.getRouteAliases();
        return aliases[routeName] || routeName;
    }

    // 设置线路别名
    setRouteAlias(routeName, alias) {
        const aliases = this.getRouteAliases();
        aliases[routeName] = alias;
        this.saveRouteAliases(aliases);
    }

    // 删除线路别名
    removeRouteAlias(routeName) {
        const aliases = this.getRouteAliases();
        delete aliases[routeName];
        this.saveRouteAliases(aliases);
    }

    // 获取所有已设置的线路别名
    getAllRouteAliases() {
        return this.getRouteAliases();
    }

    // ==================== 数据导入导出功能 ====================

    // 导出所有配置数据
    exportAllData() {
        try {
            const exportData = {
                // 导出时间戳和版本信息
                exportInfo: {
                    timestamp: Date.now(),
                    date: new Date().toLocaleString('zh-CN'),
                    version: '1.1.0',
                    appName: '七星追剧'
                },

                // 站点配置
                sites: JSON.parse(localStorage.getItem(this.STORAGE_KEYS.VIDEO_SITES) || '[]'),

                // 线路别名
                routeAliases: JSON.parse(localStorage.getItem(this.STORAGE_KEYS.ROUTE_ALIASES) || '{}'),

                // 用户设置
                userSettings: JSON.parse(localStorage.getItem(this.STORAGE_KEYS.USER_SETTINGS) || '{}'),

                // 播放历史（可选，用户可以选择是否包含）
                playHistory: JSON.parse(localStorage.getItem(this.STORAGE_KEYS.PLAY_HISTORY) || '[]'),

                // 观看进度
                watchProgress: JSON.parse(localStorage.getItem(this.STORAGE_KEYS.WATCH_PROGRESS) || '{}')
            };

            console.log('[STORAGE] 准备导出数据:', exportData);
            return exportData;
        } catch (error) {
            console.error('[STORAGE] 导出数据失败:', error);
            throw new Error(`导出数据失败: ${error.message}`);
        }
    }

    // 导入配置数据
    importAllData(importData, options = {}) {
        try {
            console.log('[STORAGE] ========== 开始导入配置 ==========');
            console.log('[STORAGE] 导入数据:', importData);
            console.log('[STORAGE] 导入选项:', options);

            // 验证数据格式
            if (!importData || typeof importData !== 'object') {
                throw new Error('导入数据格式无效');
            }

            // 检测并转换特殊格式（如主站信息格式）
            importData = this.convertSpecialFormats(importData);

            // 创建导入前备份（用于撤销）
            const backupKey = this.createPreImportBackup();

            const results = {
                success: true,
                imported: [],
                skipped: [],
                overwritten: [],
                errors: [],
                backupKey,
                details: {
                    sites: { imported: 0, skipped: 0, overwritten: 0 },
                    routeAliases: { imported: 0, skipped: 0, overwritten: 0 },
                    userSettings: { imported: 0, skipped: 0, overwritten: 0 },
                    playHistory: { imported: 0, skipped: 0, overwritten: 0 },
                    watchProgress: { imported: 0, skipped: 0, overwritten: 0 }
                }
            };

            // 获取覆盖重复配置选项
            const overwriteDuplicates = options.overwriteDuplicates || false;
            console.log('[STORAGE] 覆盖重复配置:', overwriteDuplicates);

            // 导入站点配置
            if (importData.sites && Array.isArray(importData.sites)) {
                const siteResult = this.importSites(importData.sites, overwriteDuplicates);
                results.details.sites = siteResult.stats;
                
                if (siteResult.imported.length > 0) {
                    results.imported.push(`站点配置: 新增 ${siteResult.imported.length} 个`);
                }
                if (siteResult.overwritten.length > 0) {
                    results.overwritten.push(`站点配置: 覆盖 ${siteResult.overwritten.length} 个`);
                }
                if (siteResult.skipped.length > 0) {
                    results.skipped.push(`站点配置: 跳过 ${siteResult.skipped.length} 个重复项`);
                }
                
                console.log('[STORAGE] 站点导入结果:', siteResult);
            }

            // 导入线路别名
            if (importData.routeAliases && typeof importData.routeAliases === 'object') {
                const aliasResult = this.importRouteAliases(importData.routeAliases, overwriteDuplicates);
                results.details.routeAliases = aliasResult.stats;
                
                if (aliasResult.imported.length > 0) {
                    results.imported.push(`线路别名: 新增 ${aliasResult.imported.length} 个`);
                }
                if (aliasResult.overwritten.length > 0) {
                    results.overwritten.push(`线路别名: 覆盖 ${aliasResult.overwritten.length} 个`);
                }
                if (aliasResult.skipped.length > 0) {
                    results.skipped.push(`线路别名: 跳过 ${aliasResult.skipped.length} 个重复项`);
                }
            }

            // 导入用户设置
            if (importData.userSettings && typeof importData.userSettings === 'object') {
                const settingsResult = this.importUserSettings(importData.userSettings, overwriteDuplicates);
                results.details.userSettings = settingsResult.stats;
                
                if (settingsResult.imported.length > 0) {
                    results.imported.push(`用户设置: 新增 ${settingsResult.imported.length} 项`);
                }
                if (settingsResult.overwritten.length > 0) {
                    results.overwritten.push(`用户设置: 覆盖 ${settingsResult.overwritten.length} 项`);
                }
            }

            // 导入播放历史（可选）
            if (options.importHistory && importData.playHistory && Array.isArray(importData.playHistory)) {
                const historyResult = this.importPlayHistory(importData.playHistory, overwriteDuplicates);
                results.details.playHistory = historyResult.stats;
                
                if (historyResult.imported.length > 0) {
                    results.imported.push(`播放历史: 新增 ${historyResult.imported.length} 条`);
                }
                if (historyResult.overwritten.length > 0) {
                    results.overwritten.push(`播放历史: 覆盖 ${historyResult.overwritten.length} 条`);
                }
                if (historyResult.skipped.length > 0) {
                    results.skipped.push(`播放历史: 跳过 ${historyResult.skipped.length} 条重复项`);
                }
            } else if (importData.playHistory) {
                results.skipped.push(`播放历史: ${importData.playHistory.length} 条（用户选择跳过）`);
            }

            // 导入观看进度（可选）
            if (options.importProgress && importData.watchProgress && typeof importData.watchProgress === 'object') {
                const progressResult = this.importWatchProgress(importData.watchProgress, overwriteDuplicates);
                results.details.watchProgress = progressResult.stats;
                
                if (progressResult.imported.length > 0) {
                    results.imported.push(`观看进度: 新增 ${progressResult.imported.length} 个`);
                }
                if (progressResult.overwritten.length > 0) {
                    results.overwritten.push(`观看进度: 覆盖 ${progressResult.overwritten.length} 个`);
                }
            } else if (importData.watchProgress) {
                results.skipped.push(`观看进度: ${Object.keys(importData.watchProgress).length} 个（用户选择跳过）`);
            }

            console.log('[STORAGE] ========== 导入完成 ==========');
            console.log('[STORAGE] 导入结果:', results);
            return results;
        } catch (error) {
            console.error('[STORAGE] 导入数据失败:', error);
            throw new Error(`导入数据失败: ${error.message}`);
        }
    }

    // 创建导入前备份
    createPreImportBackup() {
        const backupKey = `pre_import_backup_${Date.now()}`;
        const backupData = {
            sites: JSON.parse(localStorage.getItem(this.STORAGE_KEYS.VIDEO_SITES) || '[]'),
            routeAliases: JSON.parse(localStorage.getItem(this.STORAGE_KEYS.ROUTE_ALIASES) || '{}'),
            userSettings: JSON.parse(localStorage.getItem(this.STORAGE_KEYS.USER_SETTINGS) || '{}'),
            playHistory: JSON.parse(localStorage.getItem(this.STORAGE_KEYS.PLAY_HISTORY) || '[]'),
            watchProgress: JSON.parse(localStorage.getItem(this.STORAGE_KEYS.WATCH_PROGRESS) || '{}'),
            backupTime: Date.now()
        };
        
        localStorage.setItem(backupKey, JSON.stringify(backupData));
        console.log('[STORAGE] 已创建导入前备份:', backupKey);
        
        // 清理旧备份，保留最近10个
        this.cleanupImportBackups();
        
        return backupKey;
    }

    // 清理旧的导入备份
    cleanupImportBackups() {
        try {
            const backupKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('pre_import_backup_')) {
                    backupKeys.push(key);
                }
            }

            // 按时间戳排序，保留最近的10个备份
            backupKeys.sort().reverse();
            const keysToDelete = backupKeys.slice(10);

            keysToDelete.forEach(key => {
                localStorage.removeItem(key);
                console.log('[STORAGE] 已清理旧备份:', key);
            });
        } catch (error) {
            console.warn('[STORAGE] 清理备份失败:', error);
        }
    }

    // 撤销导入（恢复备份）
    undoImport(backupKey) {
        try {
            const backupData = localStorage.getItem(backupKey);
            if (!backupData) {
                throw new Error('备份不存在或已过期');
            }

            const data = JSON.parse(backupData);
            
            // 恢复所有配置
            localStorage.setItem(this.STORAGE_KEYS.VIDEO_SITES, JSON.stringify(data.sites));
            localStorage.setItem(this.STORAGE_KEYS.ROUTE_ALIASES, JSON.stringify(data.routeAliases));
            localStorage.setItem(this.STORAGE_KEYS.USER_SETTINGS, JSON.stringify(data.userSettings));
            localStorage.setItem(this.STORAGE_KEYS.PLAY_HISTORY, JSON.stringify(data.playHistory));
            localStorage.setItem(this.STORAGE_KEYS.WATCH_PROGRESS, JSON.stringify(data.watchProgress));

            console.log('[STORAGE] 已撤销导入，恢复到备份状态');
            return true;
        } catch (error) {
            console.error('[STORAGE] 撤销导入失败:', error);
            return false;
        }
    }

    // 导入站点配置
    importSites(newSites, overwriteDuplicates) {
        const existingSites = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.VIDEO_SITES) || '[]');
        const result = {
            imported: [],
            skipped: [],
            overwritten: [],
            stats: { imported: 0, skipped: 0, overwritten: 0 }
        };

        // 创建现有站点的映射（基于URL作为唯一标识）
        const existingSiteMap = new Map();
        existingSites.forEach(site => {
            const key = site.url || site.api || site.id;
            if (key) {
                existingSiteMap.set(key, site);
            }
        });

        const mergedSites = [...existingSites];

        newSites.forEach(newSite => {
            // 规范化站点数据
            // 确保 type 字段是字符串
            if (!newSite.type || typeof newSite.type !== 'string') {
                newSite.type = 'json';
            }
            // 确保 url 字段存在
            if (!newSite.url && newSite.api) {
                newSite.url = newSite.api;
            }
            if (!newSite.url && newSite.ext && typeof newSite.ext === 'string' && newSite.ext.startsWith('http')) {
                newSite.url = newSite.ext;
            }

            const siteKey = newSite.url || newSite.api || newSite.id;
            const siteName = newSite.name || '未命名站点';

            if (!siteKey) {
                console.warn('[STORAGE] 跳过无效站点（缺少标识）:', newSite);
                return;
            }

            if (existingSiteMap.has(siteKey)) {
                // 存在重复站点
                if (overwriteDuplicates) {
                    // 覆盖模式：替换现有站点
                    const index = mergedSites.findIndex(s => (s.url || s.api || s.id) === siteKey);
                    if (index !== -1) {
                        // 保留原站点的active状态
                        newSite.active = mergedSites[index].active;
                        mergedSites[index] = { ...newSite };
                        result.overwritten.push(siteName);
                        result.stats.overwritten++;
                        console.log(`[STORAGE] 覆盖站点: ${siteName}`);
                    }
                } else {
                    // 跳过模式：保留现有站点
                    result.skipped.push(siteName);
                    result.stats.skipped++;
                    console.log(`[STORAGE] 跳过重复站点: ${siteName}`);
                }
            } else {
                // 新站点，添加到列表
                if (!newSite.id || typeof newSite.id !== 'string') {
                    newSite.id = `imported_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                }
                if (typeof newSite.active === 'undefined') {
                    newSite.active = false;
                }
                mergedSites.push(newSite);
                existingSiteMap.set(siteKey, newSite);
                result.imported.push(siteName);
                result.stats.imported++;
                console.log(`[STORAGE] 新增站点: ${siteName}`);
            }
        });

        localStorage.setItem(this.STORAGE_KEYS.VIDEO_SITES, JSON.stringify(mergedSites));
        console.log('[STORAGE] 站点数据已保存到 localStorage，键:', this.STORAGE_KEYS.VIDEO_SITES);
        console.log('[STORAGE] 保存的站点数量:', mergedSites.length);
        
        // 验证保存结果
        const savedSites = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.VIDEO_SITES) || '[]');
        console.log('[STORAGE] 验证保存结果，读取到站点数量:', savedSites.length);
        
        return result;
    }

    // 导入线路别名
    importRouteAliases(newAliases, overwriteDuplicates) {
        const existingAliases = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.ROUTE_ALIASES) || '{}');
        const result = {
            imported: [],
            skipped: [],
            overwritten: [],
            stats: { imported: 0, skipped: 0, overwritten: 0 }
        };

        Object.entries(newAliases).forEach(([routeName, alias]) => {
            if (existingAliases.hasOwnProperty(routeName)) {
                if (overwriteDuplicates) {
                    existingAliases[routeName] = alias;
                    result.overwritten.push(routeName);
                    result.stats.overwritten++;
                } else {
                    result.skipped.push(routeName);
                    result.stats.skipped++;
                }
            } else {
                existingAliases[routeName] = alias;
                result.imported.push(routeName);
                result.stats.imported++;
            }
        });

        localStorage.setItem(this.STORAGE_KEYS.ROUTE_ALIASES, JSON.stringify(existingAliases));
        return result;
    }

    // 导入用户设置
    importUserSettings(newSettings, overwriteDuplicates) {
        const existingSettings = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.USER_SETTINGS) || '{}');
        const result = {
            imported: [],
            skipped: [],
            overwritten: [],
            stats: { imported: 0, skipped: 0, overwritten: 0 }
        };

        Object.entries(newSettings).forEach(([key, value]) => {
            if (existingSettings.hasOwnProperty(key)) {
                if (overwriteDuplicates) {
                    existingSettings[key] = value;
                    result.overwritten.push(key);
                    result.stats.overwritten++;
                } else {
                    result.skipped.push(key);
                    result.stats.skipped++;
                }
            } else {
                existingSettings[key] = value;
                result.imported.push(key);
                result.stats.imported++;
            }
        });

        localStorage.setItem(this.STORAGE_KEYS.USER_SETTINGS, JSON.stringify(existingSettings));
        return result;
    }

    // 导入播放历史
    importPlayHistory(newHistory, overwriteDuplicates) {
        const existingHistory = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.PLAY_HISTORY) || '[]');
        const result = {
            imported: [],
            skipped: [],
            overwritten: [],
            stats: { imported: 0, skipped: 0, overwritten: 0 }
        };

        // 创建现有历史的映射（基于vod_id和site_url作为唯一标识）
        const existingMap = new Map();
        existingHistory.forEach(item => {
            const key = `${item.vod_id}_${item.site_url || ''}`;
            existingMap.set(key, item);
        });

        const mergedHistory = [...existingHistory];

        newHistory.forEach(newItem => {
            if (!newItem.vod_id) return;

            const key = `${newItem.vod_id}_${newItem.site_url || ''}`;
            const itemName = newItem.vod_name || `视频${newItem.vod_id}`;

            if (existingMap.has(key)) {
                if (overwriteDuplicates) {
                    const index = mergedHistory.findIndex(h => 
                        h.vod_id === newItem.vod_id && (h.site_url || '') === (newItem.site_url || '')
                    );
                    if (index !== -1) {
                        mergedHistory[index] = { ...newItem };
                        result.overwritten.push(itemName);
                        result.stats.overwritten++;
                    }
                } else {
                    result.skipped.push(itemName);
                    result.stats.skipped++;
                }
            } else {
                mergedHistory.unshift(newItem);
                existingMap.set(key, newItem);
                result.imported.push(itemName);
                result.stats.imported++;
            }
        });

        // 按时间排序，限制数量
        mergedHistory.sort((a, b) => (b.watch_time || 0) - (a.watch_time || 0));
        const limitedHistory = mergedHistory.slice(0, 200);

        localStorage.setItem(this.STORAGE_KEYS.PLAY_HISTORY, JSON.stringify(limitedHistory));
        return result;
    }

    // 导入观看进度
    importWatchProgress(newProgress, overwriteDuplicates) {
        const existingProgress = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.WATCH_PROGRESS) || '{}');
        const result = {
            imported: [],
            skipped: [],
            overwritten: [],
            stats: { imported: 0, skipped: 0, overwritten: 0 }
        };

        Object.entries(newProgress).forEach(([key, value]) => {
            if (existingProgress.hasOwnProperty(key)) {
                if (overwriteDuplicates) {
                    existingProgress[key] = value;
                    result.overwritten.push(key);
                    result.stats.overwritten++;
                } else {
                    result.skipped.push(key);
                    result.stats.skipped++;
                }
            } else {
                existingProgress[key] = value;
                result.imported.push(key);
                result.stats.imported++;
            }
        });

        localStorage.setItem(this.STORAGE_KEYS.WATCH_PROGRESS, JSON.stringify(existingProgress));
        return result;
    }

    // 合并站点数据，避免重复
    mergeSites(existingSites, newSites) {
        const mergedSites = [...existingSites];

        // 创建已存在的站点标识集合
        const existingKeys = new Set();
        existingSites.forEach(site => {
            // 使用 url 或 api 作为唯一标识
            const key = site.url || site.api || site.id;
            if (key) existingKeys.add(key);
        });

        newSites.forEach((newSite, index) => {
            // 使用 url 或 api 作为唯一标识
            const newKey = newSite.url || newSite.api || newSite.id;

            // 如果新站点没有 url 字段但有 api 字段，则设置 url
            if (!newSite.url && newSite.api) {
                newSite.url = newSite.api;
            }

            // 如果新站点没有 url 也没有 api，但有 ext（规则配置URL）
            if (!newSite.url && newSite.ext && typeof newSite.ext === 'string' && newSite.ext.startsWith('http')) {
                newSite.url = newSite.ext;
            }

            if (!newKey || !existingKeys.has(newKey)) {
                // 确保新站点有正确的字段和ID格式
                if (!newSite.id || typeof newSite.id !== 'string') {
                    newSite.id = `merged_${Date.now()}_${index}`;
                }
                if (typeof newSite.active === 'undefined') {
                    newSite.active = false;
                }
                mergedSites.push(newSite);
                console.log(`[STORAGE] 合并站点: ${newSite.name} (url: ${newSite.url}, type: ${newSite.type})`);
            } else {
                console.log(`[STORAGE] 跳过重复站点: ${newSite.name} (key: ${newKey})`);
            }
        });

        return mergedSites;
    }

    // 合并播放历史，避免重复
    mergeHistory(existingHistory, newHistory) {
        const mergedHistory = [...existingHistory];
        const existingIds = new Set(existingHistory.map(item => item.vod_id));

        newHistory.forEach(newItem => {
            if (!existingIds.has(newItem.vod_id)) {
                mergedHistory.push(newItem);
            }
        });

        // 按时间排序，限制数量
        mergedHistory.sort((a, b) => b.watch_time - a.watch_time);
        return mergedHistory.slice(0, 200); // 最多保留200条记录
    }

    // 验证导入数据的完整性
    validateImportData(data) {
        console.log('[STORAGE] 开始验证导入数据:', data);
        const errors = [];

        if (!data || typeof data !== 'object') {
            errors.push('数据格式无效');
            console.log('[STORAGE] 验证结果: 数据格式无效');
            return { isValid: false, errors };
        }

        // 检测并转换特殊格式
        const convertedData = this.convertSpecialFormats(data);
        console.log('[STORAGE] 转换后的数据:', convertedData);

        // 检查导出信息（对于标准格式）
        if (!convertedData.exportInfo && !convertedData.站点 && !convertedData.sites) {
            console.log('[STORAGE] 验证结果: 缺少导出信息');
            // 不直接返回错误，而是添加警告
            errors.push('缺少导出信息，可能不是有效的配置文件');
            console.log('[STORAGE] 警告: 缺少导出信息');
        }
        // 检查站点数据
        if (convertedData.sites && !Array.isArray(convertedData.sites)) {
            errors.push('站点数据格式无效');
            console.log('[STORAGE] 验证结果: 站点数据格式无效');
        }
        // 检查线路别名数据
        if (convertedData.routeAliases && typeof convertedData.routeAliases !== 'object') {
            errors.push('线路别名数据格式无效');
            console.log('[STORAGE] 验证结果: 线路别名数据格式无效');
        }
        const isValid = errors.length === 0;
        console.log('[STORAGE] 最终验证结果: isValid=', isValid, 'errors=', errors);

        return {
            isValid,
            errors,
            warnings: this.getImportWarnings(convertedData),
            convertedData // 返回转换后的数据
        };
    }

    // 获取导入警告信息
    getImportWarnings(data) {
        const warnings = [];

        if (data.playHistory && data.playHistory.length > 100) {
            warnings.push(`播放历史包含 ${data.playHistory.length} 条记录，建议选择性导入`);
        }

        if (data.sites && data.sites.length > 20) {
            warnings.push(`站点配置包含 ${data.sites.length} 个站点，可能影响性能`);
        }

        // 如果检测到是从主站信息格式转换的，添加相应提示
        if (data.exportInfo && data.exportInfo.source && data.exportInfo.source.includes('主站信息格式转换')) {
            warnings.push('检测到主站信息格式，已自动转换为站点配置（仅导入站点信息）');
        }

        return warnings;
    }

    // 转换特殊格式的数据（如主站信息格式）
    convertSpecialFormats(data) {
        // 检测是否为主站信息格式
        if (data.站点 && Array.isArray(data.站点)) {
            console.log('[STORAGE] 检测到主站信息格式，开始转换...');
            return this.convertMainSiteFormat(data);
        }

        return data; // 如果不是特殊格式，返回原数据
    }

    // 转换主站信息格式
    convertMainSiteFormat(data) {
        const convertedData = {
            exportInfo: {
                appName: '七星追剧',
                version: '1.1.0',
                exportTime: new Date().toISOString(),
                source: '主站信息格式转换 - 仅导入站点配置'
            },
            sites: [],
            // 不导入播放器和接口信息，只专注于站点数据
            routeAliases: {},
            userSettings: {}
        };

        // 转换站点数据
        if (data.站点 && Array.isArray(data.站点)) {
            data.站点.forEach((site, index) => {
                try {
                    // 过滤掉无效的站点数据
                    if (!site.标题 || (!site.列表 && !site.详情)) {
                        console.warn('[STORAGE] 跳过无效站点数据:', site);
                        return;
                    }

                    // 获取API地址，优先使用列表地址，如果没有则使用详情地址
                    const apiUrl = site.列表 || site.详情;

                    const convertedSite = {
                        id: `imported_${Date.now()}_${index}`, // 生成字符串格式的唯一ID
                        name: site.标题,
                        url: apiUrl,
                        type: 'json', // 强制设置为JSON格式，不使用detectSiteType
                        enabled: true,
                        active: false, // 添加active字段，默认为false
                        addTime: Date.now(),
                        description: '从主站信息导入 - JSON格式'
                    };

                    convertedData.sites.push(convertedSite);
                    console.log(`[STORAGE] 强制转换站点为JSON: ${convertedSite.name} -> ${convertedSite.url} (type: ${convertedSite.type})`);
                } catch (error) {
                    console.error('[STORAGE] 站点转换失败:', site, error);
                }
            });
        }

        // 不导入播放器和接口配置，保持简洁
        console.log(`[STORAGE] 主站信息格式转换完成，共转换 ${convertedData.sites.length} 个站点`);
        console.log(`[STORAGE] 所有站点已强制设置为JSON格式，已忽略播放器配置 ${data.播放器?.length || 0} 个，解析接口 ${data.接口?.length || 0} 个`);

        return convertedData;
    }

    // 检测站点类型
    detectSiteType(site) {
        const url = site.列表 || site.详情 || '';
        const title = site.标题 || '';

        // 根据标题前缀判断站点类别
        if (title.startsWith('[P]')) {
            return 'standard'; // 标准影视站点
        } else if (title.startsWith('[A]')) {
            return 'adult'; // 成人站点
        }

        // 根据URL特征和类型字段判断API格式
        if (url.includes('api.php/provide/vod')) {
            // 类型为"1"表示JSON API，"2"表示XML API
            return site.类型 === '1' || site.类型 === 1 ? 'json' : 'xml';
        }

        // 根据URL特征进一步判断
        if (url.includes('/api.php') || url.includes('provide/vod')) {
            return 'json'; // 默认为JSON格式
        }

        return 'unknown';
    }
}

// 导出存储服务实例（兼容浏览器全局和 CommonJS）
if (typeof window !== 'undefined') {
    window.StorageService = StorageService;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StorageService };
}
