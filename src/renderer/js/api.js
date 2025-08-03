// API 模块 - 处理与苹果CMS的通信
class ApiService {
    constructor() {
        this.defaultSites = [
            {
                id: 'qxyys',
                name: '七星追剧',
                url: 'https://zj.qxyys.com/api.php/provide/vod/',
                type: 'json',
                active: true
            },
            {
                id: 'okzy',
                name: 'OK资源',
                url: 'http://cj.okzy.tv/inc/apijson_vod.php',
                type: 'json',
                active: false
            }
        ];
        this.currentSite = null;
        this.categories = [];
        this.detailCache = new Map(); // 视频详情缓存
    }

    // 初始化API服务
    async initialize() {
        let sites = this.getSites();

        // 如果没有站点或者现有站点不包含正确的默认站点，重新设置
        const hasCorrectDefault = sites.some(site =>
            site.id === 'qxyys' && site.url === 'https://zj.qxyys.com/api.php/provide/vod/'
        );

        if (sites.length === 0 || !hasCorrectDefault) {
            console.log('[API] 重新初始化默认站点配置');
            this.saveSites(this.defaultSites);
            sites = this.defaultSites;
        }

        this.currentSite = this.getActiveSite();
        await this.loadCategories();
    }

    // 获取站点列表
    getSites() {
        const sites = localStorage.getItem('video_sites');
        return sites ? JSON.parse(sites) : [];
    }

    // 保存站点列表
    saveSites(sites) {
        localStorage.setItem('video_sites', JSON.stringify(sites));
    }

    // 获取当前活跃站点
    getActiveSite() {
        const sites = this.getSites();
        return sites.find(site => site.active) || sites[0] || this.defaultSites[0];
    }

    // 设置活跃站点
    setActiveSite(siteId) {
        const sites = this.getSites();
        sites.forEach(site => {
            site.active = site.id === siteId;
        });
        this.saveSites(sites);
        this.currentSite = sites.find(site => site.id === siteId);
        this.loadCategories();
    }

    // 添加站点
    addSite(siteData) {
        const sites = this.getSites();
        const newSite = {
            id: Date.now().toString(),
            ...siteData,
            active: false
        };
        sites.push(newSite);
        this.saveSites(sites);
        return newSite;
    }

    // 更新站点
    updateSite(siteId, siteData) {
        const sites = this.getSites();
        const siteIndex = sites.findIndex(site => site.id === siteId);
        if (siteIndex !== -1) {
            sites[siteIndex] = { ...sites[siteIndex], ...siteData };
            this.saveSites(sites);

            // 如果更新的是当前活跃站点，重新加载
            if (this.currentSite && this.currentSite.id === siteId) {
                this.currentSite = sites[siteIndex];
                this.loadCategories();
            }

            return sites[siteIndex];
        }
        return null;
    }

    // 删除站点
    deleteSite(siteId) {
        const sites = this.getSites();
        const filteredSites = sites.filter(site => site.id !== siteId);
        this.saveSites(filteredSites);

        // 如果删除的是当前活跃站点，切换到第一个站点
        if (this.currentSite && this.currentSite.id === siteId) {
            if (filteredSites.length > 0) {
                this.setActiveSite(filteredSites[0].id);
            }
        }
    }

    // 构建API URL
    buildApiUrl(params = {}) {
        if (!this.currentSite) return '';

        const url = new URL(this.currentSite.url);
        Object.keys(params).forEach(key => {
            if (params[key] !== undefined && params[key] !== '') {
                url.searchParams.set(key, params[key]);
            }
        });

        return url.toString();
    }

