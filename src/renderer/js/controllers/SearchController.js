/**
 * 搜索控制器
 * 处理视频搜索、分类筛选和搜索结果管理
 */
class SearchController {
    /**
     * 构造函数
     * @param {object} options - 配置选项
     * @param {object} options.apiService - API服务实例
     * @param {object} options.componentService - 组件服务实例
     * @param {Function} options.showLoading - 显示加载状态函数
     * @param {Function} options.hideLoading - 隐藏加载状态函数
     * @param {Function} options.displaySearchResults - 显示搜索结果函数
     * @param {Function} options.displayEmptyResults - 显示空结果函数
     */
    constructor(options) {
        this.apiService = options.apiService;
        this.componentService = options.componentService;
        this.showLoading = options.showLoading;
        this.hideLoading = options.hideLoading;
        this.displaySearchResults = options.displaySearchResults;
        this.displayEmptyResults = options.displayEmptyResults;

        // 当前搜索状态
        this.currentSearchData = {
            keyword: '',
            category: '',
            page: 1,
            totalPages: 1
        };
    }

    /**
     * 获取当前搜索数据
     * @returns {object} 当前搜索数据
     */
    getCurrentSearchData() {
        return { ...this.currentSearchData };
    }

    /**
     * 设置当前搜索数据
     * @param {object} data - 搜索数据
     */
    setCurrentSearchData(data) {
        this.currentSearchData = { ...this.currentSearchData, ...data };
    }

    /**
     * 执行搜索
     * @param {number} page - 页码
     * @returns {Promise<void>}
     */
    async performSearch(page = 1) {
        try {
            const searchInput = document.getElementById('search-input');
            const categorySelect = document.getElementById('category-select');

            const keyword = searchInput?.value?.trim() || '';
            const category = categorySelect?.value || '';

            console.log('[SearchController] 执行搜索:', { keyword, category, page });

            this.currentSearchData = {
                keyword,
                category,
                page,
                totalPages: 1
            };

            this.showLoading();

            // 获取搜索结果
            const response = await this.apiService.searchVideos(keyword, page, category);
            console.log('[SearchController] 搜索响应:', response);

            if (response && response.list && Array.isArray(response.list)) {
                console.log('[SearchController] 搜索到视频数量:', response.list.length);

                // 批量获取视频详情
                const enhancedResponse = await this.enhanceVideoList(response);
                this.displaySearchResults(enhancedResponse);
                this.currentSearchData.totalPages = enhancedResponse.pagecount || 1;
            } else {
                console.warn('[SearchController] 搜索无结果或响应格式错误:', response);
                this.displayEmptyResults();
            }

            this.hideLoading();
        } catch (error) {
            this.hideLoading();
            console.error('[SearchController] 搜索失败:', error);
            this.componentService.showNotification(`搜索失败: ${error.message}`, 'error');
            this.displayEmptyResults();
        }
    }

    /**
     * 增强视频列表（获取详情）
     * @param {object} response - 搜索响应
     * @returns {Promise<object>} 增强后的响应
     */
    async enhanceVideoList(response) {
        const videoIds = response.list.map(video => video.vod_id);
        console.log('[SearchController] 准备获取详情的视频ID:', videoIds);

        try {
            const detailsList = await this.apiService.getMultipleVideoDetails(videoIds);
            console.log('[SearchController] 获取到详情数量:', detailsList.length);

            // 合并基本信息和详情信息
            const enhancedVideos = response.list.map(basicVideo => {
                const detailVideo = detailsList.find(detail => detail.vod_id == basicVideo.vod_id);
                if (detailVideo) {
                    return {
                        ...basicVideo,
                        ...detailVideo,
                        vod_pic: detailVideo.vod_pic || basicVideo.vod_pic,
                        vod_name: detailVideo.vod_name || basicVideo.vod_name,
                        vod_remarks: detailVideo.vod_remarks || basicVideo.vod_remarks
                    };
                }
                return basicVideo;
            });

            console.log('[SearchController] 合并后的视频数据示例:', enhancedVideos[0]);

            return {
                ...response,
                list: enhancedVideos
            };
        } catch (detailError) {
            console.warn('[SearchController] 获取视频详情失败，使用基本信息:', detailError);
            return response;
        }
    }

    /**
     * 加载推荐视频
     * @returns {Promise<void>}
     */
    async loadRecommendedVideos() {
        try {
            console.log('[SearchController] 开始加载推荐视频...');
            this.showLoading();

            const response = await this.apiService.searchVideos('', 1, '');
            console.log('[SearchController] 搜索API响应:', response);

            if (response && response.list && Array.isArray(response.list)) {
                console.log('[SearchController] 获取到视频列表，数量:', response.list.length);

                const enhancedResponse = await this.enhanceVideoList(response);
                this.displaySearchResults(enhancedResponse);
            } else {
                console.warn('[SearchController] 未获取到视频列表');
                this.displayEmptyResults();
            }

            this.hideLoading();
        } catch (error) {
            this.hideLoading();
            console.error('[SearchController] 加载推荐视频失败:', error);
            this.componentService.showNotification('加载推荐视频失败', 'error');
            this.displayEmptyResults();
        }
    }

    /**
     * 翻页
     * @param {number} page - 目标页码
     * @returns {Promise<void>}
     */
    async goToPage(page) {
        if (page < 1 || page > this.currentSearchData.totalPages) {
            return;
        }
        await this.performSearch(page);
    }

    /**
     * 下一页
     * @returns {Promise<void>}
     */
    async nextPage() {
        const { page, totalPages } = this.currentSearchData;
        if (page < totalPages) {
            await this.goToPage(page + 1);
        }
    }

    /**
     * 上一页
     * @returns {Promise<void>}
     */
    async prevPage() {
        const { page } = this.currentSearchData;
        if (page > 1) {
            await this.goToPage(page - 1);
        }
    }

    /**
     * 刷新当前搜索
     * @returns {Promise<void>}
     */
    async refresh() {
        await this.performSearch(this.currentSearchData.page);
    }

    /**
     * 重置搜索
     */
    reset() {
        this.currentSearchData = {
            keyword: '',
            category: '',
            page: 1,
            totalPages: 1
        };

        const searchInput = document.getElementById('search-input');
        const categorySelect = document.getElementById('category-select');

        if (searchInput) searchInput.value = '';
        if (categorySelect) categorySelect.value = '';
    }
}

// 导出给渲染进程使用
window.SearchController = SearchController;
