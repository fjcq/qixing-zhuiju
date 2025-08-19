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

        // 初始化标题栏控制
        this.initializeTitlebarControls();
    }

    // 初始化标题栏控制
    initializeTitlebarControls() {
        // 如果DOM已经加载完成，直接初始化
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            this.setupTitlebarEvents();
        } else {
            // 否则等待DOM加载完成
            document.addEventListener('DOMContentLoaded', () => {
                this.setupTitlebarEvents();
            });
        }
    }

    // 设置标题栏事件
    setupTitlebarEvents() {
        // 最小化按钮
        const minimizeBtn = document.getElementById('minimize-btn');
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.electron && window.electron.window) {
                    window.electron.window.minimize();
                }
            });
        }

        // 最大化/还原按钮
        const maximizeBtn = document.getElementById('maximize-btn');
        if (maximizeBtn) {
            maximizeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.electron && window.electron.window) {
                    window.electron.window.maximize();
                }
            });
        }

        // 关闭按钮
        const closeBtn = document.getElementById('close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (window.electron && window.electron.window) {
                    window.electron.window.close();
                }
            });
        }
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

            // 加载并显示版本号
            await this.loadVersionInfo();

            // 清理过期数据
            this.storageService.cleanupOldData();

            // 初始化剪切板检测
            this.initializeClipboardDetection();

            // 初始化播放器集数同步监听
            this.initializePlayerEpisodeSync();

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

        // 更新检查功能
        this.setupUpdateChecker();

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

    // 加载并显示版本号
    async loadVersionInfo() {
        try {
            const versionElement = document.getElementById('version-info');
            const aboutVersionElement = document.getElementById('about-version');
            const currentVersionElement = document.getElementById('current-version-display');

            // 尝试从主进程获取版本号
            if (window.electron && window.electron.ipcRenderer) {
                const version = await window.electron.ipcRenderer.invoke('get-app-version');
                if (version) {
                    const versionText = `v${version}`;
                    this.version = versionText; // 保存到实例属性

                    if (versionElement) {
                        versionElement.textContent = versionText;
                    }
                    if (aboutVersionElement) {
                        aboutVersionElement.textContent = versionText;
                    }
                    if (currentVersionElement) {
                        currentVersionElement.textContent = versionText;
                    }
                    return;
                }
            }

            // 如果无法从主进程获取，使用全局版本号
            const defaultVersion = window.APP_VERSION || 'v1.2.6';
            this.version = defaultVersion; // 保存到实例属性

            if (versionElement) {
                versionElement.textContent = defaultVersion;
            }
            if (aboutVersionElement) {
                aboutVersionElement.textContent = defaultVersion;
            }
            if (currentVersionElement) {
                currentVersionElement.textContent = defaultVersion;
            }
        } catch (error) {
            console.warn('获取版本号失败:', error);
            // 使用全局版本号
            const defaultVersion = window.APP_VERSION || 'v1.2.6';
            this.version = defaultVersion; // 保存到实例属性

            const versionElement = document.getElementById('version-info');
            const aboutVersionElement = document.getElementById('about-version');
            const currentVersionElement = document.getElementById('current-version-display');

            if (versionElement) {
                versionElement.textContent = defaultVersion;
            }
            if (aboutVersionElement) {
                aboutVersionElement.textContent = defaultVersion;
            }
            if (currentVersionElement) {
                currentVersionElement.textContent = defaultVersion;
            }
        }
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

    // 初始化剪切板检测
    initializeClipboardDetection() {
        console.log('[APP] 初始化剪切板检测...');
        // 记录上次剪切板内容，避免重复检测
        this.lastClipboardContent = '';
        // 监听Ctrl+V键盘事件
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.code === 'KeyV')) {
                console.log('[APP] 检测到Ctrl+V按键，开始检测剪切板...');
                setTimeout(() => {
                    // 用户主动按Ctrl+V，强制检测，不管内容是否变化
                    this.checkClipboardForShare(true);
                }, 120);
            }
        });
        // 额外调试：页面加载后主动检测一次剪切板内容
        setTimeout(() => {
            console.log('[APP] 页面加载后主动检测一次剪切板内容...');
            this.checkClipboardForShare(false);
        }, 500);
    }

    // 初始化播放器集数同步监听
    initializePlayerEpisodeSync() {
        console.log('[APP] 初始化播放器集数同步监听...');

        // 监听播放器窗口发送的集数变化事件
        if (window.electron && window.electron.ipcRenderer) {
            window.electron.ipcRenderer.on('episode-changed', (updateData) => {
                console.log('[APP] 收到播放器集数变化通知:', updateData);
                this.handlePlayerEpisodeChanged(updateData);
            });

            console.log('[APP] 播放器集数同步监听已启用');
        } else {
            console.warn('[APP] Electron IPC不可用，无法启用播放器集数同步');
        }
    }

    // 处理播放器集数变化
    handlePlayerEpisodeChanged(updateData) {
        try {
            console.log('[APP] 处理播放器集数变化:', updateData);

            // 检查当前是否在详情页面，且是同一个视频
            if (this.currentPage === 'detail' &&
                this.componentService.currentVideoData &&
                this.componentService.currentVideoData.vod_id === updateData.videoId) {

                console.log('[APP] 当前正在查看此视频详情页，同步更新集数显示');

                // 通知组件服务更新当前集数显示
                this.componentService.syncCurrentEpisode(updateData);

                // 可选：显示一个小提示告诉用户播放器切换了集数
                this.componentService.showNotification(
                    `播放器已切换到：${updateData.episodeName}`,
                    'info'
                );
            } else {
                console.log('[APP] 当前不在对应视频详情页，忽略集数同步');
            }
        } catch (error) {
            console.error('[APP] 处理播放器集数变化失败:', error);
        }
    }

    // 检测剪切板中的分享内容
    async checkClipboardForShare(forceCheck = false) {
        try {
            // 读取剪切板内容
            let clipboardText = '';
            // 优先使用Electron的剪切板API
            if (window.electron && window.electron.clipboard) {
                clipboardText = await window.electron.clipboard.readText();
                console.log('[APP] Electron剪切板内容:', clipboardText);
            } else {
                clipboardText = await navigator.clipboard.readText();
                console.log('[APP] Web剪切板内容:', clipboardText);
            }

            // 如果内容为空，直接返回
            if (!clipboardText) {
                console.log('[APP] 剪切板内容为空');
                return;
            }

            // 如果不是强制检测且内容没有变化，跳过检测
            if (!forceCheck && clipboardText === this.lastClipboardContent) {
                console.log('[APP] 剪切板内容无变化，跳过检测');
                return;
            }

            // 如果是强制检测（用户按Ctrl+V），即使内容相同也要处理
            if (forceCheck && clipboardText === this.lastClipboardContent) {
                console.log('[APP] 用户主动按Ctrl+V，强制检测相同内容');
            }

            this.lastClipboardContent = clipboardText;

            // 检测是否是分享内容
            const shareData = this.parseShareContent(clipboardText);
            if (shareData) {
                console.log('[APP] 检测到分享内容:', shareData);
                this.handleSharedContent(shareData);
            } else {
                console.log('[APP] 剪切板内容不是分享码');
                // 如果是用户主动按Ctrl+V但不是分享码，给出提示
                if (forceCheck) {
                    this.componentService.showNotification('剪切板中没有检测到有效的分享码', 'info');
                }
            }
        } catch (error) {
            console.debug('[APP] 剪切板读取失败:', error.message);
            // 如果是用户主动按Ctrl+V但读取失败，给出提示
            if (forceCheck) {
                this.componentService.showNotification('无法读取剪切板内容，请检查权限设置', 'warning');
            }
        }
    }

    // 解析分享内容
    parseShareContent(text) {
        try {
            // 检测分享内容的标识
            if (!text.includes('【七星追剧】剧集分享') || !text.includes('🔐 分享码：')) {
                return null;
            }

            // 提取分享码
            const shareCodeMatch = text.match(/🔐 分享码：([^\n\r]+)/);
            if (!shareCodeMatch) {
                return null;
            }

            const encryptedData = shareCodeMatch[1].trim();

            // 解密分享码
            const shareData = this.componentService.decryptShareData(encryptedData);
            if (!shareData) {
                console.warn('[APP] 分享码解密失败');
                return null;
            }

            // 验证数据完整性
            if (!shareData.siteName || !shareData.videoName || !shareData.videoId || !shareData.detailUrl) {
                console.warn('[APP] 分享数据不完整:', shareData);
                return null;
            }

            return shareData;
        } catch (error) {
            console.error('[APP] 解析分享内容失败:', error);
            return null;
        }
    }

    // 处理分享内容
    async handleSharedContent(shareData) {
        try {
            console.log('[APP] 处理分享内容:', shareData);
            console.log('[APP] 当前页面:', this.currentPage);
            console.log('[APP] 当前视频数据:', this.componentService.currentVideoData);

            // 简化判断：只检查当前页面是否就是被分享的剧集
            if (this.currentPage === 'detail' &&
                this.componentService.currentVideoData &&
                this.componentService.currentVideoData.vod_id === shareData.videoId) {

                console.log('[APP] 当前已在查看此剧集，无需跳转');
                this.componentService.showNotification('你已经在观看这个剧集了！', 'info');
                return;
            }

            // 不是被分享的剧集页面，显示跳转确认对话框
            console.log('[APP] 不在被分享的剧集页面，显示跳转确认对话框');
            this.showShareConfirmDialog(shareData);
        } catch (error) {
            console.error('[APP] 处理分享内容失败:', error);
        }
    }

    // 显示分享跳转确认对话框
    showShareConfirmDialog(shareData) {
        const content = `
            <div class="share-confirm-dialog">
                <h3>🎬 发现分享剧集</h3>
                <div class="share-info">
                    <div class="share-video-info">
                        ${shareData.videoPic ? `<img src="${shareData.videoPic}" alt="${shareData.videoName}" class="share-poster">` : ''}
                        <div class="share-details">
                            <h4>${shareData.videoName}</h4>
                            <p class="share-source">来源：${shareData.siteName}</p>
                            ${shareData.videoRemarks ? `<p class="share-remarks">${shareData.videoRemarks}</p>` : ''}
                            <p class="share-time">分享时间：${new Date(shareData.timestamp).toLocaleString()}</p>
                        </div>
                    </div>
                </div>
                <p class="confirm-message">是否跳转到此剧集页面？</p>
                <div class="form-actions">
                    <button type="button" class="btn-primary" id="goto-shared-btn">立即跳转</button>
                    <button type="button" class="btn-secondary" id="ignore-shared-btn">忽略</button>
                </div>
            </div>
        `;

        this.componentService.showModal(content);

        // 跳转按钮事件
        document.getElementById('goto-shared-btn').addEventListener('click', async () => {
            this.componentService.hideModal();
            await this.navigateToSharedVideo(shareData);
        });

        // 忽略按钮事件
        document.getElementById('ignore-shared-btn').addEventListener('click', () => {
            this.componentService.hideModal();
        });
    }

    // 跳转到分享的视频
    async navigateToSharedVideo(shareData) {
        try {
            console.log('[APP] 开始跳转到分享视频:', shareData);
            this.componentService.showNotification('正在加载分享的剧集...', 'info');

            // 检查站点是否存在，如果不存在则添加
            console.log('[APP] 步骤1: 确保站点存在');
            await this.ensureShareSiteExists(shareData);

            // 重新初始化API服务以加载新站点
            console.log('[APP] 步骤2: 重新初始化API服务');
            await this.apiService.initialize();

            // 切换到对应站点
            console.log('[APP] 步骤3: 查找目标站点');
            const sites = this.apiService.getSites();
            const targetSite = sites.find(site => site.url === shareData.siteUrl);
            if (!targetSite) {
                throw new Error('无法找到对应的站点');
            }

            console.log('[APP] 找到目标站点:', targetSite);

            // 设置当前站点
            console.log('[APP] 步骤4: 设置当前站点');
            this.apiService.setActiveSite(targetSite.id);

            // 验证当前站点是否设置成功
            const currentSite = this.apiService.getActiveSite();
            console.log('[APP] 当前激活站点验证:', currentSite);

            if (!currentSite || currentSite.url !== shareData.siteUrl) {
                throw new Error('站点切换失败');
            }

            // 重新加载站点选择器和分类选择器
            console.log('[APP] 步骤5: 重新加载选择器');
            await this.loadSiteSelector();
            await this.loadCategorySelector();

            // 确保先切换到详情页面
            console.log('[APP] 步骤6: 切换到详情页');
            this.componentService.switchPage('detail');

            // 强制更新当前页面状态
            this.currentPage = 'detail';

            console.log('[APP] 步骤7: 获取视频详情，videoId:', shareData.videoId);

            // 添加超时保护，防止无限等待
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('获取视频详情超时')), 10000);
            });

            const detailPromise = this.componentService.showVideoDetail(shareData.videoId);

            // 使用Promise.race来避免无限等待
            await Promise.race([detailPromise, timeoutPromise]);

            // 等待一下确保页面渲染完成
            setTimeout(() => {
                this.componentService.showNotification(`已跳转到《${shareData.videoName}》`, 'success');
            }, 500);

        } catch (error) {
            console.error('[APP] 跳转到分享视频失败:', error);
            this.componentService.showNotification('跳转失败：' + error.message, 'error');
        }
    }

    // 确保分享的站点存在
    async ensureShareSiteExists(shareData) {
        const sites = this.apiService.getSites();
        const existingSite = sites.find(site => site.url === shareData.siteUrl);

        if (!existingSite) {
            // 站点不存在，添加新站点
            const newSiteData = {
                name: shareData.siteName,
                url: shareData.siteUrl,
                type: 'json', // 假设是JSON类型，实际可以通过测试确定
                blockedRoutes: ''
            };

            try {
                // 使用API服务添加站点，这样会正确处理ID生成和保存
                const newSite = this.apiService.addSite(newSiteData);
                console.log('[APP] 已添加分享的站点:', newSite);
            } catch (error) {
                console.error('[APP] 添加分享站点失败:', error);
                // 如果API服务添加失败，抛出错误
                throw new Error('添加分享站点失败: ' + error.message);
            }
        } else {
            console.log('[APP] 分享的站点已存在:', existingSite);
        }
    }

    // 设置更新检查功能
    setupUpdateChecker() {
        const checkUpdateBtn = document.getElementById('check-update-btn');
        const downloadUpdateBtn = document.getElementById('download-update-btn');
        const updateStatus = document.getElementById('update-status');
        const updateMessage = document.getElementById('update-message');

        if (!checkUpdateBtn) {
            console.warn('[APP] 未找到检查更新按钮');
            return;
        }

        // 检查更新按钮事件
        checkUpdateBtn.addEventListener('click', async () => {
            await this.checkForUpdates();
        });

        // 下载最新版按钮事件
        if (downloadUpdateBtn) {
            downloadUpdateBtn.addEventListener('click', async () => {
                const url = 'https://gitee.com/fjcq/qixing-zhuiju/releases/latest';
                await this.openExternalLink(url, '下载页面');
            });
        }

        console.log('[APP] 更新检查功能已初始化');
    }

    // 检查更新
    async checkForUpdates() {
        const checkUpdateBtn = document.getElementById('check-update-btn');
        const downloadUpdateBtn = document.getElementById('download-update-btn');
        const updateStatus = document.getElementById('update-status');
        const updateMessage = document.getElementById('update-message');

        try {
            // 更新UI状态 - 检查中
            if (checkUpdateBtn) {
                checkUpdateBtn.classList.add('checking');
                checkUpdateBtn.disabled = true;
                checkUpdateBtn.querySelector('span').textContent = '检查中...';
            }

            if (updateStatus) {
                updateStatus.style.display = 'block';
                updateStatus.className = 'update-status checking';
            }

            if (updateMessage) {
                updateMessage.textContent = '正在检查更新，请稍候...';
            }

            if (downloadUpdateBtn) {
                downloadUpdateBtn.style.display = 'none';
            }

            console.log('[APP] 开始检查更新...');

            // 调用Gitee API获取最新版本信息
            const response = await fetch('https://gitee.com/api/v5/repos/fjcq/qixing-zhuiju/releases/latest');

            if (!response.ok) {
                throw new Error(`API请求失败: ${response.status}`);
            }

            const releaseData = await response.json();
            console.log('[APP] 获取到最新版本信息:', releaseData);

            const latestVersion = releaseData.tag_name;
            const releaseDate = new Date(releaseData.created_at).toLocaleDateString('zh-CN');
            const releaseNotes = releaseData.body || '暂无更新说明';

            // 比较版本
            const currentVersion = this.version || 'v1.2.6';
            const isNewerVersion = this.compareVersions(latestVersion, currentVersion);

            if (isNewerVersion) {
                // 有新版本
                if (updateStatus) {
                    updateStatus.className = 'update-status update-available';
                }

                if (updateMessage) {
                    updateMessage.textContent = `发现新版本 ${latestVersion}，点击下方按钮下载！`;
                }

                // 显示下载按钮
                if (downloadUpdateBtn) {
                    downloadUpdateBtn.style.display = 'block';
                }

                this.componentService.showNotification(`发现新版本 ${latestVersion}`, 'info');
            } else {
                // 已是最新版本
                if (updateStatus) {
                    updateStatus.className = 'update-status up-to-date';
                }

                if (updateMessage) {
                    updateMessage.textContent = '您使用的已是最新版本！';
                }

                this.componentService.showNotification('您使用的已是最新版本', 'success');
            }

        } catch (error) {
            console.error('[APP] 检查更新失败:', error);

            if (updateStatus) {
                updateStatus.className = 'update-status error';
            }

            if (updateMessage) {
                updateMessage.textContent = `检查更新失败: ${error.message}`;
            }

            this.componentService.showNotification('检查更新失败: ' + error.message, 'error');
        } finally {
            // 恢复按钮状态
            if (checkUpdateBtn) {
                checkUpdateBtn.classList.remove('checking');
                checkUpdateBtn.disabled = false;
                checkUpdateBtn.querySelector('span').textContent = '检查更新';
            }
        }
    }

    // 比较版本号
    compareVersions(version1, version2) {
        // 移除 'v' 前缀并分割版本号
        const v1 = version1.replace(/^v/, '').split('.').map(Number);
        const v2 = version2.replace(/^v/, '').split('.').map(Number);

        // 确保数组长度一致
        const maxLength = Math.max(v1.length, v2.length);
        while (v1.length < maxLength) v1.push(0);
        while (v2.length < maxLength) v2.push(0);

        // 逐位比较
        for (let i = 0; i < maxLength; i++) {
            if (v1[i] > v2[i]) return true;  // version1 > version2
            if (v1[i] < v2[i]) return false; // version1 < version2
        }

        return false; // 版本相同
    }

    // 打开外部链接
    async openExternalLink(url, linkName = '链接') {
        console.log(`[APP] 准备打开${linkName}:`, url);

        if (window.electronAPI && window.electronAPI.openExternal) {
            try {
                const result = await window.electronAPI.openExternal(url);
                console.log(`[APP] ${linkName}打开结果:`, result);

                if (result && result.success) {
                    this.componentService.showNotification(`已打开${linkName}`, 'success');
                } else {
                    this.componentService.showNotification(`打开${linkName}失败: ` + (result?.error || '未知错误'), 'error');
                }
            } catch (error) {
                console.error(`[APP] 打开${linkName}异常:`, error);
                this.componentService.showNotification(`打开${linkName}异常: ` + error.message, 'error');
            }
        } else {
            console.warn('[APP] electronAPI不可用');
            this.componentService.showNotification(`请手动访问: ${url}`, 'info');
        }
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
