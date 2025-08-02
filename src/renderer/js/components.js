// 组件模块 - UI组件和工具函数
class ComponentService {
    constructor() {
        this.modal = null;
        this.currentVideoData = null;
        this.apiService = null;
        this.storageService = null;
    }

    // 初始化组件
    initialize(apiService, storageService) {
        this.apiService = apiService;
        this.storageService = storageService;
        this.modal = document.getElementById('modal');
        this.setupEventListeners();
    }

    // 设置事件监听器
    setupEventListeners() {
        // 模态框关闭事件
        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.hideModal();
                }
            });
        }

        // ESC键关闭模态框
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modal && this.modal.style.display !== 'none') {
                this.hideModal();
            }
        });
    }

    // 显示模态框
    showModal() {
        if (this.modal) {
            this.modal.style.display = 'flex';
        }
    }

    // 隐藏模态框
    hideModal() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    // 创建视频卡片
    createVideoCard(video) {
        console.log('[DEBUG] 创建视频卡片:', video);

        const card = document.createElement('div');
        card.className = 'video-card';
        card.dataset.videoId = video.vod_id;

        // 处理图片URL
        let posterUrl = video.vod_pic || '';
        console.log('[DEBUG] 原始海报URL:', posterUrl);

        if (posterUrl && !posterUrl.startsWith('http')) {
            posterUrl = 'https:' + posterUrl;
            console.log('[DEBUG] 修正后海报URL:', posterUrl);
        }

        // 视频基本信息
        const videoTitle = video.vod_name || '未知标题';
        const videoType = video.type_name || '未知类型';
        const videoRemarks = video.vod_remarks || '';
        const videoTime = video.vod_time || '';
        const videoYear = video.vod_year || '';

        // 构建元数据显示
        const metaItems = [];
        if (videoType && videoType !== '未知类型') metaItems.push(videoType);
        if (videoRemarks) metaItems.push(videoRemarks);
        if (videoYear) metaItems.push(videoYear);
        if (videoTime) metaItems.push(videoTime);

        const videoMeta = metaItems.join(' / ') || '暂无信息';

        console.log('[DEBUG] 视频信息:', {
            title: videoTitle,
            type: videoType,
            remarks: videoRemarks,
            time: videoTime,
            year: videoYear,
            meta: videoMeta,
            poster: posterUrl
        });

        card.innerHTML = `
            <div class="video-poster">
                ${posterUrl ?
                `<img src="${posterUrl}" alt="${videoTitle}" 
                         onerror="console.log('图片加载失败:', this.src); this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjI4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjNDA0MDQwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPuaaguaXoOa1t+aKpTwvdGV4dD48L3N2Zz4=';"
                         onload="console.log('图片加载成功:', this.src);">` :
                `<div class="poster-placeholder">暂无海报</div>`
            }
                <!-- 图片覆盖信息层 -->
                <div class="poster-overlay">
                    <!-- 左上角：类型 -->
                    <div class="poster-type">${videoType}</div>
                    <!-- 右上角：备注 -->
                    ${videoRemarks ? `<div class="poster-remarks">${videoRemarks}</div>` : ''}
                    <!-- 底部：时间信息 -->
                    <div class="poster-time">
                        ${videoTime ? videoTime : ''}
                    </div>
                </div>
            </div>
            <div class="video-info">
                <h3 class="video-title">${videoTitle}</h3>
            </div>
        `;

        // 添加点击事件
        card.addEventListener('click', () => {
            console.log('[DEBUG] 点击视频卡片:', video.vod_id);
            this.showVideoDetail(video.vod_id);
        });

        console.log('[DEBUG] 视频卡片创建完成');
        return card;
    }

    // 创建历史记录项
    createHistoryItem(history) {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.videoId = history.id;

        let posterUrl = history.pic || '';
        if (posterUrl && !posterUrl.startsWith('http')) {
            posterUrl = 'https:' + posterUrl;
        }

        item.innerHTML = `
            <div class="history-poster">
                <img src="${posterUrl}" alt="${history.name}" 
                     onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPuaaguaXoOa1t+aKpTwvdGV4dD48L3N2Zz4='; this.alt='暂无海报';">
            </div>
            <div class="history-info">
                <h4 class="history-title">${history.name}</h4>
                <p class="history-episode">${history.episodeName || '未知集数'}</p>
                <p class="history-time">${new Date(history.watchTime).toLocaleString()}</p>
                <div class="history-progress">
                    <div class="progress-bar" style="width: ${(history.currentTime / history.duration * 100) || 0}%"></div>
                </div>
            </div>
        `;

        // 添加点击事件
        item.addEventListener('click', () => {
            this.showVideoDetail(history.id);
        });

        return item;
    }

    // 显示视频详情
    async showVideoDetail(videoId) {
        try {
            console.log('[COMPONENTS] 显示视频详情:', videoId);

            const detailPage = document.getElementById('detail-page');
            const detailContent = document.getElementById('detail-content');

            // 显示加载状态
            detailContent.innerHTML = '<div class="loading">加载详情中...</div>';

            // 切换到详情页
            this.switchPage('detail');

            // 优先从缓存获取视频详情
            console.log('[COMPONENTS] 尝试从缓存获取详情...');
            let response = await this.apiService.getVideoDetail(videoId);
            console.log('[COMPONENTS] 获取到视频详情:', response);

            if (response && response.list && response.list.length > 0) {
                const video = response.list[0];
                this.currentVideoData = video;
                console.log('[COMPONENTS] 准备渲染视频详情:', video.vod_name);
                this.renderVideoDetail(video);
            } else {
                console.warn('[COMPONENTS] 详情数据格式不正确或无数据:', response);
                detailContent.innerHTML = '<div class="empty-state"><p>获取视频详情失败</p></div>';
            }
        } catch (error) {
            console.error('[COMPONENTS] 获取视频详情失败:', error);
            const detailContent = document.getElementById('detail-content');
            detailContent.innerHTML = '<div class="empty-state"><p>获取视频详情失败，请重试</p></div>';
        }
    }

    // 渲染视频详情
    renderVideoDetail(video) {
        console.log('渲染视频详情:', video);

        const detailContent = document.getElementById('detail-content');
        const detailTitle = document.getElementById('detail-title');

        detailTitle.textContent = video.vod_name;

        const posterUrl = video.vod_pic || '';
        // 传入vod_play_from字段作为线路名称来源
        const playData = this.apiService.parsePlayUrls(video.vod_play_url, video.vod_play_from);
        const { routes, allEpisodes } = playData;

        console.log('解析到的播放数据:', playData);
        console.log('视频播放来源字段:', video.vod_play_from);

        // 存储当前视频数据和线路信息
        this.currentVideoData = video;
        this.currentRoutes = routes;
        this.currentActiveRoute = 0; // 默认选中第一个线路

        detailContent.innerHTML = `
            <div class="detail-container">
                <div class="detail-poster">
                    ${posterUrl ? `<img src="${posterUrl}" alt="${video.vod_name}" onerror="this.style.display='none';">` : '<div class="video-poster">暂无海报</div>'}
                </div>
                <div class="detail-info">
                    <h2 class="detail-title">${video.vod_name}</h2>
                    
                    <!-- 基本信息区域 -->
                    <div class="detail-meta">
                        <div class="meta-grid">
                            <div class="meta-item">
                                <span class="meta-label">类型</span>
                                <span class="meta-value">${video.type_name || '未知'}</span>
                            </div>
                            <div class="meta-item">
                                <span class="meta-label">状态</span>
                                <span class="meta-value">${video.vod_remarks || '更新中'}</span>
                            </div>
                            <div class="meta-item">
                                <span class="meta-label">年份</span>
                                <span class="meta-value">${video.vod_year || '未知'}</span>
                            </div>
                            <div class="meta-item">
                                <span class="meta-label">地区</span>
                                <span class="meta-value">${video.vod_area || '未知'}</span>
                            </div>
                            ${video.vod_lang ? `
                            <div class="meta-item">
                                <span class="meta-label">语言</span>
                                <span class="meta-value">${video.vod_lang}</span>
                            </div>
                            ` : ''}
                            ${video.vod_score ? `
                            <div class="meta-item">
                                <span class="meta-label">评分</span>
                                <span class="meta-value score">${video.vod_score}</span>
                            </div>
                            ` : ''}
                            ${video.vod_total ? `
                            <div class="meta-item">
                                <span class="meta-label">总集数</span>
                                <span class="meta-value">${video.vod_total}集</span>
                            </div>
                            ` : ''}
                            ${video.vod_serial ? `
                            <div class="meta-item">
                                <span class="meta-label">更新至</span>
                                <span class="meta-value">${video.vod_serial}集</span>
                            </div>
                            ` : ''}
                            ${video.vod_duration ? `
                            <div class="meta-item">
                                <span class="meta-label">时长</span>
                                <span class="meta-value">${video.vod_duration}</span>
                            </div>
                            ` : ''}
                        </div>
                        
                        ${video.vod_director ? `
                        <div class="meta-full-row">
                            <span class="meta-label">导演</span>
                            <span class="meta-value">${video.vod_director}</span>
                        </div>
                        ` : ''}
                        ${video.vod_actor ? `
                        <div class="meta-full-row">
                            <span class="meta-label">主演</span>
                            <span class="meta-value">${video.vod_actor}</span>
                        </div>
                        ` : ''}
                        ${video.vod_writer ? `
                        <div class="meta-full-row">
                            <span class="meta-label">编剧</span>
                            <span class="meta-value">${video.vod_writer}</span>
                        </div>
                        ` : ''}
                    </div>
                    
                    <!-- 标签区域 -->
                    ${video.vod_tag ? `
                    <div class="detail-tags">
                        ${video.vod_tag.split(',').map(tag =>
            `<span class="tag">${tag.trim()}</span>`
        ).join('')}
                    </div>
                    ` : ''}
                    
                    <!-- 简介区域 -->
                    <div class="detail-desc">
                        <h4>剧情简介</h4>
                        <p>${video.vod_content ? video.vod_content.replace(/<[^>]*>/g, '') : '暂无简介'}</p>
                    </div>
                    
                    ${routes && routes.length > 0 ? `
                        <div class="episodes-section">
                            <h3>播放列表</h3>
                            <!-- 线路切换标签 -->
                            <div class="route-tabs">
                                ${routes.map((route, index) => `
                                    <button class="route-tab ${index === 0 ? 'active' : ''}" data-route-index="${index}">
                                        ${route.name} (${route.episodes.length}集)
                                    </button>
                                `).join('')}
                            </div>
                            <!-- 当前线路的剧集列表 -->
                            <div class="episodes-container">
                                <div class="episodes-grid" id="episodes-grid">
                                    <!-- 剧集将通过JS动态加载 -->
                                </div>
                            </div>
                        </div>
                    ` : '<p>暂无播放资源</p>'}
                </div>
            </div>
        `;

        if (routes && routes.length > 0) {
            // 设置线路切换事件
            this.setupRouteTabEvents();
            // 加载默认线路的剧集
            this.loadRouteEpisodes(0);
        }
    }

    // 设置线路切换标签事件
    setupRouteTabEvents() {
        const routeTabs = document.querySelectorAll('.route-tab');
        routeTabs.forEach((tab, index) => {
            tab.addEventListener('click', () => {
                // 更新标签状态
                routeTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // 加载对应线路的剧集
                this.currentActiveRoute = index;
                this.loadRouteEpisodes(index);
            });
        });
    }

    // 加载指定线路的剧集
    loadRouteEpisodes(routeIndex) {
        if (!this.currentRoutes || !this.currentRoutes[routeIndex]) {
            console.error('线路数据不存在:', routeIndex);
            return;
        }

        const route = this.currentRoutes[routeIndex];
        const episodesGrid = document.getElementById('episodes-grid');

        if (!episodesGrid) {
            console.error('剧集容器不存在');
            return;
        }

        console.log('加载线路剧集:', route.name, route.episodes.length);

        // 渲染剧集按钮
        episodesGrid.innerHTML = route.episodes.map((episode, episodeIndex) => `
            <button class="episode-btn" 
                    data-route="${routeIndex}" 
                    data-episode="${episodeIndex}" 
                    data-url="${episode.url}"
                    title="${episode.name} - ${episode.url}">
                ${episode.name}
            </button>
        `).join('');

        // 添加剧集按钮点击事件
        const episodeButtons = episodesGrid.querySelectorAll('.episode-btn');
        episodeButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const routeIndex = parseInt(e.target.dataset.route);
                const episodeIndex = parseInt(e.target.dataset.episode);
                const episodeUrl = e.target.dataset.url;

                console.log('点击播放剧集:', { routeIndex, episodeIndex, episodeUrl });
                this.playVideo(this.currentVideoData, routeIndex, episodeIndex, episodeUrl, this.currentRoutes);
            });
        });
    }

    // 播放视频
    async playVideo(videoData, routeIndex, episodeIndex, episodeUrl, allRoutes) {
        try {
            console.log('[COMPONENTS] 播放视频:', { videoData, routeIndex, episodeIndex, episodeUrl });

            const currentRoute = allRoutes[routeIndex];
            const currentEpisode = currentRoute.episodes[episodeIndex];

            console.log('[COMPONENTS] 当前线路:', currentRoute.name);
            console.log('[COMPONENTS] 当前剧集:', currentEpisode.name);
            console.log('[COMPONENTS] 播放URL:', episodeUrl);

            // 添加到播放历史
            this.storageService.addPlayHistory({
                vod_id: videoData.vod_id,
                vod_name: videoData.vod_name,
                vod_pic: videoData.vod_pic,
                type_name: videoData.type_name || '未知类型',
                current_episode: episodeIndex + 1,
                episode_name: currentEpisode?.name || `第${episodeIndex + 1}集`,
                site_name: '当前站点'
            });

            // 检查Electron环境
            if (!window.electron || !window.electron.ipcRenderer) {
                console.error('[COMPONENTS] Electron IPC 不可用');
                this.showNotification('无法打开播放器 - Electron环境异常', 'error');
                return;
            }

            console.log('[COMPONENTS] 调用Electron IPC打开播放器...');

            // 打开播放器窗口
            const playerData = {
                url: episodeUrl,
                title: `${videoData.vod_name} - ${currentEpisode?.name}`,
                videoData: {
                    ...videoData,
                    currentRoute: routeIndex,
                    currentEpisode: episodeIndex, // 这里传递的是数组索引（从0开始）
                    routes: allRoutes
                }
            };

            console.log('[COMPONENTS] 播放器数据:', playerData);

            try {
                const result = await window.electron.ipcRenderer.invoke('open-player', playerData);
                console.log('[COMPONENTS] IPC调用结果:', result);
                this.showNotification(`正在播放: ${currentEpisode?.name}`, 'success');
            } catch (ipcError) {
                console.error('[COMPONENTS] IPC调用失败:', ipcError);
                this.showNotification(`打开播放器失败: ${ipcError.message}`, 'error');
            }

        } catch (error) {
            console.error('[COMPONENTS] 播放视频失败:', error);
            this.showNotification('播放失败', 'error');
        }
    }

    // 切换页面
    switchPage(pageName) {
        console.log('[COMPONENTS] 开始切换页面到:', pageName);

        // 隐藏所有页面
        const pages = document.querySelectorAll('.page');
        console.log('[COMPONENTS] 找到页面数量:', pages.length);
        pages.forEach((page, index) => {
            console.log('[COMPONENTS] 隐藏页面:', page.id);
            page.classList.remove('active');
        });

        // 显示目标页面
        const targetPage = document.getElementById(`${pageName}-page`);
        console.log('[COMPONENTS] 目标页面元素:', targetPage);
        if (targetPage) {
            targetPage.classList.add('active');
            console.log('[COMPONENTS] 成功激活页面:', `${pageName}-page`);
        } else {
            console.error('[COMPONENTS] 未找到目标页面:', `${pageName}-page`);
        }

        // 更新导航状态
        const navItems = document.querySelectorAll('.nav-item');
        console.log('[COMPONENTS] 找到导航项数量:', navItems.length);
        navItems.forEach(item => {
            item.classList.remove('active');
            const link = item.querySelector('a');
            if (link && link.dataset.page === pageName) {
                item.classList.add('active');
                console.log('[COMPONENTS] 激活导航项:', pageName);
            }
        });

        console.log('[COMPONENTS] 页面切换完成:', pageName);
    }

    // 显示通知
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        // 3秒后移除通知
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    // 创建分页组件
    createPagination(currentPage, totalPages, onPageChange) {
        const pagination = document.createElement('div');
        pagination.className = 'pagination';

        if (totalPages <= 1) {
            return pagination;
        }

        // 上一页按钮
        const prevBtn = document.createElement('button');
        prevBtn.textContent = '上一页';
        prevBtn.disabled = currentPage <= 1;
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                onPageChange(currentPage - 1);
            }
        });
        pagination.appendChild(prevBtn);

        // 页码按钮
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, startPage + 4);

        for (let i = startPage; i <= endPage; i++) {
            const pageBtn = document.createElement('button');
            pageBtn.textContent = i;
            pageBtn.className = i === currentPage ? 'current' : '';
            pageBtn.addEventListener('click', () => {
                onPageChange(i);
            });
            pagination.appendChild(pageBtn);
        }

        // 下一页按钮
        const nextBtn = document.createElement('button');
        nextBtn.textContent = '下一页';
        nextBtn.disabled = currentPage >= totalPages;
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                onPageChange(currentPage + 1);
            }
        });
        pagination.appendChild(nextBtn);

        return pagination;
    }
}

// 导出组件服务
window.ComponentService = ComponentService;
