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

    // 创建站点列表项
    createSiteItem(site) {
        const siteItem = document.createElement('div');
        siteItem.className = 'site-item';
        siteItem.dataset.siteId = site.id;

        const statusClass = site.active ? 'active' : '';
        const statusText = site.active ? '当前站点' : '未激活';

        siteItem.innerHTML = `
            <div class="site-info">
                <div class="site-header">
                    <h4 class="site-name">${site.name}</h4>
                    <span class="site-type">${site.type.toUpperCase()}</span>
                    <span class="site-status ${statusClass}">${statusText}</span>
                </div>
                <div class="site-details">
                    <p class="site-url">${site.url}</p>
                    <div class="site-actions">
                        <button class="btn-test" data-site-id="${site.id}" title="测试API连接和数据格式">
                            测试
                        </button>
                        <button class="btn-edit" data-site-id="${site.id}" title="编辑站点信息">
                            编辑
                        </button>
                        ${!site.active ? `<button class="btn-activate" data-site-id="${site.id}" title="设为默认站点">
                            设为默认
                        </button>` : ''}
                        <button class="btn-delete" data-site-id="${site.id}" title="删除站点">
                            删除
                        </button>
                    </div>
                </div>
            </div>
        `;

        // 添加事件监听
        const testBtn = siteItem.querySelector('.btn-test');
        const editBtn = siteItem.querySelector('.btn-edit');
        const activateBtn = siteItem.querySelector('.btn-activate');
        const deleteBtn = siteItem.querySelector('.btn-delete');

        testBtn?.addEventListener('click', () => this.testSiteConnection(site));
        editBtn?.addEventListener('click', () => this.showEditSiteModal(site));
        activateBtn?.addEventListener('click', () => this.activateSite(site.id));
        deleteBtn?.addEventListener('click', () => this.confirmDeleteSite(site));

        return siteItem;
    }

    // 显示添加站点模态框
    showAddSiteModal() {
        const content = `
            <h3>添加新站点</h3>
            <form id="add-site-form" class="site-form">
                <div class="form-group">
                    <label for="site-name">站点名称</label>
                    <input type="text" id="site-name" name="name" required placeholder="如：七星追剧">
                </div>
                <div class="form-group">
                    <label for="site-url">API地址</label>
                    <input type="url" id="site-url" name="url" required 
                           placeholder="如：https://zj.qxyys.com/api.php/provide/vod/">
                </div>
                <div class="form-group">
                    <label for="site-type">API类型</label>
                    <select id="site-type" name="type" required>
                        <option value="json">JSON</option>
                        <option value="xml">XML</option>
                    </select>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" id="cancel-btn">取消</button>
                    <button type="button" class="btn-primary" id="test-btn">测试连接</button>
                    <button type="submit" class="btn-primary">添加</button>
                </div>
            </form>
            <div id="test-result" class="test-result hidden"></div>
        `;

        this.showModal(content);

        const form = document.getElementById('add-site-form');
        const cancelBtn = document.getElementById('cancel-btn');
        const testBtn = document.getElementById('test-btn');

        cancelBtn.addEventListener('click', () => this.hideModal());
        testBtn.addEventListener('click', () => this.testFormSite('add'));

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const siteData = {
                name: formData.get('name'),
                url: formData.get('url'),
                type: formData.get('type')
            };

            try {
                this.apiService.addSite(siteData);
                this.hideModal();
                this.showNotification('站点添加成功', 'success');
                // 刷新站点列表和站点选择器
                if (window.app) {
                    window.app.loadSettings();
                    window.app.loadSiteSelector();
                }
            } catch (error) {
                this.showNotification('添加失败：' + error.message, 'error');
            }
        });
    }

    // 显示编辑站点模态框
    showEditSiteModal(site) {
        const content = `
            <h3>编辑站点</h3>
            <form id="edit-site-form" class="site-form">
                <div class="form-group">
                    <label for="edit-site-name">站点名称</label>
                    <input type="text" id="edit-site-name" name="name" required value="${site.name}">
                </div>
                <div class="form-group">
                    <label for="edit-site-url">API地址</label>
                    <input type="url" id="edit-site-url" name="url" required value="${site.url}">
                </div>
                <div class="form-group">
                    <label for="edit-site-type">API类型</label>
                    <select id="edit-site-type" name="type" required>
                        <option value="json" ${site.type === 'json' ? 'selected' : ''}>JSON</option>
                        <option value="xml" ${site.type === 'xml' ? 'selected' : ''}>XML</option>
                    </select>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" id="cancel-edit-btn">取消</button>
                    <button type="button" class="btn-primary" id="test-edit-btn">测试连接</button>
                    <button type="submit" class="btn-primary">保存</button>
                </div>
            </form>
            <div id="test-result" class="test-result hidden"></div>
        `;

        this.showModal(content);

        const form = document.getElementById('edit-site-form');
        const cancelBtn = document.getElementById('cancel-edit-btn');
        const testBtn = document.getElementById('test-edit-btn');

        cancelBtn.addEventListener('click', () => this.hideModal());
        testBtn.addEventListener('click', () => this.testFormSite('edit'));

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const siteData = {
                name: formData.get('name'),
                url: formData.get('url'),
                type: formData.get('type')
            };

            try {
                this.apiService.updateSite(site.id, siteData);
                this.hideModal();
                this.showNotification('站点更新成功', 'success');
                // 刷新站点列表
                if (window.app) {
                    window.app.loadSettings();
                    window.app.loadSiteSelector();
                }
            } catch (error) {
                this.showNotification('更新失败：' + error.message, 'error');
            }
        });
    }

    // 测试表单中的站点连接
    async testFormSite(formType) {
        const nameInput = document.getElementById(formType === 'add' ? 'site-name' : 'edit-site-name');
        const urlInput = document.getElementById(formType === 'add' ? 'site-url' : 'edit-site-url');
        const typeSelect = document.getElementById(formType === 'add' ? 'site-type' : 'edit-site-type');
        const testResult = document.getElementById('test-result');

        if (!urlInput.value || !typeSelect.value) {
            this.showNotification('请填写完整的站点信息', 'warning');
            return;
        }

        testResult.className = 'test-result testing';
        testResult.innerHTML = '<div class="loading-spinner">🔄</div> 正在测试API连接和数据格式...';
        testResult.classList.remove('hidden');

        try {
            const result = await this.apiService.testSiteConnection(urlInput.value, typeSelect.value);

            if (result.success) {
                testResult.className = 'test-result success';
                testResult.innerHTML = `
                    <div class="test-header">
                        <i>✅</i> 
                        <strong>测试通过</strong>
                    </div>
                    <div class="test-details">
                        ${result.message.split('\n').map(line => `<div>${line}</div>`).join('')}
                    </div>
                `;
            } else {
                testResult.className = 'test-result error';
                testResult.innerHTML = `
                    <div class="test-header">
                        <i>❌</i> 
                        <strong>测试失败</strong>
                    </div>
                    <div class="test-details">
                        ${result.message.split('\n').map(line => `<div>${line}</div>`).join('')}
                    </div>
                `;
            }
        } catch (error) {
            testResult.className = 'test-result error';
            testResult.innerHTML = `
                <div class="test-header">
                    <i>❌</i> 
                    <strong>测试失败</strong>
                </div>
                <div class="test-details">
                    <div>连接失败：${error.message}</div>
                </div>
            `;
        }
    }

    // 测试站点连接
    async testSiteConnection(site) {
        // 显示加载通知
        this.showNotification('正在测试API连接...', 'info');

        try {
            const testResult = await this.apiService.testSiteConnection(site.url, site.type);

            if (testResult.success) {
                this.showNotification('API测试通过！', 'success');

                // 显示详细测试结果
                const detailContent = `
                    <h3>API测试结果</h3>
                    <div class="test-result-detail">
                        <div class="test-success">
                            <i>✅</i> <strong>测试通过</strong>
                        </div>
                        <div class="test-info">
                            <h4>站点信息：</h4>
                            <p><strong>名称：</strong>${site.name}</p>
                            <p><strong>地址：</strong>${site.url}</p>
                            <p><strong>类型：</strong>${site.type.toUpperCase()}</p>
                        </div>
                        <div class="test-details">
                            <h4>测试详情：</h4>
                            ${testResult.message.split('\n').map(line => `<div class="test-line">${line}</div>`).join('')}
                        </div>
                    </div>
                    <div class="form-actions">
                        <button type="button" class="btn-primary" onclick="window.app.componentService.hideModal()">确定</button>
                    </div>
                `;

                this.showModal(detailContent);
            } else {
                this.showNotification(`API测试失败：${testResult.message}`, 'error');
            }
        } catch (error) {
            this.showNotification(`测试失败：${error.message}`, 'error');
        }
    }    // 激活站点
    activateSite(siteId) {
        try {
            this.apiService.setActiveSite(siteId);
            this.showNotification('站点已设为默认', 'success');
            // 刷新相关界面
            if (window.app) {
                window.app.loadSettings();
                window.app.loadSiteSelector();
                window.app.loadCategorySelector();
            }
        } catch (error) {
            this.showNotification('设置失败：' + error.message, 'error');
        }
    }

    // 确认删除站点
    confirmDeleteSite(site) {
        const content = `
            <h3>删除确认</h3>
            <p>确定要删除站点 "<strong>${site.name}</strong>" 吗？</p>
            <p>此操作不可撤销。</p>
            <div class="form-actions">
                <button type="button" class="btn-secondary" id="cancel-delete-btn">取消</button>
                <button type="button" class="btn-delete" id="confirm-delete-btn">删除</button>
            </div>
        `;

        this.showModal(content);

        const cancelBtn = document.getElementById('cancel-delete-btn');
        const confirmBtn = document.getElementById('confirm-delete-btn');

        cancelBtn.addEventListener('click', () => this.hideModal());
        confirmBtn.addEventListener('click', () => {
            try {
                this.apiService.deleteSite(site.id);
                this.hideModal();
                this.showNotification('站点已删除', 'success');
                // 刷新相关界面
                if (window.app) {
                    window.app.loadSettings();
                    window.app.loadSiteSelector();
                }
            } catch (error) {
                this.showNotification('删除失败：' + error.message, 'error');
            }
        });
    }

    // 显示模态框
    showModal(content) {
        if (this.modal) {
            const modalBody = this.modal.querySelector('#modal-body');
            if (modalBody) {
                modalBody.innerHTML = content;
            }
            this.modal.classList.remove('hidden');
            this.modal.style.display = 'flex';

            // 添加关闭按钮事件
            const closeBtn = this.modal.querySelector('.close');
            if (closeBtn) {
                closeBtn.onclick = () => this.hideModal();
            }
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
                <h3 class="video-title">
                    <span class="video-title-normal">${videoTitle}</span>
                    <div class="video-title-marquee">
                        <span class="video-title-text">${videoTitle}</span>
                    </div>
                </h3>
            </div>
        `;

        // 添加点击事件
        card.addEventListener('click', () => {
            console.log('[DEBUG] 点击视频卡片:', video.vod_id);
            this.showVideoDetail(video.vod_id);
        });

        // 添加走马灯效果检测和控制
        setTimeout(() => {
            this.setupMarqueeEffect(card, videoTitle);
        }, 100);

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

    // 检测是否为外部播放器链接
    isExternalPlayerUrl(url) {
        if (!url) return false;

        const lowerUrl = url.toLowerCase();

        // 首先排除直接的视频文件
        const isDirectVideo = ['.m3u8', '.mp4', '.flv', '.avi', '.mkv', '.mov', '.wmv'].some(ext =>
            lowerUrl.includes(ext)
        );

        if (isDirectVideo) {
            console.log('[COMPONENTS] 检测到直接视频文件，使用内置播放器');
            return false;
        }

        // 检查外部播放器的特征
        const externalPlayerIndicators = [
            // 播放器页面关键词
            /jiexi|player|play(?!list)|parse|video/i,
            // 常见的播放器参数
            /[?&](url|vid|v|id|play|video|src)=/i,
            // 第三方视频平台
            /(?:iqiyi|qq|youku|bilibili|mgtv|sohu|163|sina)\.com/i,
            // 解析接口
            /(?:api|parse|jx|player)\.php/i,
            // HTML播放页面
            /\.html?.*[?&]/i
        ];

        const hasExternalIndicator = externalPlayerIndicators.some(pattern => pattern.test(url));

        // 检查域名是否为知名视频平台
        const isKnownVideoPlatform = [
            'iqiyi.com', 'qq.com', 'youku.com', 'bilibili.com',
            'mgtv.com', 'sohu.com', '163.com', 'sina.com'
        ].some(domain => lowerUrl.includes(domain));

        // 检查是否为网页而非直接文件
        const isWebPage = lowerUrl.includes('.html') ||
            lowerUrl.includes('.php') ||
            lowerUrl.includes('.asp') ||
            lowerUrl.includes('.jsp') ||
            (!lowerUrl.includes('.'));

        const isExternal = hasExternalIndicator || (isKnownVideoPlatform && isWebPage);

        console.log('[COMPONENTS] 外部播放器检测:', {
            url: url,
            isDirectVideo,
            hasExternalIndicator,
            isKnownVideoPlatform,
            isWebPage,
            isExternal
        });

        return isExternal;
    }

    // 在外部浏览器中打开链接
    openInExternalBrowser(url, videoTitle) {
        try {
            if (window.electron && window.electron.shell) {
                window.electron.shell.openExternal(url);
                this.showNotification(`正在外部浏览器中播放: ${videoTitle}`, 'success');
                return true;
            } else {
                // 备用方案：尝试在新窗口中打开
                window.open(url, '_blank');
                this.showNotification(`正在新窗口中播放: ${videoTitle}`, 'success');
                return true;
            }
        } catch (error) {
            console.error('[COMPONENTS] 外部浏览器打开失败:', error);
            this.showNotification('无法在外部浏览器中打开链接', 'error');
            return false;
        }
    }

    // 显示播放方式选择对话框
    showPlayModeDialog(videoData, routeIndex, episodeIndex, episodeUrl, allRoutes) {
        const currentRoute = allRoutes[routeIndex];
        const currentEpisode = currentRoute.episodes[episodeIndex];

        const content = `
            <h3>选择播放方式</h3>
            <div class="play-mode-dialog">
                <div class="video-info">
                    <h4>${videoData.vod_name}</h4>
                    <p>${currentEpisode?.name}</p>
                    <p class="url-preview">${episodeUrl}</p>
                </div>
                <div class="play-options">
                    <button type="button" class="btn-primary option-btn" id="play-external">
                        <i>🌐</i>
                        <div>
                            <strong>外部浏览器播放</strong>
                            <small>在系统默认浏览器中打开</small>
                        </div>
                    </button>
                    <button type="button" class="btn-primary option-btn" id="play-internal">
                        <i>📱</i>
                        <div>
                            <strong>内置播放器播放</strong>
                            <small>使用应用内置播放器</small>
                        </div>
                    </button>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" id="cancel-play">取消</button>
                </div>
            </div>
        `;

        this.showModal(content);

        const playExternalBtn = document.getElementById('play-external');
        const playInternalBtn = document.getElementById('play-internal');
        const cancelBtn = document.getElementById('cancel-play');

        playExternalBtn.addEventListener('click', () => {
            this.hideModal();
            this.playVideoExternal(videoData, routeIndex, episodeIndex, episodeUrl, allRoutes);
        });

        playInternalBtn.addEventListener('click', () => {
            this.hideModal();
            this.playVideoInternal(videoData, routeIndex, episodeIndex, episodeUrl, allRoutes);
        });

        cancelBtn.addEventListener('click', () => {
            this.hideModal();
        });
    }

    // 在外部播放器中播放
    async playVideoExternal(videoData, routeIndex, episodeIndex, episodeUrl, allRoutes) {
        const currentRoute = allRoutes[routeIndex];
        const currentEpisode = currentRoute.episodes[episodeIndex];

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

        const videoTitle = `${videoData.vod_name} - ${currentEpisode?.name}`;
        this.openInExternalBrowser(episodeUrl, videoTitle);
    }

    // 在内置播放器中播放
    async playVideoInternal(videoData, routeIndex, episodeIndex, episodeUrl, allRoutes) {
        const currentRoute = allRoutes[routeIndex];
        const currentEpisode = currentRoute.episodes[episodeIndex];

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

        // 打开播放器窗口
        const playerData = {
            url: episodeUrl,
            title: `${videoData.vod_name} - ${currentEpisode?.name}`,
            videoData: {
                ...videoData,
                currentRoute: routeIndex,
                currentEpisode: episodeIndex,
                routes: allRoutes
            }
        };

        try {
            const result = await window.electron.ipcRenderer.invoke('open-player', playerData);
            console.log('[COMPONENTS] IPC调用结果:', result);
            this.showNotification(`正在播放: ${currentEpisode?.name}`, 'success');
        } catch (ipcError) {
            console.error('[COMPONENTS] IPC调用失败:', ipcError);
            this.showNotification(`打开播放器失败: ${ipcError.message}`, 'error');
        }
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

            // 检查是否为外部播放器链接
            if (this.isExternalPlayerUrl(episodeUrl)) {
                console.log('[COMPONENTS] 检测到可能的外部播放器链接，显示选择对话框');
                this.showPlayModeDialog(videoData, routeIndex, episodeIndex, episodeUrl, allRoutes);
                return;
            }

            // 直接使用内置播放器
            await this.playVideoInternal(videoData, routeIndex, episodeIndex, episodeUrl, allRoutes);

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

    // 设置走马灯效果
    setupMarqueeEffect(card, titleText) {
        const titleElement = card.querySelector('.video-title');
        const normalSpan = card.querySelector('.video-title-normal');
        const marqueeDiv = card.querySelector('.video-title-marquee');

        if (!titleElement || !normalSpan || !marqueeDiv) {
            return;
        }

        // 创建测量元素来检测文字是否超出
        const measureElement = document.createElement('span');
        measureElement.style.visibility = 'hidden';
        measureElement.style.position = 'absolute';
        measureElement.style.whiteSpace = 'nowrap';
        measureElement.style.fontSize = getComputedStyle(titleElement).fontSize;
        measureElement.style.fontFamily = getComputedStyle(titleElement).fontFamily;
        measureElement.style.fontWeight = getComputedStyle(titleElement).fontWeight;
        measureElement.textContent = titleText;

        document.body.appendChild(measureElement);
        const textWidth = measureElement.offsetWidth;
        const containerWidth = titleElement.offsetWidth;
        document.body.removeChild(measureElement);

        // 如果文字宽度超出容器宽度，启用走马灯效果
        if (textWidth > containerWidth - 10) { // 留10px余量
            let marqueeTimer = null;

            // 鼠标进入时启动走马灯
            card.addEventListener('mouseenter', () => {
                normalSpan.style.display = 'none';
                marqueeDiv.style.display = 'flex';

                // 清除之前的定时器
                if (marqueeTimer) {
                    clearTimeout(marqueeTimer);
                }
            });

            // 鼠标离开时停止走马灯
            card.addEventListener('mouseleave', () => {
                marqueeTimer = setTimeout(() => {
                    normalSpan.style.display = 'block';
                    marqueeDiv.style.display = 'none';
                }, 300); // 延迟300ms，避免快速移动时闪烁
            });
        } else {
            // 文字不超出时，隐藏走马灯元素
            marqueeDiv.style.display = 'none';
        }
    }
}

// 导出组件服务
window.ComponentService = ComponentService;