    // 发送API请求
    async fetchData(params = {}) {
        try {
            const url = this.buildApiUrl(params);
            console.log('[API] 请求URL:', url);

            // 在Electron环境中使用更安全的请求方式
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Referer': 'https://www.baidu.com/'
                }
            });

            console.log('[API] 响应状态:', response.status, response.statusText);

            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status} - ${response.statusText}`);
            }

            const data = await response.text();
            console.log('[API] 响应数据长度:', data.length);
            console.log('[API] 响应数据前200字符:', data.substring(0, 200));

            if (this.currentSite.type === 'json') {
                try {
                    const jsonData = JSON.parse(data);
                    console.log('[API] JSON解析成功，数据类型:', typeof jsonData);
                    console.log('[API] JSON数据键:', Object.keys(jsonData));

                    if (jsonData.list) {
                        console.log('[API] 视频列表长度:', jsonData.list.length);
                        if (jsonData.list.length > 0) {
                            console.log('[API] 第一个视频数据:', jsonData.list[0]);
                        }
                    }

                    return jsonData;
                } catch (parseError) {
                    console.error('[API] JSON解析失败:', parseError);
                    console.error('[API] 原始数据:', data.substring(0, 500));
                    throw new Error('服务器返回的数据格式不正确');
                }
            } else {
                // 处理XML格式
                return this.parseXMLResponse(data);
            }
        } catch (error) {
            console.error('[API] 请求失败:', error);
            console.error('[API] 错误详情:', error.message);
            throw new Error(`请求失败: ${error.message}`);
        }
    }

    // 解析XML响应
    parseXMLResponse(xmlString) {
        // 简单的XML解析实现
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

        const videos = [];
        const items = xmlDoc.querySelectorAll('video');

        items.forEach(item => {
            const video = {
                vod_id: item.querySelector('id')?.textContent || '',
                vod_name: item.querySelector('name')?.textContent || '',
                vod_pic: item.querySelector('pic')?.textContent || '',
                vod_remarks: item.querySelector('note')?.textContent || '',
                type_name: item.querySelector('type')?.textContent || '',
                vod_play_url: item.querySelector('dl dd')?.textContent || ''
            };
            videos.push(video);
        });

        return {
            code: 1,
            msg: 'success',
            page: 1,
            pagecount: 1,
            total: videos.length,
            list: videos
        };
    }

    // 加载分类列表
    async loadCategories() {
        try {
            const data = await this.fetchData({ ac: 'list' });
            if (data && data.class) {
                this.categories = data.class;
            }
        } catch (error) {
            console.warn('加载分类失败:', error);
            this.categories = [];
        }
    }

    // 获取分类列表
    getCategories() {
        return this.categories;
    }

    // 搜索视频
    async searchVideos(keyword, page = 1, category = '') {
        const params = {};

        // 根据不同的API设置不同的参数
        if (this.currentSite.url.includes('apijson') || this.currentSite.url.includes('json')) {
            // JSON API格式
            params.ac = 'list';
            params.pg = page;
            if (keyword) params.wd = keyword;
            if (category) params.t = category;
        } else {
            // 标准苹果CMS格式
            params.ac = 'list';
            params.pg = page;
            if (keyword) params.wd = keyword;
            if (category) params.t = category;
        }

        return await this.fetchData(params);
    }

    // 获取视频详情
    async getVideoDetail(videoId) {
        // 先检查缓存
        const cacheKey = `${this.currentSite.id}_${videoId}`;
        if (this.detailCache.has(cacheKey)) {
            console.log('[API] 从缓存获取视频详情:', videoId);
            return this.detailCache.get(cacheKey);
        }

        console.log('[API] 请求视频详情:', videoId);
        const params = {
            ac: 'detail',
            ids: videoId
        };

        try {
            const result = await this.fetchData(params);

            // 缓存结果
            if (result && result.list && result.list.length > 0) {
                this.detailCache.set(cacheKey, result);
                console.log('[API] 视频详情已缓存:', videoId);
            }

            return result;
        } catch (error) {
            console.error('[API] 获取视频详情失败:', videoId, error);
            throw error;
        }
    }

    // 批量获取视频详情
    async getMultipleVideoDetails(videoIds) {
        console.log('[API] 批量获取视频详情:', videoIds.length, '个视频');

        // 检查哪些视频需要请求
        const uncachedIds = [];
        const cachedResults = [];

        videoIds.forEach(id => {
            const cacheKey = `${this.currentSite.id}_${id}`;
            if (this.detailCache.has(cacheKey)) {
                const cached = this.detailCache.get(cacheKey);
                if (cached.list && cached.list.length > 0) {
                    cachedResults.push(cached.list[0]);
                }
            } else {
                uncachedIds.push(id);
            }
        });

        console.log('[API] 缓存命中:', cachedResults.length, '个，需要请求:', uncachedIds.length, '个');

        // 如果有未缓存的视频，批量请求
        let newResults = [];
        if (uncachedIds.length > 0) {
            try {
                // 苹果CMS支持批量获取详情，用逗号分隔ID
                const idsParam = uncachedIds.join(',');
                const params = {
                    ac: 'detail',
                    ids: idsParam
                };

                const response = await this.fetchData(params);

                if (response && response.list && Array.isArray(response.list)) {
                    newResults = response.list;

                    // 缓存每个结果
                    newResults.forEach(video => {
                        const cacheKey = `${this.currentSite.id}_${video.vod_id}`;
                        this.detailCache.set(cacheKey, {
                            code: 1,
                            msg: 'success',
                            page: 1,
                            pagecount: 1,
                            limit: 1,
                            total: 1,
                            list: [video]
                        });
                    });

                    console.log('[API] 批量详情请求成功，缓存了', newResults.length, '个视频');
                }
            } catch (error) {
                console.error('[API] 批量获取详情失败:', error);
                // 如果批量失败，尝试逐个获取
                for (const id of uncachedIds) {
                    try {
                        const detail = await this.getVideoDetail(id);
                        if (detail && detail.list && detail.list.length > 0) {
                            newResults.push(detail.list[0]);
                        }
                    } catch (singleError) {
                        console.error('[API] 单个视频详情获取失败:', id, singleError);
                    }
                }
            }
        }

        // 合并缓存结果和新结果
        const allResults = [...cachedResults, ...newResults];
        console.log('[API] 总共获取到', allResults.length, '个视频详情');

        return allResults;
    }

    // 清理缓存
    clearDetailCache() {
        this.detailCache.clear();
        console.log('[API] 详情缓存已清理');
    }

    // 解析播放链接
    parsePlayUrls(playUrl, playFrom = '') {
        if (!playUrl) return { routes: [], allEpisodes: [] };

        console.log('[DEBUG] 开始解析播放链接:', playUrl);
        console.log('[DEBUG] 播放来源:', playFrom);
        console.log('[DEBUG] 播放链接长度:', playUrl.length);

        const routes = [];

        // 解析播放来源（线路名称）
        let routeNames = [];
        if (playFrom) {
            routeNames = playFrom.split('$$$').map(name => name.trim()).filter(name => name);
            console.log('[DEBUG] 解析到的线路名称:', routeNames);
        }

        // 处理不同格式的播放链接
        if (playUrl.includes('$$$')) {
            console.log('[DEBUG] 检测到多线路格式 ($$$)');
            // 多线路格式处理
            const routeParts = playUrl.split('$$$');
            console.log('[DEBUG] 分割后部分数:', routeParts.length);

            routeParts.forEach((part, index) => {
                const trimmedPart = part.trim();
                if (!trimmedPart) return;

                console.log(`[DEBUG] 处理第${index}部分:`, trimmedPart);

                // 解析剧集数据
                const episodes = this.parseEpisodes(trimmedPart);
                if (episodes.length > 0) {
                    // 获取线路名称
                    let routeName = '';

                    // 首先尝试使用对应的线路名称
                    if (routeNames[index]) {
                        routeName = routeNames[index];
                    } else {
                        // 如果没有线路名称，尝试从URL推断
                        const firstUrl = episodes[0]?.url || '';
                        routeName = this.guessRouteNameFromUrl(firstUrl);

                        // 如果推断也失败，使用默认名称
                        if (!routeName) {
                            routeName = `线路${index + 1}`;
                        }
                    }

                    // 确保线路名称不重复
                    const existingNames = routes.map(r => r.name);
                    let finalRouteName = routeName;
                    let counter = 1;
                    while (existingNames.includes(finalRouteName)) {
                        finalRouteName = `${routeName}_${counter}`;
                        counter++;
                    }

                    routes.push({
                        name: finalRouteName,
                        episodes: episodes
                    });
                    console.log(`[DEBUG] 添加线路: ${finalRouteName}, 剧集数: ${episodes.length}`);
                }
            });

            // 如果没有解析到任何线路，尝试将整个字符串作为单线路处理
            if (routes.length === 0) {
                const episodes = this.parseEpisodes(playUrl);
                if (episodes.length > 0) {
                    const routeName = routeNames[0] || '默认线路';
                    routes.push({
                        name: routeName,
                        episodes: episodes
                    });
                    console.log(`[DEBUG] 添加回退线路: ${routeName}, 剧集数: ${episodes.length}`);
                }
            }
        } else {
            console.log('[DEBUG] 检测到单线路格式');
            // 单线路格式
            const episodes = this.parseEpisodes(playUrl);
            if (episodes.length > 0) {
                // 获取线路名称
                let routeName = '';

                // 首先使用第一个线路名称
                if (routeNames[0]) {
                    routeName = routeNames[0];
                } else {
                    // 如果没有线路名称，尝试从URL推断
                    const firstUrl = episodes[0]?.url || '';
                    routeName = this.guessRouteNameFromUrl(firstUrl) || '默认线路';
                }

                routes.push({
                    name: routeName,
                    episodes: episodes
                });
                console.log(`[DEBUG] 添加线路: ${routeName}, 剧集数: ${episodes.length}`);
            }
        }

        // 合并所有剧集（用于兼容性）
        const allEpisodes = routes.length > 0 ? routes[0].episodes : [];

        console.log('[DEBUG] 最终解析结果:', { routes: routes.length, allEpisodes: allEpisodes.length });
        console.log('[DEBUG] 详细线路信息:', routes);

        return { routes, allEpisodes };
    }    // 从播放数据中提取线路名称
    extractRouteName(playData) {
        // 检查是否有明确的线路标识
        const routePatterns = [
            /线路(\d+|[一二三四五六七八九十]+)/,
            /(HD|超清|蓝光|标清|流畅)/,
            /(mp4|m3u8|flv)/i,
            /(\w+播放器?|\w+线路?)/
        ];

        for (const pattern of routePatterns) {
            const match = playData.match(pattern);
            if (match) {
                return match[0];
            }
        }

        return null;
    }

    // 根据URL推断线路名称
    guessRouteNameFromUrl(url) {
        if (!url) return null;

        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();

            // 根据域名特征推断线路名称
            if (hostname.includes('qq.com') || hostname.includes('v.qq.com')) {
                return '腾讯线路';
            } else if (hostname.includes('iqiyi.com') || hostname.includes('qiyi.com')) {
                return '爱奇艺线路';
            } else if (hostname.includes('youku.com')) {
                return '优酷线路';
            } else if (hostname.includes('bilibili.com')) {
                return 'B站线路';
            } else if (hostname.includes('mgtv.com')) {
                return '芒果TV线路';
            } else if (url.includes('.m3u8')) {
                return 'M3U8线路';
            } else if (url.includes('.mp4')) {
                return 'MP4线路';
            } else if (url.includes('.flv')) {
                return 'FLV线路';
            } else {
                // 使用域名的主要部分作为线路名
                const mainDomain = hostname.split('.').slice(-2, -1)[0];
                if (mainDomain && mainDomain.length > 2) {
                    return `${mainDomain}线路`;
                }
            }
        } catch (error) {
            console.warn('[DEBUG] URL解析失败:', error);
        }

        return null;
    }

    // 解析单个线路的剧集数据
    parseEpisodes(episodeData) {
        const episodes = [];

        if (episodeData.includes('#')) {
            // 标准格式: 第1集$url1#第2集$url2
            const parts = episodeData.split('#');

            parts.forEach((part, index) => {
                if (part.trim()) {
                    const [name, url] = part.split('$');
                    if (url && url.trim()) {
                        episodes.push({
                            index: index + 1,
                            name: name || `第${index + 1}集`,
                            url: url.trim(),
                            watched: false
                        });
                    } else if (part.trim()) {
                        // 只有URL没有名称的情况
                        episodes.push({
                            index: index + 1,
                            name: `第${index + 1}集`,
                            url: part.trim(),
                            watched: false
                        });
                    }
                }
            });
        } else {
            // 单集格式
            if (episodeData.trim()) {
                const [name, url] = episodeData.split('$');
                episodes.push({
                    index: 1,
                    name: name && url ? name : '播放',
                    url: url || episodeData.trim(),
                    watched: false
                });
            }
        }

        return episodes;
    }

    // 测试站点连接和数据格式
    async testSiteConnection(siteUrl, siteType) {
        try {
            // 第一步：测试基本连接
            const testUrl = siteUrl + (siteUrl.includes('?') ? '&' : '?') + 'ac=list&pg=1';
            console.log('[API] 测试站点连接:', testUrl);

            const response = await fetch(testUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json, text/plain, */*',
                    'Referer': 'https://www.baidu.com/'
                },
                timeout: 10000 // 10秒超时
            });

            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status} - ${response.statusText}`);
            }

            const data = await response.text();
            console.log('[API] 测试响应数据长度:', data.length);

            // 第二步：测试数据格式
            let parsedData;
            let testResults = {
                connection: true,
                format: false,
                structure: false,
                videoCount: 0,
                categories: 0,
                message: []
            };

            if (siteType === 'json') {
                try {
                    parsedData = JSON.parse(data);
                    testResults.format = true;
                    testResults.message.push('✓ JSON格式正确');

                    // 第三步：测试数据结构
                    if (parsedData.code !== undefined) {
                        testResults.message.push('✓ 包含状态码');
                    }

                    if (parsedData.list && Array.isArray(parsedData.list)) {
                        testResults.structure = true;
                        testResults.videoCount = parsedData.list.length;
                        testResults.message.push(`✓ 视频列表结构正确 (${parsedData.list.length}条)`);

                        // 检查视频数据结构
                        if (parsedData.list.length > 0) {
                            const firstVideo = parsedData.list[0];
                            if (firstVideo.vod_id && firstVideo.vod_name) {
                                testResults.message.push('✓ 视频数据包含必要字段');
                            } else {
                                testResults.message.push('⚠ 视频数据缺少必要字段');
                            }
                        }
                    } else {
                        testResults.message.push('✗ 缺少视频列表或格式错误');
                    }

                    if (parsedData.class && Array.isArray(parsedData.class)) {
                        testResults.categories = parsedData.class.length;
                        testResults.message.push(`✓ 分类数据正确 (${parsedData.class.length}个分类)`);
                    } else {
                        testResults.message.push('⚠ 没有分类数据');
                    }

                } catch (parseError) {
                    testResults.message.push('✗ JSON解析失败: ' + parseError.message);
                    throw new Error('JSON格式错误: ' + parseError.message);
                }
            } else {
                // XML格式测试
                try {
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(data, 'text/xml');

                    if (xmlDoc.querySelector('parsererror')) {
                        throw new Error('XML解析错误');
                    }

                    testResults.format = true;
                    testResults.message.push('✓ XML格式正确');

                    const videos = xmlDoc.querySelectorAll('video');
                    if (videos.length > 0) {
                        testResults.structure = true;
                        testResults.videoCount = videos.length;
                        testResults.message.push(`✓ 找到${videos.length}个视频数据`);
                    } else {
                        testResults.message.push('✗ 没有找到视频数据');
                    }

                } catch (parseError) {
                    testResults.message.push('✗ XML解析失败: ' + parseError.message);
                    throw new Error('XML格式错误: ' + parseError.message);
                }
            }

            // 第四步：测试详情接口
            try {
                if (parsedData && parsedData.list && parsedData.list.length > 0) {
                    const firstVideoId = parsedData.list[0].vod_id;
                    if (firstVideoId) {
                        const detailUrl = siteUrl + (siteUrl.includes('?') ? '&' : '?') + `ac=detail&ids=${firstVideoId}`;
                        const detailResponse = await fetch(detailUrl, {
                            method: 'GET',
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            }
                        });

                        if (detailResponse.ok) {
                            testResults.message.push('✓ 详情接口可用');
                        } else {
                            testResults.message.push('⚠ 详情接口响应异常');
                        }
                    }
                }
            } catch (detailError) {
                testResults.message.push('⚠ 详情接口测试失败');
            }

            const successMessage = testResults.message.join('\n');

            if (testResults.format && testResults.structure) {
                return {
                    success: true,
                    message: `连接测试完成\n${successMessage}`,
                    details: testResults
                };
            } else {
                return {
                    success: false,
                    message: `数据格式验证失败\n${successMessage}`,
                    details: testResults
                };
            }

        } catch (error) {
            console.error('[API] 站点测试失败:', error);
            return {
                success: false,
                message: `连接失败: ${error.message}`
            };
        }
    }
}

// 导出API服务实例
window.ApiService = ApiService;
