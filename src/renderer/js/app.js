// 主应用文件
class QixingZhuijuApp {
    constructor() {
        this.apiService = new ApiService();
        this.storageService = new StorageService();
        this.componentService = new ComponentService();
        this.currentPage = 'home';
        this.currentSearchData = {
            keyword: '',
            category: '',
            page: 1,
            totalPages: 1
        };
    }

    // 初始化应用
    async initialize() {
        try {
            console.log('初始化七星追剧应用...');

            // 初始化服务
            await this.apiService.initialize();
            this.componentService.initialize(this.apiService, this.storageService);

            // 设置事件监听
            this.setupEventListeners();

            // 加载初始数据
            await this.loadInitialData();

            // 清理过期数据
            this.storageService.cleanupOldData();

            console.log('应用初始化完成');
        } catch (error) {
            console.error('应用初始化失败:', error);
            this.showError('应用初始化失败，请刷新重试');
        }
    }

    // 设置事件监听
    setupEventListeners() {
        // 导航菜单事件
        const navItems = document.querySelectorAll('.nav-item a');
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                // 使用 currentTarget 确保获取的是绑定事件的 <a> 元素，而不是点击的子元素
                const page = e.currentTarget.dataset.page;
                console.log('点击导航:', page, 'target:', e.target, 'currentTarget:', e.currentTarget);
                if (page) {
                    this.switchToPage(page);
                }
            });
        });

        // 搜索相关事件
        const searchBtn = document.getElementById('search-btn');
        const searchInput = document.getElementById('search-input');
        const siteSelect = document.getElementById('site-select');
        const categorySelect = document.getElementById('category-select');

        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.performSearch());
        }

        if (searchInput) {
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch();
                }
            });
        }

        if (siteSelect) {
            siteSelect.addEventListener('change', (e) => {
                this.switchSite(e.target.value);
            });
        }

        if (categorySelect) {
            categorySelect.addEventListener('change', () => {
                this.performSearch(1); // 切换分类时重置到第一页
            });
        }

        // 返回按钮事件
        const backBtn = document.getElementById('back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.switchToPage('home');
            });
        }

        // 设置页面事件
        const addSiteBtn = document.getElementById('add-site-btn');
        const clearHistoryBtn = document.getElementById('clear-history-btn');
        const manageRoutesBtn = document.getElementById('manage-routes-btn');
        const exportDataBtn = document.getElementById('export-data-btn');
        const importDataBtn = document.getElementById('import-data-btn');
        const importFileInput = document.getElementById('import-file-input');

        if (addSiteBtn) {
            addSiteBtn.addEventListener('click', () => {
                this.componentService.showAddSiteModal();
            });
        }

        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => {
                this.confirmClearHistory();
            });
        }

        if (manageRoutesBtn) {
            manageRoutesBtn.addEventListener('click', () => {
                this.componentService.showRouteAliasModal();
            });
        }

        if (exportDataBtn) {
            exportDataBtn.addEventListener('click', () => {
                this.componentService.showExportDataModal();
            });
        }

        if (importDataBtn) {
            importDataBtn.addEventListener('click', () => {
                this.componentService.showImportDataModal();
            });
        }

        // 临时：为测试添加一些假的播放历史
        if (this.storageService.getPlayHistory().length === 0) {
            console.log('添加测试播放历史');
            this.addTestHistory();
        }

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey) {
                switch (e.key) {
                    case 'f':
                    case 'F':
                        e.preventDefault();
                        searchInput?.focus();
                        break;
                    case 'r':
                    case 'R':
                        e.preventDefault();
                        this.refreshCurrentPage();
                        break;
                }
            }
        });
    }

    // 切换页面
    async switchToPage(pageName) {
        console.log('[APP] 开始切换到页面:', pageName);

        // 立即切换UI，不等待数据加载
        this.currentPage = pageName;
        console.log('[APP] 调用 componentService.switchPage');
        this.componentService.switchPage(pageName);

        // 异步加载数据，不阻塞UI切换
        setTimeout(async () => {
            try {
                console.log('[APP] 开始加载页面数据:', pageName);
                switch (pageName) {
                    case 'home':
                        if (!this.hasSearchResults()) {
                            console.log('[APP] 加载推荐视频');
                            await this.loadRecommendedVideos();
                        }
                        break;
                    case 'history':
                        console.log('[APP] 加载播放历史页面');
                        this.loadPlayHistory();
                        break;
                    case 'settings':
                        console.log('[APP] 加载设置页面');
                        this.loadSettings();
                        break;
                }
                console.log('[APP] 页面数据加载完成:', pageName);
            } catch (error) {
                console.error('[APP] 页面数据加载失败:', error);
            }
        }, 50); // 延迟50ms执行，确保UI切换完成
    }

    // 加载初始数据
    async loadInitialData() {
        // 加载站点选择器
        await this.loadSiteSelector();

        // 加载分类选择器
        await this.loadCategorySelector();

        // 加载推荐视频
        await this.loadRecommendedVideos();
    }

    // 加载站点选择器
    async loadSiteSelector() {
        const siteSelect = document.getElementById('site-select');
        if (!siteSelect) return;

        const sites = this.apiService.getSites();
        const activeSite = this.apiService.getActiveSite();

        siteSelect.innerHTML = '';
        sites.forEach(site => {
            const option = document.createElement('option');
            option.value = site.id;
            option.textContent = site.name;
            option.selected = site.id === activeSite?.id;
            siteSelect.appendChild(option);
        });
    }

    // 加载分类选择器
    async loadCategorySelector() {
        const categorySelect = document.getElementById('category-select');
        if (!categorySelect) return;

        const categories = this.apiService.getCategories();

        categorySelect.innerHTML = '<option value="">全部分类</option>';
        categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category.type_id;
            option.textContent = category.type_name;
            categorySelect.appendChild(option);
        });
    }

    // 切换站点
    async switchSite(siteId) {
        try {
            this.showLoading();
            this.apiService.setActiveSite(siteId);
            await this.loadCategorySelector();
            await this.loadRecommendedVideos();
            this.hideLoading();
            this.componentService.showNotification('站点切换成功', 'success');
        } catch (error) {
            this.hideLoading();
            console.error('切换站点失败:', error);
            this.componentService.showNotification('切换站点失败', 'error');
        }
    }

    // 执行搜索
    async performSearch(page = 1) {
        try {
            const searchInput = document.getElementById('search-input');
            const categorySelect = document.getElementById('category-select');

            const keyword = searchInput?.value?.trim() || '';
            const category = categorySelect?.value || '';

            console.log('[APP] 执行搜索:', { keyword, category, page });

            this.currentSearchData = {
                keyword,
                category,
                page,
                totalPages: 1
            };

            this.showLoading();

            // 第一步：获取搜索结果
            const response = await this.apiService.searchVideos(keyword, page, category);
            console.log('[APP] 搜索响应:', response);

            if (response && response.list && Array.isArray(response.list)) {
                console.log('[APP] 搜索到视频数量:', response.list.length);

                // 第二步：批量获取视频详情（包含海报）
                const videoIds = response.list.map(video => video.vod_id);
                console.log('[APP] 准备获取详情的视频ID:', videoIds);

                try {
                    const detailsList = await this.apiService.getMultipleVideoDetails(videoIds);
                    console.log('[APP] 获取到详情数量:', detailsList.length);

                    // 第三步：合并基本信息和详情信息
                    const enhancedVideos = response.list.map(basicVideo => {
                        const detailVideo = detailsList.find(detail => detail.vod_id == basicVideo.vod_id);
                        if (detailVideo) {
                            // 合并基本信息和详情信息，详情优先
                            return {
                                ...basicVideo,
                                ...detailVideo,
                                // 确保关键字段存在
                                vod_pic: detailVideo.vod_pic || basicVideo.vod_pic,
                                vod_name: detailVideo.vod_name || basicVideo.vod_name,
                                vod_remarks: detailVideo.vod_remarks || basicVideo.vod_remarks
                            };
                        }
                        return basicVideo;
                    });

                    console.log('[APP] 合并后的视频数据示例:', enhancedVideos[0]);

                    // 第四步：显示增强后的视频列表
                    const enhancedResponse = {
                        ...response,
                        list: enhancedVideos
                    };

                    this.displaySearchResults(enhancedResponse);
                    this.currentSearchData.totalPages = enhancedResponse.pagecount || 1;

                } catch (detailError) {
                    console.warn('[APP] 获取视频详情失败，使用基本信息:', detailError);
                    // 如果获取详情失败，仍然显示基本信息
                    this.displaySearchResults(response);
                    this.currentSearchData.totalPages = response.pagecount || 1;
                }

            } else {
                console.warn('[APP] 搜索无结果或响应格式错误:', response);
                this.displayEmptyResults();
            }

            this.hideLoading();
        } catch (error) {
            this.hideLoading();
            console.error('[APP] 搜索失败:', error);
            this.componentService.showNotification(`搜索失败: ${error.message}`, 'error');
            this.displayEmptyResults();
        }
    }

    // 加载推荐视频
    async loadRecommendedVideos() {
        try {
            console.log('[APP] 开始加载推荐视频...');
            this.showLoading();

            // 第一步：获取视频列表
            const response = await this.apiService.searchVideos('', 1, '');
            console.log('[APP] 搜索API响应:', response);

            if (response && response.list && Array.isArray(response.list)) {
                console.log('[APP] 获取到视频列表，数量:', response.list.length);

                // 第二步：批量获取视频详情（包含海报）
                const videoIds = response.list.map(video => video.vod_id);
                console.log('[APP] 准备获取详情的视频ID:', videoIds);

                try {
                    const detailsList = await this.apiService.getMultipleVideoDetails(videoIds);
                    console.log('[APP] 获取到详情数量:', detailsList.length);

                    // 第三步：合并基本信息和详情信息
                    const enhancedVideos = response.list.map(basicVideo => {
                        const detailVideo = detailsList.find(detail => detail.vod_id == basicVideo.vod_id);
                        if (detailVideo) {
                            // 合并基本信息和详情信息，详情优先
                            return {
                                ...basicVideo,
                                ...detailVideo,
                                // 确保关键字段存在
                                vod_pic: detailVideo.vod_pic || basicVideo.vod_pic,
                                vod_name: detailVideo.vod_name || basicVideo.vod_name,
                                vod_remarks: detailVideo.vod_remarks || basicVideo.vod_remarks
                            };
                        }
                        return basicVideo;
                    });

                    console.log('[APP] 合并后的视频数据示例:', enhancedVideos[0]);

                    // 第四步：显示增强后的视频列表
                    const enhancedResponse = {
                        ...response,
                        list: enhancedVideos
                    };

                    this.displaySearchResults(enhancedResponse);
                    this.currentSearchData.totalPages = response.pagecount || 1;

                } catch (detailError) {
                    console.warn('[APP] 获取视频详情失败，使用基本信息:', detailError);
                    // 如果获取详情失败，仍然显示基本信息
                    this.displaySearchResults(response);
                    this.currentSearchData.totalPages = response.pagecount || 1;
                }

            } else {
                console.warn('[APP] API响应格式不正确或无数据:', response);
                this.displayEmptyResults();
            }

            this.hideLoading();
        } catch (error) {
            this.hideLoading();
            console.error('[APP] 加载推荐视频失败:', error);
            console.error('[APP] 错误堆栈:', error.stack);
            this.componentService.showNotification(`加载失败: ${error.message}`, 'error');
            this.displayEmptyResults();
        }
    }

    // 显示搜索结果
    displaySearchResults(response) {
        console.log('[APP] 开始显示搜索结果:', response);

        const videoGrid = document.getElementById('video-grid');
        if (!videoGrid) {
            console.error('[APP] 找不到video-grid元素');
            return;
        }

        videoGrid.innerHTML = '';

        if (response.list && response.list.length > 0) {
            console.log(`[APP] 创建 ${response.list.length} 个视频卡片`);

            response.list.forEach((video, index) => {
                try {
                    console.log(`[APP] 创建第${index + 1}个卡片:`, video.vod_name);
                    const card = this.componentService.createVideoCard(video);
                    if (card) {
                        videoGrid.appendChild(card);
                    } else {
                        console.error(`[APP] 第${index + 1}个卡片创建失败`);
                    }
                } catch (error) {
                    console.error(`[APP] 创建第${index + 1}个卡片时出错:`, error);
                }
            });

            // 创建分页
            this.createPagination(response.page || 1, response.pagecount || 1);
            console.log('[APP] 搜索结果显示完成');
        } else {
            console.warn('[APP] 响应中没有视频列表');
            this.displayEmptyResults();
        }
    }

    // 显示空结果
    displayEmptyResults() {
        const videoGrid = document.getElementById('video-grid');
        if (!videoGrid) return;

        videoGrid.innerHTML = `
            <div class="empty-state">
                <i>🔍</i>
                <h3>没有找到相关内容</h3>
                <p>尝试使用其他关键词搜索</p>
            </div>
        `;

        // 清除分页
        const pagination = document.getElementById('pagination');
        if (pagination) {
            pagination.innerHTML = '';
        }
    }

    // 创建分页
    createPagination(currentPage, totalPages) {
        const paginationContainer = document.getElementById('pagination');
        if (!paginationContainer) return;

        paginationContainer.innerHTML = '';

        const pagination = this.componentService.createPagination(
            currentPage,
            totalPages,
            (page) => this.performSearch(page)
        );

        paginationContainer.appendChild(pagination);
    }

    // 加载播放历史
    loadPlayHistory() {
        console.log('开始加载播放历史');
        const historyList = document.getElementById('history-list');
        if (!historyList) {
            console.error('历史列表元素未找到');
            return;
        }

        const history = this.storageService.getPlayHistory();
        console.log('获取到播放历史数据:', history);

        historyList.innerHTML = '';

        if (history.length > 0) {
            history.forEach((item, index) => {
                console.log(`创建历史记录项 ${index + 1}:`, item);
                try {
                    const historyElement = this.componentService.createHistoryItem(item);
                    historyList.appendChild(historyElement);
                } catch (error) {
                    console.error('创建历史记录项失败:', error, item);
                }
            });
            console.log('播放历史加载完成，共', history.length, '条记录');
        } else {
            console.log('无播放历史数据，显示空状态');
            historyList.innerHTML = `
                <div class="empty-state">
                    <i>📺</i>
                    <h3>暂无播放历史</h3>
                    <p>开始观看视频后，历史记录会显示在这里</p>
                </div>
            `;
        }
    }

    // 加载设置页面
    loadSettings() {
        // 加载站点列表
        const siteList = document.getElementById('site-list');
        if (siteList) {
            const sites = this.apiService.getSites();
            siteList.innerHTML = '';

            if (sites.length > 0) {
                sites.forEach(site => {
                    const siteElement = this.componentService.createSiteItem(site);
                    siteList.appendChild(siteElement);
                });
            } else {
                siteList.innerHTML = `
                    <div class="empty-state">
                        <i>⚙️</i>
                        <h3>暂无站点</h3>
                        <p>添加视频源站点开始使用</p>
                    </div>
                `;
            }
        }

        // 加载线路别名列表
        const routeAliasesList = document.getElementById('route-aliases-list');
        if (routeAliasesList) {
            const aliases = this.storageService.getAllRouteAliases();
            const aliasEntries = Object.entries(aliases);

            routeAliasesList.innerHTML = '';

            if (aliasEntries.length > 0) {
                aliasEntries.forEach(([routeName, alias]) => {
                    const aliasElement = this.componentService.createRouteAliasItem(routeName, alias);
                    routeAliasesList.appendChild(aliasElement);
                });
            } else {
                routeAliasesList.innerHTML = `
                    <div class="empty-state">
                        <i>🔧</i>
                        <h3>暂无线路别名</h3>
                        <p>播放视频时会自动为播放线路创建别名设置</p>
                    </div>
                `;
            }
        }
    }

    // 确认清空历史
    confirmClearHistory() {
        const content = `
            <h3>清空确认</h3>
            <p>确定要清空所有播放历史吗？此操作不可撤销。</p>
            <div class="form-actions">
                <button type="button" class="btn-secondary" id="cancel-clear-btn">取消</button>
                <button type="button" class="btn-delete" id="confirm-clear-btn">清空</button>
            </div>
        `;

        this.componentService.showModal(content);

        const cancelBtn = document.getElementById('cancel-clear-btn');
        const confirmBtn = document.getElementById('confirm-clear-btn');

        cancelBtn.addEventListener('click', () => {
            this.componentService.hideModal();
        });

        confirmBtn.addEventListener('click', () => {
            this.storageService.clearPlayHistory();
            this.componentService.hideModal();
            this.componentService.showNotification('播放历史已清空', 'success');
            this.loadPlayHistory();
        });
    }

    // 刷新当前页面
    async refreshCurrentPage() {
        switch (this.currentPage) {
            case 'home':
                if (this.hasSearchResults()) {
                    await this.performSearch(this.currentSearchData.page);
                } else {
                    await this.loadRecommendedVideos();
                }
                break;
            case 'history':
                this.loadPlayHistory();
                break;
            case 'settings':
                this.loadSettings();
                break;
        }
    }

    // 检查是否有搜索结果
    hasSearchResults() {
        return this.currentSearchData.keyword || this.currentSearchData.category;
    }

    // 显示加载状态
    showLoading() {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.classList.remove('hidden');
        }
    }

    // 隐藏加载状态
    hideLoading() {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.classList.add('hidden');
        }
    }

    // 显示错误信息
    showError(message) {
        this.componentService.showNotification(message, 'error');
    }

    // 临时方法：添加测试播放历史
    addTestHistory() {
        const now = Date.now();
        const testHistory = [
            {
                vod_id: 'test1',
                vod_name: '测试视频1',
                vod_pic: 'https://via.placeholder.com/200x280/404040/ffffff?text=测试1',
                type_name: '电影',
                current_episode: 1,
                episode_name: '正片',
                watch_time: now - 3600000, // 1小时前
                site_name: '测试站点',
                progress: 75,
                play_duration: 4500 // 75分钟播放时长
            },
            {
                vod_id: 'test2',
                vod_name: '测试剧集2',
                vod_pic: 'https://via.placeholder.com/200x280/404040/ffffff?text=测试2',
                type_name: '电视剧',
                current_episode: 5,
                episode_name: '第5集',
                watch_time: now - 7200000, // 2小时前
                site_name: '测试站点',
                progress: 45,
                play_duration: 1800 // 30分钟播放时长
            },
            {
                vod_id: 'test3',
                vod_name: '测试动画3',
                vod_pic: 'https://via.placeholder.com/200x280/404040/ffffff?text=测试3',
                type_name: '动漫',
                current_episode: 12,
                episode_name: '第12集',
                watch_time: now - 86400000, // 1天前
                site_name: '动漫站点',
                progress: 90,
                play_duration: 1320 // 22分钟播放时长
            }
        ];

        testHistory.forEach(item => {
            this.storageService.addPlayHistory(item);
        });

        console.log('[APP] 已添加测试播放历史，数量:', testHistory.length);
    }
}

// 应用启动
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 创建全局应用实例
        window.app = new QixingZhuijuApp();

        // 初始化应用
        await window.app.initialize();

        console.log('七星追剧应用启动成功');
    } catch (error) {
        console.error('应用启动失败:', error);

        // 显示启动失败信息
        document.body.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; background: #1a1a1a; color: #fff; font-family: Arial, sans-serif;">
                <h2>应用启动失败</h2>
                <p>错误信息: ${error.message}</p>
                <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #0078d4; color: white; border: none; border-radius: 4px; cursor: pointer;">重新加载</button>
            </div>
        `;
    }
});
