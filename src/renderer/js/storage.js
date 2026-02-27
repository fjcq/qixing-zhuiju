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
        const history = localStorage.getItem(this.STORAGE_KEYS.PLAY_HISTORY);
        const parsedHistory = history ? JSON.parse(history) : [];

        return parsedHistory;
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

            // 获取站点名称 - 从站点URL或传入的站点名称
            let siteName = '未知站点';
            const siteUrl = videoData.site_url || '';

            // 如果有站点URL，尝试从已保存的站点中获取名称
            if (siteUrl) {
                // 从localStorage获取站点列表 - 使用正确的键名
                const sites = JSON.parse(localStorage.getItem('video_sites') || '[]');
                const site = sites.find(s => s.url === siteUrl);
                if (site && site.name) {
                    siteName = site.name;
                }
            }

            // 如果直接传入了站点名称，优先使用
            if (videoData.siteName) {
                siteName = videoData.siteName;
            }

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

        // 同时更新播放历史中的进度和播放时长
        this.updateHistoryProgress(vodId, episode, percentage, Math.round(currentTime));
    }

    // 更新历史记录中的进度
    updateHistoryProgress(vodId, episode, percentage, playDuration = null) {
        let history = this.getPlayHistory();
        const historyItem = history.find(item => item.vod_id === vodId);

        if (historyItem) {
            historyItem.current_episode = episode;
            historyItem.progress = percentage;
            historyItem.watch_time = Date.now();

            // 更新播放时长（如果提供了的话）
            if (playDuration !== null && playDuration > 0) {
                historyItem.play_duration = playDuration;
                console.log('[STORAGE] 更新播放历史时长:', {
                    vodId,
                    episode,
                    playDuration,
                    vodName: historyItem.vod_name
                });
            }

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
            throw new Error('导出数据失败: ' + error.message);
        }
    }

    // 导入配置数据
    importAllData(importData, options = {}) {
        try {
            console.log('[STORAGE] 开始导入数据:', importData);

            // 验证数据格式
            if (!importData || typeof importData !== 'object') {
                throw new Error('导入数据格式无效');
            }

            // 检测并转换特殊格式（如主站信息格式）
            importData = this.convertSpecialFormats(importData);

            const results = {
                success: true,
                imported: [],
                skipped: [],
                errors: []
            };

            // 导入站点配置
            if (importData.sites && Array.isArray(importData.sites)) {
                try {
                    // 对于从主站信息格式转换的数据，再次确保所有站点类型为json
                    if (importData.exportInfo && importData.exportInfo.source &&
                        importData.exportInfo.source.includes('主站信息格式转换')) {
                        importData.sites.forEach(site => {
                            site.type = 'json'; // 强制确保类型为json
                            console.log(`[STORAGE] 确认站点类型: ${site.name} -> ${site.type}`);
                        });
                    }

                    if (options.overwriteSites) {
                        localStorage.setItem(this.STORAGE_KEYS.VIDEO_SITES, JSON.stringify(importData.sites));
                        results.imported.push(`站点配置 (${importData.sites.length} 个站点)`);
                        console.log('[STORAGE] 覆盖模式保存站点数据:', importData.sites.length, '个站点');
                    } else {
                        // 合并站点，避免重复
                        const existingSites = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.VIDEO_SITES) || '[]');
                        const mergedSites = this.mergeSites(existingSites, importData.sites);
                        localStorage.setItem(this.STORAGE_KEYS.VIDEO_SITES, JSON.stringify(mergedSites));
                        results.imported.push(`站点配置 (合并 ${importData.sites.length} 个站点)`);
                        console.log('[STORAGE] 合并模式保存站点数据:', mergedSites);
                    }

                    // 验证数据是否正确保存
                    const savedSites = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.VIDEO_SITES) || '[]');
                    console.log('[STORAGE] 验证保存结果，站点总数:', savedSites.length);
                    savedSites.forEach(site => {
                        console.log(`[STORAGE] 验证站点: ${site.name} (url: ${site.url}, type: ${site.type}, active: ${site.active})`);
                    });
                } catch (error) {
                    results.errors.push('站点配置导入失败: ' + error.message);
                }
            }

            // 导入线路别名
            if (importData.routeAliases && typeof importData.routeAliases === 'object') {
                try {
                    if (options.overwriteAliases) {
                        localStorage.setItem(this.STORAGE_KEYS.ROUTE_ALIASES, JSON.stringify(importData.routeAliases));
                        results.imported.push(`线路别名 (${Object.keys(importData.routeAliases).length} 个别名)`);
                    } else {
                        // 合并别名
                        const existingAliases = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.ROUTE_ALIASES) || '{}');
                        const mergedAliases = { ...existingAliases, ...importData.routeAliases };
                        localStorage.setItem(this.STORAGE_KEYS.ROUTE_ALIASES, JSON.stringify(mergedAliases));
                        results.imported.push(`线路别名 (合并 ${Object.keys(importData.routeAliases).length} 个别名)`);
                    }
                } catch (error) {
                    results.errors.push('线路别名导入失败: ' + error.message);
                }
            }

            // 导入用户设置
            if (importData.userSettings && typeof importData.userSettings === 'object') {
                try {
                    if (options.overwriteSettings) {
                        localStorage.setItem(this.STORAGE_KEYS.USER_SETTINGS, JSON.stringify(importData.userSettings));
                        results.imported.push('用户设置');
                    } else {
                        const existingSettings = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.USER_SETTINGS) || '{}');
                        const mergedSettings = { ...existingSettings, ...importData.userSettings };
                        localStorage.setItem(this.STORAGE_KEYS.USER_SETTINGS, JSON.stringify(mergedSettings));
                        results.imported.push('用户设置 (合并)');
                    }
                } catch (error) {
                    results.errors.push('用户设置导入失败: ' + error.message);
                }
            }

            // 导入播放历史（可选）
            if (options.importHistory && importData.playHistory && Array.isArray(importData.playHistory)) {
                try {
                    if (options.overwriteHistory) {
                        localStorage.setItem(this.STORAGE_KEYS.PLAY_HISTORY, JSON.stringify(importData.playHistory));
                        results.imported.push(`播放历史 (${importData.playHistory.length} 条记录)`);
                    } else {
                        const existingHistory = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.PLAY_HISTORY) || '[]');
                        const mergedHistory = this.mergeHistory(existingHistory, importData.playHistory);
                        localStorage.setItem(this.STORAGE_KEYS.PLAY_HISTORY, JSON.stringify(mergedHistory));
                        results.imported.push(`播放历史 (合并 ${importData.playHistory.length} 条记录)`);
                    }
                } catch (error) {
                    results.errors.push('播放历史导入失败: ' + error.message);
                }
            } else if (importData.playHistory) {
                results.skipped.push(`播放历史 (${importData.playHistory.length} 条记录，用户选择跳过)`);
            }

            // 导入观看进度（可选）
            if (options.importProgress && importData.watchProgress && typeof importData.watchProgress === 'object') {
                try {
                    if (options.overwriteProgress) {
                        localStorage.setItem(this.STORAGE_KEYS.WATCH_PROGRESS, JSON.stringify(importData.watchProgress));
                        results.imported.push(`观看进度 (${Object.keys(importData.watchProgress).length} 个进度)`);
                    } else {
                        const existingProgress = JSON.parse(localStorage.getItem(this.STORAGE_KEYS.WATCH_PROGRESS) || '{}');
                        const mergedProgress = { ...existingProgress, ...importData.watchProgress };
                        localStorage.setItem(this.STORAGE_KEYS.WATCH_PROGRESS, JSON.stringify(mergedProgress));
                        results.imported.push(`观看进度 (合并 ${Object.keys(importData.watchProgress).length} 个进度)`);
                    }
                } catch (error) {
                    results.errors.push('观看进度导入失败: ' + error.message);
                }
            } else if (importData.watchProgress) {
                results.skipped.push(`观看进度 (${Object.keys(importData.watchProgress).length} 个进度，用户选择跳过)`);
            }

            console.log('[STORAGE] 数据导入完成:', results);
            return results;
        } catch (error) {
            console.error('[STORAGE] 导入数据失败:', error);
            throw new Error('导入数据失败: ' + error.message);
        }
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
        const errors = [];

        if (!data || typeof data !== 'object') {
            errors.push('数据格式无效');
            return { isValid: false, errors };
        }

        // 检测并转换特殊格式
        const convertedData = this.convertSpecialFormats(data);

        // 检查导出信息（对于标准格式）
        if (!convertedData.exportInfo && !convertedData.站点 && !convertedData.sites) {
            errors.push('缺少导出信息，可能不是有效的配置文件');
        }

        // 检查站点数据
        if (convertedData.sites && !Array.isArray(convertedData.sites)) {
            errors.push('站点数据格式无效');
        }

        // 检查线路别名数据
        if (convertedData.routeAliases && typeof convertedData.routeAliases !== 'object') {
            errors.push('线路别名数据格式无效');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings: this.getImportWarnings(convertedData),
            convertedData: convertedData // 返回转换后的数据
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
            warnings.push(`检测到主站信息格式，已自动转换为站点配置（仅导入站点信息）`);
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
                        description: `从主站信息导入 - JSON格式`
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

// 导出存储服务实例
window.StorageService = StorageService;
