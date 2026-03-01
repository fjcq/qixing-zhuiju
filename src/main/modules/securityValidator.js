/**
 * IPC安全验证工具
 * 提供输入验证、URL验证和数据清理功能
 */

/**
 * URL验证器
 * 检查URL是否为有效的HTTP/HTTPS URL
 * @param {string} url - 待验证的URL
 * @returns {boolean} 是否有效
 */
function isValidUrl(url) {
    if (typeof url !== 'string') return false;
    if (url.length === 0 || url.length > 2048) return false;

    try {
        const urlObj = new URL(url);
        // 只允许http和https协议
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * 安全URL验证器
 * 检查URL是否为安全的视频/图片资源URL
 * @param {string} url - 待验证的URL
 * @returns {{valid: boolean, error?: string}} 验证结果
 */
function validateMediaUrl(url) {
    if (!url) {
        return { valid: false, error: 'URL不能为空' };
    }

    if (typeof url !== 'string') {
        return { valid: false, error: 'URL必须是字符串' };
    }

    if (url.length > 2048) {
        return { valid: false, error: 'URL长度超过限制' };
    }

    // 检查危险协议
    const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
    const lowerUrl = url.toLowerCase().trim();

    for (const protocol of dangerousProtocols) {
        if (lowerUrl.startsWith(protocol)) {
            return { valid: false, error: `不允许的协议: ${protocol}` };
        }
    }

    // 验证URL格式
    if (!isValidUrl(url)) {
        return { valid: false, error: '无效的URL格式' };
    }

    return { valid: true };
}

/**
 * 设备ID验证器
 * @param {string} deviceId - 设备ID
 * @returns {{valid: boolean, error?: string}} 验证结果
 */
function validateDeviceId(deviceId) {
    if (!deviceId) {
        return { valid: false, error: '设备ID不能为空' };
    }

    if (typeof deviceId !== 'string') {
        return { valid: false, error: '设备ID必须是字符串' };
    }

    if (deviceId.length > 256) {
        return { valid: false, error: '设备ID长度超过限制' };
    }

    // 设备ID应该是UUID格式或类似的安全字符串
    const safePattern = /^[a-zA-Z0-9\-_:]+$/;
    if (!safePattern.test(deviceId)) {
        return { valid: false, error: '设备ID包含非法字符' };
    }

    return { valid: true };
}

/**
 * 视频数据验证器
 * @param {object} videoData - 视频数据对象
 * @returns {{valid: boolean, error?: string, sanitized?: object}} 验证结果
 */
function validateVideoData(videoData) {
    if (!videoData || typeof videoData !== 'object') {
        return { valid: false, error: '无效的视频数据' };
    }

    const sanitized = { ...videoData };
    const errors = [];

    if (videoData.url) {
        const urlResult = validateMediaUrl(videoData.url);
        if (!urlResult.valid) {
            errors.push(`视频URL无效: ${urlResult.error}`);
        } else {
            sanitized.url = videoData.url.trim();
        }
    }

    if (videoData.title !== undefined) {
        if (typeof videoData.title !== 'string') {
            errors.push('标题必须是字符串');
        } else if (videoData.title.length > 500) {
            errors.push('标题长度超过限制');
        } else {
            sanitized.title = videoData.title.trim().substring(0, 500);
        }
    }

    if (videoData.poster !== undefined) {
        if (videoData.poster) {
            const posterResult = validateMediaUrl(videoData.poster);
            if (!posterResult.valid) {
                errors.push(`海报URL无效: ${posterResult.error}`);
            } else {
                sanitized.poster = videoData.poster.trim();
            }
        }
    }

    if (videoData.episodeIndex !== undefined) {
        const index = Number(videoData.episodeIndex);
        if (!Number.isInteger(index) || index < 0) {
            errors.push('集数索引必须是非负整数');
        } else {
            sanitized.episodeIndex = index;
        }
    }

    if (videoData.videoData !== undefined && typeof videoData.videoData === 'object') {
        sanitized.videoData = { ...videoData.videoData };

        if (videoData.videoData.vod_id !== undefined) {
            sanitized.videoData.vod_id = String(videoData.videoData.vod_id).substring(0, 100);
        }
        if (videoData.videoData.vod_name !== undefined) {
            sanitized.videoData.vod_name = String(videoData.videoData.vod_name).substring(0, 200);
        }
        if (videoData.videoData.vod_pic !== undefined) {
            sanitized.videoData.vod_pic = String(videoData.videoData.vod_pic).substring(0, 500);
        }
        if (videoData.videoData.currentRoute !== undefined) {
            sanitized.videoData.currentRoute = Number(videoData.videoData.currentRoute) || 0;
        }
        if (videoData.videoData.currentEpisode !== undefined) {
            sanitized.videoData.currentEpisode = Number(videoData.videoData.currentEpisode) || 0;
        }
        if (videoData.videoData.routes !== undefined && Array.isArray(videoData.videoData.routes)) {
            const MAX_ROUTES = 50;
            const MAX_EPISODES_PER_ROUTE = 500;
            const MAX_EPISODE_NAME_LENGTH = 100;
            const MAX_EPISODE_URL_LENGTH = 2000;

            sanitized.videoData.routes = videoData.videoData.routes
                .slice(0, MAX_ROUTES)
                .map(route => {
                    if (!route || typeof route !== 'object') {
                        return null;
                    }

                    const sanitizedRoute = {};

                    if (route.name !== undefined) {
                        sanitizedRoute.name = String(route.name).substring(0, 100);
                    }

                    if (route.episodes !== undefined && Array.isArray(route.episodes)) {
                        sanitizedRoute.episodes = route.episodes
                            .slice(0, MAX_EPISODES_PER_ROUTE)
                            .map(episode => {
                                if (!episode || typeof episode !== 'object') {
                                    return null;
                                }

                                const sanitizedEpisode = {};

                                if (episode.index !== undefined) {
                                    sanitizedEpisode.index = Number(episode.index) || 0;
                                }
                                if (episode.name !== undefined) {
                                    sanitizedEpisode.name = String(episode.name).substring(0, MAX_EPISODE_NAME_LENGTH);
                                }
                                if (episode.url !== undefined) {
                                    const episodeUrl = String(episode.url);
                                    if (episodeUrl.length <= MAX_EPISODE_URL_LENGTH) {
                                        sanitizedEpisode.url = episodeUrl;
                                    }
                                }

                                return Object.keys(sanitizedEpisode).length > 0 ? sanitizedEpisode : null;
                            })
                            .filter(episode => episode !== null);
                    }

                    return Object.keys(sanitizedRoute).length > 0 ? sanitizedRoute : null;
                })
                .filter(route => route !== null);
        }
        if (videoData.videoData.siteName !== undefined) {
            sanitized.videoData.siteName = String(videoData.videoData.siteName).substring(0, 100);
        }
        if (videoData.videoData.siteUrl !== undefined) {
            sanitized.videoData.siteUrl = String(videoData.videoData.siteUrl).substring(0, 500);
        }
    }

    if (videoData.resumeProgress !== undefined) {
        const progress = Number(videoData.resumeProgress);
        if (!isNaN(progress) && progress >= 0) {
            sanitized.resumeProgress = progress;
        }
    }

    if (errors.length > 0) {
        return { valid: false, error: errors.join('; ') };
    }

    return { valid: true, sanitized };
}

/**
 * 搜索关键词验证器
 * @param {string} keyword - 搜索关键词
 * @returns {{valid: boolean, error?: string, sanitized?: string}} 验证结果
 */
function validateSearchKeyword(keyword) {
    if (keyword === undefined || keyword === null) {
        return { valid: true, sanitized: '' };
    }

    if (typeof keyword !== 'string') {
        return { valid: false, error: '关键词必须是字符串' };
    }

    // 限制长度
    if (keyword.length > 100) {
        return { valid: false, error: '关键词长度超过限制' };
    }

    // 移除危险字符
    const sanitized = keyword
        .replace(/[<>"'\\]/g, '')
        .trim()
        .substring(0, 100);

    return { valid: true, sanitized };
}

/**
 * 分页参数验证器
 * @param {number} page - 页码
 * @param {number} pageSize - 每页数量
 * @returns {{valid: boolean, error?: string, sanitized?: {page: number, pageSize: number}}} 验证结果
 */
function validatePagination(page, pageSize) {
    const defaultPage = 1;
    const defaultPageSize = 20;
    const maxPageSize = 100;

    let sanitizedPage = defaultPage;
    let sanitizedPageSize = defaultPageSize;

    if (page !== undefined) {
        const numPage = Number(page);
        if (!Number.isInteger(numPage) || numPage < 1) {
            return { valid: false, error: '页码必须是正整数' };
        }
        sanitizedPage = Math.min(numPage, 10000); // 最大页数限制
    }

    if (pageSize !== undefined) {
        const numPageSize = Number(pageSize);
        if (!Number.isInteger(numPageSize) || numPageSize < 1) {
            return { valid: false, error: '每页数量必须是正整数' };
        }
        sanitizedPageSize = Math.min(numPageSize, maxPageSize);
    }

    return {
        valid: true,
        sanitized: {
            page: sanitizedPage,
            pageSize: sanitizedPageSize
        }
    };
}

/**
 * 站点数据验证器
 * @param {object} siteData - 站点数据
 * @returns {{valid: boolean, error?: string, sanitized?: object}} 验证结果
 */
function validateSiteData(siteData) {
    if (!siteData || typeof siteData !== 'object') {
        return { valid: false, error: '无效的站点数据' };
    }

    const errors = [];
    const sanitized = {};

    // 验证站点名称
    if (!siteData.name || typeof siteData.name !== 'string') {
        errors.push('站点名称不能为空');
    } else if (siteData.name.length > 100) {
        errors.push('站点名称长度超过限制');
    } else {
        sanitized.name = siteData.name.trim().substring(0, 100);
    }

    // 验证站点URL
    if (!siteData.url || typeof siteData.url !== 'string') {
        errors.push('站点URL不能为空');
    } else {
        const urlResult = isValidUrl(siteData.url);
        if (!urlResult) {
            errors.push('站点URL格式无效');
        } else {
            sanitized.url = siteData.url.trim();
        }
    }

    // 验证站点类型
    if (siteData.type !== undefined) {
        const validTypes = ['json', 'xml'];
        if (!validTypes.includes(siteData.type)) {
            errors.push(`站点类型必须是: ${validTypes.join(', ')}`);
        } else {
            sanitized.type = siteData.type;
        }
    } else {
        sanitized.type = 'json';
    }

    // 验证屏蔽线路（可选）
    if (siteData.blockedRoutes !== undefined) {
        if (typeof siteData.blockedRoutes !== 'string') {
            errors.push('屏蔽线路必须是字符串');
        } else if (siteData.blockedRoutes.length > 1000) {
            errors.push('屏蔽线路配置长度超过限制');
        } else {
            sanitized.blockedRoutes = siteData.blockedRoutes.substring(0, 1000);
        }
    }

    if (errors.length > 0) {
        return { valid: false, error: errors.join('; ') };
    }

    return { valid: true, sanitized };
}

/**
 * 通用输入清理器
 * 移除潜在的XSS攻击向量
 * @param {string} input - 输入字符串
 * @returns {string} 清理后的字符串
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') return '';

    return input
        .replace(/[<>]/g, '') // 移除尖括号
        .replace(/javascript:/gi, '') // 移除javascript协议
        .replace(/on\w+=/gi, '') // 移除事件处理器
        .trim();
}

/**
 * 创建安全的IPC处理器包装函数
 * @param {Function} handler - 原始处理函数
 * @param {Function} validator - 验证函数
 * @returns {Function} 包装后的安全处理函数
 */
function createSecureHandler(handler, validator) {
    return async (event, ...args) => {
        try {
            // 验证输入
            const validation = validator(...args);

            if (!validation.valid) {
                console.error('[SECURITY] IPC验证失败:', validation.error);
                return {
                    success: false,
                    error: validation.error || '参数验证失败'
                };
            }

            // 使用清理后的数据调用处理函数
            const sanitizedArgs = validation.sanitized !== undefined ?
                [validation.sanitized] :
                args;

            return await handler(event, ...sanitizedArgs);
        } catch (error) {
            console.error('[SECURITY] IPC处理错误:', error);
            return {
                success: false,
                error: '处理请求时发生错误'
            };
        }
    };
}

module.exports = {
    isValidUrl,
    validateMediaUrl,
    validateDeviceId,
    validateVideoData,
    validateSearchKeyword,
    validatePagination,
    validateSiteData,
    sanitizeInput,
    createSecureHandler
};
