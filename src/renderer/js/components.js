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

    // 转义 HTML 文本/属性特殊字符（用于 innerHTML 拼接前的 XSS 防护）
    // 实际能安全用于：属性值（`"..."` 包围）和元素文本内容
    // 文本内容只需转义 & < > 三字符；多转义 " ' 是 over-escape 但安全
    _escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
    // 向后兼容别名（其他文件可能仍在调用 _escapeAttr）
    _escapeAttr(str) { return this._escapeHtml(str); }

    // URL 清洗：只允许 http(s) / data:image 协议，挡住 javascript:/vbscript:/file:
    // 用于 history.vod_pic 等外部输入的 URL（localStorage 用户可改）
    _sanitizeImageUrl(url) {
        if (!url || typeof url !== 'string') return '';
        const trimmed = url.trim();
        if (trimmed.length === 0 || trimmed.length > 2048) return '';
        // 协议白名单
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (/^data:image\//i.test(trimmed)) return trimmed;
        // 协议相对 URL（`//cdn.example.com/x.jpg`）补 https:
        if (trimmed.startsWith('//')) return 'https:' + trimmed;
        // 其他（javascript: / vbscript: / file: / 自定义协议）一律拒掉
        return '';
    }

    // 设置事件监听器
    setupEventListeners() {
        // 模态框关闭事件
        if (this.modal) {
            this.modal.addEventListener('click', e => {
                if (e.target === this.modal) {
                    this.hideModal();
                }
            });
        }

        // ESC键关闭模态框
        document.addEventListener('keydown', e => {
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
            <div class="site-checkbox-wrapper">
                <input type="checkbox" class="site-checkbox" data-site-id="${site.id}">
            </div>
            <div class="site-info">
                <div class="site-header">
                    <h4 class="site-name">${site.name}</h4>
                    <span class="site-type">${site.type && typeof site.type === 'string' ? site.type.toUpperCase() : 'JSON'}</span>
                    <span class="site-status ${statusClass}">${statusText}</span>
                </div>
                <div class="site-details">
                    <p class="site-url">${site.url || site.api || '无URL'}</p>
                    ${site.ruleType ? `<p class="site-rule-type">规则类型: ${site.ruleType}</p>` : ''}
                    ${site.blockedRoutes ? `<p class="site-blocked-routes">屏蔽线路: ${site.blockedRoutes}</p>` : ''}
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
        const checkbox = siteItem.querySelector('.site-checkbox');

        testBtn?.addEventListener('click', () => this.testSiteConnection(site));
        editBtn?.addEventListener('click', () => this.showEditSiteModal(site));
        activateBtn?.addEventListener('click', () => this.activateSite(site.id));
        deleteBtn?.addEventListener('click', () => this.confirmDeleteSite(site));

        // 复选框事件
        checkbox?.addEventListener('change', () => this.updateBatchActionsBar());

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
                <div class="form-group">
                    <label for="blocked-routes">屏蔽线路 <span class="form-hint">（可选）</span></label>
                    <input type="text" id="blocked-routes" name="blockedRoutes" 
                           placeholder="如：线路1,线路2,m3u8 （多个线路用半角逗号分隔）">
                    <small class="form-description">填写需要屏蔽的线路名称，播放时将自动忽略这些线路</small>
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

        form.addEventListener('submit', e => {
            e.preventDefault();
            const formData = new FormData(form);
            const siteData = {
                name: formData.get('name'),
                url: formData.get('url'),
                type: formData.get('type'),
                blockedRoutes: formData.get('blockedRoutes') || ''
            };

            try {
                this.apiService.addSite(siteData);
                this.hideModal();
                this.showNotification('站点添加成功', 'success');
                // 刷新站点列表和站点选择器
                if (window.app) {
                    window.app.loadSettings();
                    window.app.loadSiteSelector();
                    window.app.loadCategorySelector();
                    // 如果当前在主页，重新加载推荐视频
                    if (window.app.currentPage === 'home') {
                        window.app.loadRecommendedVideos();
                    }
                }
            } catch (error) {
                this.showNotification(`添加失败：${error.message}`, 'error');
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
                <div class="form-group">
                    <label for="edit-blocked-routes">屏蔽线路 <span class="form-hint">（可选）</span></label>
                    <input type="text" id="edit-blocked-routes" name="blockedRoutes" 
                           value="${site.blockedRoutes || ''}"
                           placeholder="如：线路1,线路2,m3u8 （多个线路用半角逗号分隔）">
                    <small class="form-description">填写需要屏蔽的线路名称，播放时将自动忽略这些线路</small>
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

        form.addEventListener('submit', e => {
            e.preventDefault();
            const formData = new FormData(form);
            const siteData = {
                name: formData.get('name'),
                url: formData.get('url'),
                type: formData.get('type'),
                blockedRoutes: formData.get('blockedRoutes') || ''
            };

            try {
                this.apiService.updateSite(site.id, siteData);
                this.hideModal();
                this.showNotification('站点更新成功', 'success');
                // 刷新站点列表
                if (window.app) {
                    window.app.loadSettings();
                    window.app.loadSiteSelector();
                    window.app.loadCategorySelector();
                    // 如果编辑的是当前激活站点，重新加载主页内容
                    const activeSite = this.apiService.getActiveSite();
                    if (activeSite && activeSite.id === site.id && window.app.currentPage === 'home') {
                        window.app.loadRecommendedVideos();
                    }
                }
            } catch (error) {
                this.showNotification(`更新失败：${error.message}`, 'error');
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
                            <p><strong>类型：</strong>${site.type && typeof site.type === 'string' ? site.type.toUpperCase() : 'JSON'}</p>
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
    } // 激活站点
    activateSite(siteId) {
        try {
            this.apiService.setActiveSite(siteId);
            this.showNotification('站点已设为默认', 'success');
            // 刷新相关界面
            if (window.app) {
                window.app.loadSettings();
                window.app.loadSiteSelector();
                window.app.loadCategorySelector();
                // 切换激活站点后重新加载主页内容
                if (window.app.currentPage === 'home') {
                    window.app.loadRecommendedVideos();
                }
            }
        } catch (error) {
            this.showNotification(`设置失败：${error.message}`, 'error');
        }
    }

    // 确认删除站点
    confirmDeleteSite(site) {
        // 获取当前站点信息
        const sites = this.apiService.getSites();
        const activeSite = this.apiService.getActiveSite();
        const isDeletingActiveSite = activeSite && activeSite.id === site.id;
        const remainingCount = sites.length - 1;

        // 构建警告信息
        let warningMessage = '';
        if (isDeletingActiveSite) {
            warningMessage = '<p class="warning-text">⚠️ 您正在删除当前默认站点，删除后将自动切换到其他站点。</p>';
        }
        if (remainingCount === 0) {
            warningMessage = '<p class="warning-text">⚠️ 这是最后一个站点，删除后将没有可用站点！</p>';
        }

        const content = `
            <h3>删除确认</h3>
            <div class="delete-confirm-content">
                <p>确定要删除站点 "<strong class="site-name-highlight">${site.name}</strong>" 吗？</p>
                <div class="site-info-summary">
                    <p><strong>站点地址：</strong>${site.url || site.api || '无URL'}</p>
                    <p><strong>API类型：</strong>${site.type && typeof site.type === 'string' ? site.type.toUpperCase() : 'JSON'}</p>
                    <p><strong>剩余站点：</strong>${remainingCount} 个</p>
                </div>
                ${warningMessage}
                <p class="info-text">💡 系统会自动备份站点配置，如需恢复请联系技术支持。</p>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-secondary" id="cancel-delete-btn">取消</button>
                <button type="button" class="btn-delete" id="confirm-delete-btn">确认删除</button>
            </div>
        `;

        this.showModal(content);

        const cancelBtn = document.getElementById('cancel-delete-btn');
        const confirmBtn = document.getElementById('confirm-delete-btn');

        cancelBtn.addEventListener('click', () => this.hideModal());
        confirmBtn.addEventListener('click', () => {
            try {
                console.log('[COMPONENTS] 用户确认删除站点:', site.name, 'ID:', site.id);

                // 调用API服务删除站点
                const result = this.apiService.deleteSite(site.id);

                if (result && result.success) {
                    this.hideModal();
                    this.showNotification(`站点 "${site.name}" 已成功删除`, 'success');
                    console.log('[COMPONENTS] 站点删除成功，剩余站点数:', result.remainingCount);

                    // 刷新相关界面
                    if (window.app) {
                        window.app.loadSettings();
                        window.app.loadSiteSelector();
                        window.app.loadCategorySelector();
                        // 如果删除的是当前激活站点或当前在主页，重新加载主页内容
                        if (isDeletingActiveSite || window.app.currentPage === 'home') {
                            window.app.loadRecommendedVideos();
                        }
                    }
                } else {
                    throw new Error('删除操作返回异常结果');
                }
            } catch (error) {
                console.error('[COMPONENTS] 删除站点失败:', error);
                this.showNotification(`删除失败：${error.message}`, 'error');
                // 刷新设置页面以恢复正确状态
                if (window.app) {
                    window.app.loadSettings();
                }
            }
        });
    }

    // 更新批量操作栏状态
    updateBatchActionsBar() {
        const siteList = document.getElementById('site-list');
        const selectedCount = document.getElementById('selected-count');
        const selectAllCheckbox = document.getElementById('select-all-sites');
        const batchDeleteBtn = document.getElementById('batch-delete-sites-btn');

        if (!siteList) return;

        const checkboxes = siteList.querySelectorAll('.site-checkbox');
        const checkedBoxes = siteList.querySelectorAll('.site-checkbox:checked');
        const count = checkedBoxes.length;

        // 更新选中数量显示
        if (selectedCount) {
            selectedCount.textContent = count;
        }

        // 更新批量删除按钮状态
        if (batchDeleteBtn) {
            batchDeleteBtn.disabled = count === 0;
        }

        // 更新全选复选框状态
        if (selectAllCheckbox) {
            if (count === 0) {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = false;
            } else if (count === checkboxes.length) {
                selectAllCheckbox.checked = true;
                selectAllCheckbox.indeterminate = false;
            } else {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = true;
            }
        }
    }

    // 全选/取消全选站点
    toggleSelectAllSites(checked) {
        const siteList = document.getElementById('site-list');
        if (!siteList) return;

        const checkboxes = siteList.querySelectorAll('.site-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
        });

        this.updateBatchActionsBar();
    }

    // 批量删除站点
    confirmBatchDeleteSites() {
        const siteList = document.getElementById('site-list');
        if (!siteList) return;

        const checkedBoxes = siteList.querySelectorAll('.site-checkbox:checked');
        if (checkedBoxes.length === 0) {
            this.showNotification('请先选择要删除的站点', 'warning');
            return;
        }

        const siteIds = Array.from(checkedBoxes).map(cb => cb.dataset.siteId);
        const sites = this.apiService.getSites();
        const selectedSites = sites.filter(s => siteIds.includes(s.id));

        // 检查是否包含当前活跃站点
        const hasActiveSite = selectedSites.some(s => s.active);

        const warningMessage = hasActiveSite
            ? `<div class="warning-message">
                   <p>⚠️ 选中的站点中包含当前默认站点，删除后需要重新设置默认站点。</p>
               </div>`
            : '';

        const content = `
            <h3>批量删除确认</h3>
            <div class="delete-confirm-content">
                <p>确定要删除选中的 <strong class="highlight">${selectedSites.length}</strong> 个站点吗？</p>
                <div class="selected-sites-preview">
                    <h4>将删除以下站点：</h4>
                    <div class="sites-preview-list">
                        ${selectedSites.map(s => `
                            <div class="preview-item">
                                <span class="preview-name">${s.name}</span>
                                <span class="preview-type">${s.type && typeof s.type === 'string' ? s.type.toUpperCase() : 'JSON'}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                ${warningMessage}
                <p class="info-text">💡 系统会自动备份站点配置，如需恢复请联系技术支持。</p>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-secondary" id="cancel-batch-delete-btn">取消</button>
                <button type="button" class="btn-delete" id="confirm-batch-delete-btn">确认删除 (${selectedSites.length}个)</button>
            </div>
        `;

        this.showModal(content);

        document.getElementById('cancel-batch-delete-btn').addEventListener('click', () => this.hideModal());
        document.getElementById('confirm-batch-delete-btn').addEventListener('click', () => {
            try {
                console.log('[COMPONENTS] 批量删除站点:', siteIds);

                // 使用统一的批量删除接口
                const result = this.apiService.deleteSites(siteIds);

                if (result && result.success) {
                    this.hideModal();
                    this.showNotification(`成功删除 ${result.deletedCount} 个站点`, 'success');
                    console.log('[COMPONENTS] 批量删除成功，剩余站点数:', result.remainingCount);

                    // 刷新界面
                    if (window.app) {
                        window.app.loadSettings();
                        window.app.loadSiteSelector();
                        window.app.loadCategorySelector();
                        // 如果删除了活跃站点或在主页，重新加载主页内容
                        if (result.hasActiveSiteDeleted || window.app.currentPage === 'home') {
                            window.app.loadRecommendedVideos();
                        }
                    }
                } else {
                    throw new Error('批量删除操作返回异常结果');
                }
            } catch (error) {
                console.error('[COMPONENTS] 批量删除失败:', error);
                this.showNotification(`批量删除失败：${error.message}`, 'error');
                // 刷新设置页面以恢复正确状态
                if (window.app) {
                    window.app.loadSettings();
                }
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
        const card = document.createElement('div');
        card.className = 'video-card';
        card.dataset.videoId = video.vod_id;

        // 处理图片URL - 加强逻辑，支持更多可能的字段名和格式
        let posterUrl = video.vod_pic || video.pic || video.img || video.image || '';

        // 清理海报URL，确保格式正确
        if (posterUrl) {
            // 去除可能的空格
            posterUrl = posterUrl.trim();

            // 处理各种URL格式
            if (!posterUrl.startsWith('http')) {
                // 有些站点可能返回//开头的URL
                if (posterUrl.startsWith('//')) {
                    posterUrl = `https:${posterUrl}`;
                } else {
                    // 有些站点可能直接返回图片路径
                    posterUrl = `https:${posterUrl}`;
                }
            }
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

        card.innerHTML = `
            <div class="video-poster">
                ${posterUrl ?
                `<img src="${posterUrl}" alt="${videoTitle}" 
                         onerror="console.log('图片加载失败:', this.src); this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjI4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjNDA0MDQwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPuaaguaXoOa1t+aKpTwvdGV4dD48L3N2Zz4=';"
                         onload="console.log('图片加载成功:', this.src);">` :
                '<div class="poster-placeholder">暂无海报</div>'
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
                ${video.siteName ? `<p class="video-site">来源：${video.siteName}</p>` : ''}
            </div>
        `;

        // 添加点击事件
        card.addEventListener('click', () => {
            // 如果视频有站点ID，先切换到对应站点
            if (video.siteId) {
                this.apiService.setActiveSite(video.siteId);
            }
            this.showVideoDetail(video.vod_id);
        });

        // 添加走马灯效果检测和控制
        setTimeout(() => {
            this.setupMarqueeEffect(card, videoTitle);
        }, 100);

        return card;
    }

    // 创建历史记录项
    createHistoryItem(history) {
        console.log('[COMPONENTS] 创建历史记录项，数据:', history);

        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.videoId = history.vod_id;

        let posterUrl = history.vod_pic || '';
        if (posterUrl && !posterUrl.startsWith('http')) {
            posterUrl = `https:${posterUrl}`;
        }

        // 获取播放进度信息
        // progressPercentage 来自 localStorage（用户可改），必须做类型/范围保护
        const rawProgress = Number(history.progress);
        const progressPercentage = Number.isFinite(rawProgress)
            ? Math.max(0, Math.min(100, Math.round(rawProgress)))
            : 0;
        const progressText = progressPercentage > 0 ? `观看进度: ${progressPercentage}%` : '';

        // 格式化观看时间
        const watchTimeText = history.watch_time ?
            new Date(history.watch_time).toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }) : '未知时间';

        // 格式化播放时长（如果有的话）
        const playDurationText = history.play_duration ?
            this.formatPlayDuration(history.play_duration) : '';

        // 计算播放时间显示
        const playTimeDisplay = playDurationText ?
            `已播放: ${playDurationText}` :
            (progressPercentage > 0 ? progressText : '');

        // 解析源标签（外链 URL 取 hostname，本地/磁力无附加信息则隐藏）
        const siteName = this._resolveHistorySiteLabel(history);
        // 鼠标悬停：外链 URL 时显示完整地址
        const siteTooltip = (history.type_name === '外链' && history.vod_id)
            ? ` title="${this._escapeHtml(history.vod_id)}"`
            : '';
        // 仅在有真实"来源"信息时才渲染第二个标签
        const siteMetaHtml = siteName
            ? `<span class="history-separator">•</span><span class="history-site"${siteTooltip}>${this._escapeHtml(siteName)}</span>`
            : '';

        // XSS 防护：localStorage['play_history'] 用户可直接编辑注入
        // 所有 history.* 字段插入 innerHTML 前必须 _escapeHtml
        // posterUrl 走 URL 校验：只允许 http(s)/data 协议
        const safePoster = this._sanitizeImageUrl(posterUrl);
        const safeVodName = this._escapeHtml(history.vod_name);
        const safeTypeName = this._escapeHtml(history.type_name || '未知类型');
        const safeEpisodeName = this._escapeHtml(history.episode_name);
        const safeCurrentEp = Math.max(0, Math.floor(Number(history.current_episode) || 1));
        const safeWatchTime = this._escapeHtml(watchTimeText);
        const safePlayTime = this._escapeHtml(playTimeDisplay);

        item.innerHTML = `
            <div class="history-poster">
                <img src="${safePoster}" alt="${safeVodName}"
                     onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjBmMGYwIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPuaaguaXoOa1t+aKpTwvdGV4dD48L3N2Zz4='; this.alt='暂无海报';">
                ${progressPercentage > 0 ? `<div class="history-progress-overlay">${progressPercentage}%</div>` : ''}
            </div>
            <div class="history-info">
                <h4 class="history-title">${safeVodName}</h4>
                <p class="history-meta">
                    <span class="history-type">${safeTypeName}</span>
                    ${siteMetaHtml}
                </p>
                <p class="history-episode">观看到: ${safeEpisodeName || `第${safeCurrentEp}集`}</p>
                <p class="history-time">观看时间: ${safeWatchTime}</p>
                ${safePlayTime ? `<p class="history-duration">${safePlayTime}</p>` : ''}
                ${progressPercentage > 0 ? `
                <div class="history-progress">
                    <div class="progress-bar" style="width: ${progressPercentage}%"></div>
                </div>
                ` : ''}
            </div>
            <div class="history-actions">
                <button class="btn-continue" title="继续播放">继续</button>
                <button class="btn-remove" title="删除记录">删除</button>
            </div>
        `;

        // 添加继续播放事件
        const continueBtn = item.querySelector('.btn-continue');
        continueBtn.addEventListener('click', e => {
            e.stopPropagation();
            this.continuePlayback(history);
        });

        // 添加删除记录事件
        const removeBtn = item.querySelector('.btn-remove');
        removeBtn.addEventListener('click', e => {
            e.stopPropagation();
            this.removeHistoryItem(history.vod_id, item);
        });

        // 添加点击事件
        item.addEventListener('click', async () => {
            // 外链条目（无 site_url，type_name 为外链/本地/磁力）走统一外链播放路径
            if (!history.site_url && history.vod_id) {
                await this._playExternalHistory(history);
                return;
            }
            // 如果历史记录有站点URL，先切换到对应站点
            if (history.site_url) {
                const sites = this.apiService.getSites();
                const targetSite = sites.find(site => site.url === history.site_url);

                if (targetSite) {
                    const currentSite = this.apiService.getActiveSite();
                    if (!currentSite || currentSite.url !== history.site_url) {
                        console.log('[COMPONENTS] 切换到历史记录对应站点:', targetSite.name);
                        this.apiService.setActiveSite(targetSite.id);

                        // 等待站点切换完成
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                } else {
                    console.warn('[COMPONENTS] 找不到历史记录对应的站点:', history.site_url);
                    alert('该历史记录对应的站点已不存在，请重新配置站点');
                    return;
                }
            }

            this.showVideoDetail(history.vod_id);
        });

        return item;
    }

    // 显示视频详情
    async showVideoDetail(videoId) {
        try {
            console.log('[COMPONENTS] 显示视频详情:', videoId);

            // 首先验证API服务状态
            const activeSite = this.apiService.getActiveSite();
            if (!activeSite) {
                throw new Error('没有可用的站点，请先配置站点');
            }
            console.log('[COMPONENTS] 当前站点:', activeSite.name, activeSite.url);

            const detailPage = document.getElementById('detail-page');
            const detailContent = document.getElementById('detail-content');

            if (!detailContent) {
                throw new Error('详情页面元素未找到');
            }

            // 显示加载状态
            detailContent.innerHTML = '<div class="loading">加载详情中...</div>';

            // 记录来源页面，用于返回逻辑
            this.previousPage = this.getCurrentPage();
            console.log('[COMPONENTS] 来源页面:', this.previousPage);

            // 只有在当前页面不是详情页时才切换页面
            if (this.getCurrentPage() !== 'detail') {
                console.log('[COMPONENTS] 当前不在详情页，切换到详情页');
                this.switchPage('detail');
            } else {
                console.log('[COMPONENTS] 已在详情页，无需切换');
            }

            // 优先从缓存获取视频详情
            console.log('[COMPONENTS] 开始请求视频详情...');
            const startTime = Date.now();

            let response;
            try {
                response = await this.apiService.getVideoDetail(videoId);
                const requestTime = Date.now() - startTime;
                console.log('[COMPONENTS] 获取视频详情完成，耗时:', `${requestTime}ms`);
                console.log('[COMPONENTS] 响应数据:', response);
            } catch (apiError) {
                console.error('[COMPONENTS] API请求失败:', apiError);
                throw new Error(`网络请求失败: ${apiError.message}`);
            }

            if (response && response.list && response.list.length > 0) {
                const video = response.list[0];
                this.currentVideoData = video;
                console.log('[COMPONENTS] 准备渲染视频详情:', video.vod_name);
                this.renderVideoDetail(video);
            } else {
                console.warn('[COMPONENTS] 详情数据格式不正确或无数据:', response);
                detailContent.innerHTML = '<div class="empty-state"><p>未找到该视频的详情信息</p></div>';
            }
        } catch (error) {
            console.error('[COMPONENTS] 获取视频详情失败:', error);
            const detailContent = document.getElementById('detail-content');
            if (detailContent) {
                detailContent.innerHTML = `<div class="empty-state">
                    <p>获取视频详情失败</p>
                    <p>错误信息: ${error.message}</p>
                    <button onclick="location.reload()" class="btn-primary">重新加载</button>
                </div>`;
            }

            // 重新抛出错误，让调用者知道失败了
            throw error;
        }
    }

    // 获取当前页面
    getCurrentPage() {
        // 通过检查哪个页面有active类来判断当前页面
        const activePages = document.querySelectorAll('.page.active');
        if (activePages.length > 0) {
            const activePage = activePages[0];
            const pageId = activePage.id;
            return pageId.replace('-page', '');
        }

        // 备用方案：从app.js获取
        if (window.app && window.app.currentPage) {
            return window.app.currentPage;
        }

        return 'home';
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

        // 预处理线路别名
        const routesWithAliases = routes.map(route => ({
            ...route,
            displayName: this.ensureRouteAlias(route.name)
        }));

        // 获取当前活跃站点信息
        const activeSite = this.apiService.getActiveSite();
        const activeSiteName = activeSite ? activeSite.name : '当前站点';

        detailContent.innerHTML = `
            <div class="detail-container">
                <div class="detail-poster">
                    ${posterUrl ? `<img src="${posterUrl}" alt="${video.vod_name}" onerror="this.style.display='none';">` : '<div class="video-poster">暂无海报</div>'}
                </div>
                <div class="detail-info">
                    <!-- 标题行，包含标题和分享按钮 -->
                    <div class="detail-title-row">
                        <h2 class="detail-title">${video.vod_name}</h2>
                        <button id="share-video-btn" class="share-btn-compact" title="分享此剧集给好友">
                            <i>📤</i>
                            <span>分享</span>
                        </button>
                    </div>
                    
                    <!-- 当前播放站点标识和标签在同一行 -->
                    <div class="site-and-tags-row">
                        <div class="current-site-badge">
                            <i>🌐</i>
                            <span>来源：${activeSiteName}</span>
                        </div>
                        
                        <!-- 标签区域 - 与站点标识在同一行 -->
                        ${video.vod_tag ? `
                        <div class="detail-tags">
                            ${video.vod_tag.split(',').map(tag =>
            `<span class="tag">${tag.trim()}</span>`
        ).join('')}
                        </div>
                        ` : ''}
                    </div>
                    
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
                    
                    <!-- 简介区域 -->
                    <div class="detail-desc">
                        <h4>剧情简介</h4>
                        <p>${video.vod_content ? video.vod_content.replace(/<[^>]*>/g, '') : '暂无简介'}</p>
                    </div>
                    
                    <!-- 播放列表 - 恢复到原来的位置（选集区域上方） -->
                    ${routesWithAliases && routesWithAliases.length > 0 ? `
                        <div class="episodes-section">
                            <h3>播放列表</h3>
                            <!-- 线路切换标签 -->
                            <div class="route-tabs">
                                ${routesWithAliases.map((route, index) => `
                                    <button class="route-tab ${index === 0 ? 'active' : ''}" data-route-index="${index}" title="原名称: ${route.name}">
                                        ${route.displayName} (${route.episodes.length}集)
                                    </button>
                                `).join('')}
                            </div>
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

        if (routesWithAliases && routesWithAliases.length > 0) {
            // 设置线路切换事件
            this.setupRouteTabEvents();
            // 加载默认线路的剧集
            this.loadRouteEpisodes(0);
        }

        // 设置分享按钮事件
        this.setupShareEvent();
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
            btn.addEventListener('click', e => {
                const routeIndex = parseInt(e.target.dataset.route);
                const episodeIndex = parseInt(e.target.dataset.episode);
                const episodeUrl = e.target.dataset.url;

                console.log('点击播放剧集:', { routeIndex, episodeIndex, episodeUrl });
                this.playVideo(this.currentVideoData, routeIndex, episodeIndex, episodeUrl, this.currentRoutes);
            });
        });
    }

    // 播放视频
    async playVideo(videoData, routeIndex, episodeIndex, episodeUrl, allRoutes, resumeProgress = null, forceUseActiveSite = false) {
        try {
            const currentRoute = allRoutes[routeIndex];
            const currentEpisode = currentRoute.episodes[episodeIndex];

            // 获取站点信息 - 优先使用视频数据中的站点信息（如果有），否则使用当前活跃站点
            let siteName = '未知站点';
            let siteUrl = null;
            let activeSite = null;

            try {
                // 1. 首先检查视频数据中是否包含站点信息（全站搜索的视频会有）
                if (videoData.siteId && videoData.siteName) {
                    console.log('[COMPONENTS] 使用视频数据中的站点信息:', videoData.siteName);
                    siteName = videoData.siteName;

                    // 根据siteId获取完整站点信息
                    const sites = this.apiService.getSites();
                    const videoSite = sites.find(site => site.id === videoData.siteId);
                    if (videoSite) {
                        siteUrl = videoSite.url;
                        activeSite = videoSite;
                    }
                } else {
                    // 2. 从localStorage或apiService获取当前活跃站点
                    const sitesFromStorage = JSON.parse(localStorage.getItem('video_sites') || '[]');
                    activeSite = sitesFromStorage.find(site => site.active);

                    if (!activeSite) {
                        activeSite = this.apiService.getActiveSite();
                    }

                    if (activeSite && activeSite.name) {
                        siteName = activeSite.name;
                        siteUrl = activeSite.url;
                    } else {
                        console.error('[COMPONENTS] 无法获取有效站点信息');
                    }
                }
            } catch (error) {
                console.error('[COMPONENTS] 获取站点信息时出错:', error);
            }

            // 在通知中显示获取到的站点信息
            this.showNotification(`正在播放 - 当前站点：${siteName}`, 'info');

            // 添加到播放历史 - 保存视频原始站点信息，确保历史记录正确
            const historyData = {
                vod_id: videoData.vod_id,
                vod_name: videoData.vod_name,
                vod_pic: videoData.vod_pic,
                type_name: videoData.type_name || '未知类型',
                current_episode: episodeIndex + 1,
                episode_name: currentEpisode?.name || `第${episodeIndex + 1}集`,
                site_url: siteUrl, // 保存视频原始站点URL
                siteName // 保存视频原始站点名称
            };

            this.storageService.addPlayHistory(historyData);

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
                    routes: allRoutes,
                    // 添加站点信息
                    siteName,
                    siteUrl: this.apiService.getActiveSite()?.url || 'unknown'
                },
                // 添加播放进度信息
                resumeProgress
            };

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

        // 通知app.js更新currentPage状态
        if (window.app) {
            window.app.currentPage = pageName;
            console.log('[COMPONENTS] 已更新app.currentPage为:', pageName);
        }

        console.log('[COMPONENTS] 页面切换完成:', pageName);
    }

    // 同步播放器当前集数到详情页面显示
    syncCurrentEpisode(updateData) {
        try {
            console.log('[COMPONENTS] 同步当前集数显示:', updateData);

            // 确保当前在显示对应的视频详情
            if (!this.currentVideoData || this.currentVideoData.vod_id !== updateData.videoId) {
                console.log('[COMPONENTS] 当前显示的不是对应视频，跳过同步');
                return;
            }

            // 更新选集按钮的视觉状态
            this.updateEpisodeButtonStates(updateData.routeIndex, updateData.episodeIndex);

            // 如果需要切换线路，先切换线路
            if (updateData.routeIndex !== this.currentActiveRoute) {
                console.log('[COMPONENTS] 切换线路:', this.currentActiveRoute, '->', updateData.routeIndex);
                this.switchToRoute(updateData.routeIndex);
            }

            console.log('[COMPONENTS] 集数同步完成');
        } catch (error) {
            console.error('[COMPONENTS] 同步当前集数失败:', error);
        }
    }

    // 更新集数按钮的视觉状态
    updateEpisodeButtonStates(routeIndex, episodeIndex) {
        try {
            // 移除所有按钮的当前播放状态
            const allEpisodeButtons = document.querySelectorAll('.episode-btn');
            allEpisodeButtons.forEach(btn => {
                btn.classList.remove('current-playing');
            });

            // 添加当前播放的集数状态
            const currentButton = document.querySelector(
                `.episode-btn[data-route="${routeIndex}"][data-episode="${episodeIndex}"]`
            );

            if (currentButton) {
                currentButton.classList.add('current-playing');
                console.log('[COMPONENTS] 已标记当前播放集数:', episodeIndex + 1);

                // 滚动到当前播放的集数（如果需要）
                currentButton.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            } else {
                console.warn('[COMPONENTS] 未找到对应的集数按钮:', routeIndex, episodeIndex);
            }
        } catch (error) {
            console.error('[COMPONENTS] 更新集数按钮状态失败:', error);
        }
    }

    // 切换到指定线路
    switchToRoute(routeIndex) {
        try {
            // 更新线路标签状态
            const routeTabs = document.querySelectorAll('.route-tab');
            routeTabs.forEach((tab, index) => {
                tab.classList.toggle('active', index === routeIndex);
            });

            // 更新当前活跃线路
            this.currentActiveRoute = routeIndex;

            // 重新加载剧集列表
            this.loadRouteEpisodes(routeIndex);

            console.log('[COMPONENTS] 已切换到线路:', routeIndex);
        } catch (error) {
            console.error('[COMPONENTS] 切换线路失败:', error);
        }
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

    // 继续播放历史记录
    continuePlayback(history) {
        // 首先显示历史记录的详细信息，用于调试
        console.log('历史记录播放:', history.vod_name, '站点:', history.site_url || '未知');

        // 外链条目（无 site_url）走外链播放路径
        if (!history.site_url && history.vod_id) {
            this._playExternalHistory(history);
            return;
        }

        // 处理历史记录播放 - 应该直接使用历史记录中的站点信息

        // 如果历史记录中没有站点URL，说明是旧数据，在当前站点尝试播放
        if (!history.site_url) {
            this.continuePlaybackAfterSiteSwitch(history);
            return;
        }

        // 根据历史记录中的站点URL找到对应的站点
        const allSites = this.apiService.getSites();
        const targetSite = allSites.find(site => site.url === history.site_url);

        if (!targetSite) {
            this.showNotification(`未找到站点"${history.site_url}"，该站点可能已被删除`, 'warning');
            return;
        }

        // 切换到目标站点
        this.apiService.setActiveSite(targetSite.id);

        // 验证切换是否成功
        const verifySwitch = this.apiService.getActiveSite();
        if (!verifySwitch || verifySwitch.url !== history.site_url) {
            console.error('[DEBUG] 站点切换失败');
            this.showNotification('站点切换失败，无法播放该历史记录', 'error');
            return;
        }

        this.showNotification(`已切换到站点：${targetSite.name}`, 'info');

        // 延迟播放，确保站点切换完成
        setTimeout(() => {
            this.continuePlaybackAfterSiteSwitch(history);
        }, 1000);
    }

    // 切换站点后继续播放
    continuePlaybackAfterSiteSwitch(history) {
        // 验证当前站点是否正确
        const currentSite = this.apiService.getActiveSite();
        if (history.site_url && currentSite && currentSite.url !== history.site_url) {
            console.error('[ERROR] 站点切换失败，当前站点与期望不匹配');
            this.showNotification('站点切换失败，无法播放该历史记录', 'error');
            return;
        }

        // 获取视频详情并播放
        this.showVideoDetail(history.vod_id).then(() => {
            // 如果有播放进度信息，继续播放指定集数
            if (history.current_episode && history.episode_name) {
                setTimeout(() => {
                    this.continueFromHistory(history);
                }, 500);
            }
        }).catch(error => {
            console.error('[ERROR] 获取视频详情失败:', error);
            // 如果获取视频详情失败，尝试智能搜索
            this.smartSearchInAllSites(history);
        });
    }

    // 判断历史项是否为外链条目（无 site_url）
    _isExternalHistory(history) {
        return history && !history.site_url && history.vod_id;
    }

    // 统一解析历史项的"来源"标签（用于第二个标签位）
    // - 站内视频：按 site_url 反查站点名
    // - 外链 URL：取 vod_id 的 hostname（如 example.com），鼠标悬停可看完整 URL
    // - 本地/磁力外链：返回空（无附加信息可显示，模板会按条件隐藏第二个标签）
    // - 老数据兼容：site_name 等于"未知站点"等占位词时视为空
    _resolveHistorySiteLabel(history) {
        if (!history) return '';
        // 占位词列表（历史兜底值，不应作为来源标签展示）
        const placeholderNames = ['未知站点', '未知', 'unknown', ''];
        const isExternalType = ['外链', '本地', '磁力'].includes(history.type_name);

        // 站内视频
        if (history.site_url && this.apiService) {
            const sites = this.apiService.getSites();
            const target = sites.find(site => site.url === history.site_url);
            if (target && target.name) return target.name;
        }
        // 外链 URL：取 hostname 作为差异化来源（即使 site_name 是"未知站点"也能正确显示）
        if (history.type_name === '外链' && history.vod_id) {
            try {
                const host = new URL(history.vod_id).hostname;
                if (host) return host;
            } catch (e) {
                // 非标准 URL，忽略
            }
        }
        // 外链条目（本地/磁力，或 URL 无法解析时）：占位词返回空
        if (isExternalType) {
            if (placeholderNames.includes(history.site_name)) return '';
            return history.site_name || '';
        }
        // 兜底（站内视频反查失败）
        return history.site_name || '';
    }

    // 推断外链条目类型
    _inferExternalType(history) {
        const id = (history && history.vod_id) || '';
        const tn = history && history.type_name;
        // 下载页产生的历史项：vod_id 是 'dl_<fileId>' 格式
        // 关键：必须先于 http(s)/path 判断，否则 'dl_xxx' 会被误归为 'url' 或 'local'
        if (id.startsWith('dl_')) {
            return 'download';
        }
        if (id.startsWith('magnet:') || /^[a-fA-F0-9]{40}$/.test(id) || /^[A-Z2-7]{32}$/.test(id)) {
            return 'magnet';
        }
        if (tn === '磁力') return 'magnet';
        if (id.startsWith('file://') || /^[A-Za-z]:[\\/]/.test(id) || id.startsWith('\\\\') || id.startsWith('/')) {
            return 'local';
        }
        if (tn === '本地') return 'local';
        if (id.startsWith('http://') || id.startsWith('https://')) return 'url';
        if (tn === '外链') return 'url';
        return 'unknown';
    }

    // 播放外链历史项
    // - 下载项（vod_id 以 'dl_' 开头）：路由回 DownloadController.playById
    //   自动处理 magnet（恢复下载+流式播放）和本地/URL（直接 file:// 播放）
    // - URL/本地：直接 open-player IPC（一次点击即播）
    // - 磁力：优先续播（跳过解析，走主进程本地缓存），失败时回退到解析+选文件流程
    async _playExternalHistory(history) {
        if (!window.electron || !window.electron.ipcRenderer) {
            this.showNotification('Electron 环境不可用', 'error');
            return;
        }
        const type = this._inferExternalType(history);
        const vodId = history.vod_id;

        // 下载项：路由回 DownloadController（自动 resume 未完成 + 开窗）
        if (type === 'download') {
            // 从 'dl_<fileId>' 提取 fileId
            const fileId = vodId.startsWith('dl_') ? vodId.slice(3) : vodId;
            if (!fileId) {
                this.showNotification('下载项 id 缺失', 'error');
                return;
            }
            // 懒初始化 DownloadController（如果用户从未来过下载页）
            if (window.app && !window.app.downloadController) {
                if (typeof window.app.initializeDownloadsPage === 'function') {
                    window.app.initializeDownloadsPage();
                }
            }
            if (!window.app || !window.app.downloadController) {
                this.showNotification('下载管理器不可用', 'error');
                return;
            }
            await window.app.downloadController.playById(fileId);
            return;
        }

        if (type === 'magnet') {
            const fileName = history.vod_name || '';
            // 导航到外链页（复用进度条 UI）
            if (window.app && typeof window.app.initializePlayUrlPage === 'function') {
                window.app.initializePlayUrlPage();
                if (typeof window.app.switchToPage === 'function') {
                    window.app.switchToPage('play-url');
                }
            }
            // 优先走续播：跳过 parse，直接调 play() 命中主进程缓存
            if (fileName && window.app && window.app.playUrlController) {
                const ok = await window.app.playUrlController.resumeMagnetFromHistory(vodId, fileName);
                if (ok) {
                    return;
                }
                // 续播失败：回退到"重新解析+选文件"流程
                this.showNotification('续播失败，改为重新解析...', 'warning');
            }
            // 回退：让用户重走解析流程
            setTimeout(() => {
                if (window.app && window.app.playUrlController) {
                    window.app.playUrlController.playExternalFromHistory(vodId);
                } else {
                    this.showNotification('外链页面不可用', 'error');
                }
            }, 300);
            return;
        }

        // URL / 本地：直接调用 open-player
        const fileName = this._extractExternalFileName(vodId, history.vod_name);
        const isLocal = type === 'local';
        const localPath = isLocal
            ? (vodId.startsWith('file://') ? vodId.replace(/^file:\/\/\//, '') : vodId)
            : '';
        const sourceLabel = isLocal ? '本地' : '外链';
        const playerData = {
            url: isLocal ? `file://${localPath.replace(/\\/g, '/')}` : vodId,
            title: fileName,
            videoData: {
                vod_name: fileName,
                episode_name: '正片',
                playSource: isLocal ? 'local' : 'network',
                isDirectPlay: true,
                localPath: isLocal ? localPath : undefined,
                type_name: sourceLabel,
                siteName: sourceLabel
            }
        };
        try {
            const result = await window.electron.ipcRenderer.invoke('open-player', playerData);
            if (result && result.success) {
                this.showNotification(`正在播放: ${fileName}`, 'success');
            } else {
                throw new Error((result && result.message) || '打开播放器失败');
            }
        } catch (error) {
            console.error('[COMPONENTS] 播放外链历史项失败:', error);
            this.showNotification(`打开播放器失败: ${error.message}`, 'error');
        }
    }

    // 从 vod_id 提取显示名（兜底用）
    _extractExternalFileName(vodId, fallback) {
        if (fallback) return fallback;
        if (!vodId) return '外链视频';
        try {
            const cleaned = String(vodId).split('?')[0].split('#')[0];
            const parts = cleaned.split(/[\\/]/);
            return parts[parts.length - 1] || '外链视频';
        } catch (e) {
            return '外链视频';
        }
    }

    // 智能搜索：在所有站点中查找视频
    async smartSearchInAllSites(history) {
        // 不同站点的视频ID不通用，不应该在其他站点搜索相同的视频ID
        // 而是应该提示用户该视频在对应站点不存在，建议手动搜索
        this.showNotification(`该视频在站点"${this.apiService.getActiveSite()?.name || '当前站点'}"中已不存在`, 'warning');
        this.showNotification('建议手动搜索该视频名称，或检查站点配置是否正确', 'info');

        // 可选：显示一个提示对话框，让用户选择是否要手动搜索
        setTimeout(() => {
            if (confirm(`该视频在站点"${this.apiService.getActiveSite()?.name || '当前站点'}"中已不存在，是否要手动搜索该视频名称？`)) {
                // 切换到搜索页面
                window.app.switchToPage('search');
                // 填充搜索输入框
                const searchInput = document.getElementById('search-input');
                if (searchInput) {
                    searchInput.value = history.vod_name;
                    searchInput.focus();
                }
            }
        }, 1000);
    }

    // 更新历史记录中的站点信息
    updateHistorySiteInfo(vodId, siteInfo) {
        const history = this.storageService.getPlayHistory();
        const updatedHistory = history.map(item => {
            if (item.vod_id === vodId) {
                return {
                    ...item,
                    site_name: siteInfo.name,
                    site_id: siteInfo.id,
                    site_url: siteInfo.url
                };
            }
            return item;
        });

        localStorage.setItem('PLAY_HISTORY', JSON.stringify(updatedHistory));
        console.log(`已更新视频ID ${vodId} 的完整站点信息:`, {
            name: siteInfo.name,
            id: siteInfo.id,
            url: siteInfo.url
        });
    }

    // 从历史记录继续播放
    continueFromHistory(history) {
        // 检查当前视频数据是否已加载
        if (!this.currentVideoData) {
            const currentSite = this.apiService.getActiveSite();
            const errorMsg = `视频数据加载失败。视频ID:${history.vod_id} 在站点"${currentSite?.name || '当前站点'}"中不存在。`;

            this.showNotification(errorMsg, 'error');
            this.showNotification('建议：尝试切换到其他站点或手动搜索该视频', 'info');
            return;
        }

        // 查找对应的剧集按钮并高亮
        const episodeButtons = document.querySelectorAll('.episode-btn');
        let targetButton = null;
        let routeIndex = 0;
        let episodeIndex = 0;

        // 尝试根据剧集名称或集数找到对应按钮
        for (const btn of episodeButtons) {
            const buttonText = btn.textContent.trim();
            const btnEpisodeIndex = parseInt(btn.dataset.episode);
            const btnRouteIndex = parseInt(btn.dataset.route);

            // 匹配剧集名称或集数
            if (buttonText === history.episode_name ||
                btnEpisodeIndex === (history.current_episode - 1)) {
                targetButton = btn;
                routeIndex = btnRouteIndex || 0;
                episodeIndex = btnEpisodeIndex;
                break;
            }
        }

        if (targetButton) {
            // 高亮目标按钮
            episodeButtons.forEach(btn => btn.classList.remove('current-episode'));
            targetButton.classList.add('current-episode');

            // 滚动到目标按钮
            targetButton.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // 显示继续播放提示
            this.showNotification(`正在继续播放《${history.vod_name}》${history.episode_name}...`, 'success');

            // 直接调用playVideo方法，传递播放进度信息
            setTimeout(() => {
                // 获取剧集URL
                const episodeUrl = targetButton.dataset.url;

                // 确保有可用的路线数据
                const routesData = this.currentRoutes || [];

                // 获取实际的播放进度（秒），而不仅仅是百分比
                const watchProgress = this.storageService.getWatchProgress(
                    history.vod_id,
                    history.current_episode
                );
                console.log('[COMPONENTS] 播放进度信息:', watchProgress);

                // 调用playVideo方法，传递播放进度
                this.playVideo(
                    this.currentVideoData,
                    routeIndex,
                    episodeIndex,
                    episodeUrl,
                    routesData,
                    watchProgress.currentTime, // 传递实际播放时间（秒）
                    true // forceUseActiveSite = true，强制使用当前活跃站点信息
                );
            }, 800);
        } else {
            this.showNotification(`未找到《${history.vod_name}》的第${history.current_episode}集，将播放第1集`, 'warning');

            // 如果找不到对应剧集，播放第一集
            if (episodeButtons.length > 0) {
                episodeButtons[0].click();
            }
        }
    }

    // 格式化播放时长
    formatPlayDuration(seconds) {
        if (!seconds || seconds < 0) return '0秒';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}小时${minutes}分钟${secs}秒`;
        } else if (minutes > 0) {
            return `${minutes}分钟${secs}秒`;
        }
        return `${secs}秒`;
    }

    // 删除历史记录项
    removeHistoryItem(vodId, itemElement) {
        console.log('[COMPONENTS] 删除历史记录:', vodId);

        // 确认删除
        const content = `
            <h3>删除确认</h3>
            <p>确定要删除这条播放历史吗？</p>
            <div class="form-actions">
                <button type="button" class="btn-secondary" id="cancel-remove-btn">取消</button>
                <button type="button" class="btn-delete" id="confirm-remove-btn">删除</button>
            </div>
        `;

        this.showModal(content);

        const cancelBtn = document.getElementById('cancel-remove-btn');
        const confirmBtn = document.getElementById('confirm-remove-btn');

        cancelBtn.addEventListener('click', () => {
            this.hideModal();
        });

        confirmBtn.addEventListener('click', () => {
            // 从存储中删除
            this.storageService.removePlayHistory(vodId);

            // 从DOM中删除
            itemElement.remove();

            this.hideModal();
            this.showNotification('历史记录已删除', 'success');

            // 检查是否还有历史记录，如果没有则显示空状态
            const historyList = document.getElementById('history-list');
            if (historyList && historyList.children.length === 0) {
                historyList.innerHTML = `
                    <div class="empty-state">
                        <i>📺</i>
                        <h3>暂无播放历史</h3>
                        <p>开始观看视频后，历史记录会显示在这里</p>
                    </div>
                `;
            }
        });
    }

    // ==================== 线路别名管理 ====================

    // 显示线路别名管理模态框
    showRouteAliasModal() {
        const aliases = this.storageService.getAllRouteAliases();
        const aliasEntries = Object.entries(aliases);

        const content = `
            <h3>管理线路别名</h3>
            <div class="route-alias-manager">
                <div class="route-alias-list-modal">
                    ${aliasEntries.length > 0 ?
                aliasEntries.map(([routeName, alias]) => `
                            <div class="route-alias-edit-item" data-route="${routeName}">
                                <div class="alias-checkbox-wrapper">
                                    <input type="checkbox" class="alias-checkbox" data-route="${routeName}">
                                </div>
                                <div class="alias-edit-info">
                                    <div class="alias-original-name">原名称: ${routeName}</div>
                                    <div class="alias-input-group">
                                        <label>别名:</label>
                                        <input type="text" class="alias-input" value="${alias}" 
                                               data-route="${routeName}" placeholder="输入自定义别名">
                                    </div>
                                </div>
                                <div class="alias-edit-actions">
                                    <button type="button" class="btn-save-alias btn-primary" 
                                            data-route="${routeName}">保存</button>
                                    <button type="button" class="btn-remove-alias btn-secondary" 
                                            data-route="${routeName}">删除</button>
                                </div>
                            </div>
                        `).join('') :
                '<div class="empty-alias-state"><p>暂无线路别名设置</p><p>在视频播放页面会自动为遇到的线路创建别名设置</p></div>'
            }
                </div>
                <div class="alias-actions-bar">
                    <div class="alias-actions-left">
                        <input type="checkbox" id="select-all-aliases">
                        <label for="select-all-aliases">全选</label>
                        <span class="selected-info">已选择 <span id="alias-selected-count">0</span> 个别名</span>
                    </div>
                    <div class="alias-actions-right">
                        <button id="batch-delete-aliases-btn" class="btn-delete">批量删除</button>
                        <button type="button" class="btn-secondary" id="close-alias-modal">关闭</button>
                    </div>
                </div>
            </div>
        `;

        this.showModal(content);

        // 绑定事件
        this.setupRouteAliasEvents();
    }

    // 设置线路别名事件
    setupRouteAliasEvents() {
        const closeBtn = document.getElementById('close-alias-modal');
        const saveButtons = document.querySelectorAll('.btn-save-alias');
        const removeButtons = document.querySelectorAll('.btn-remove-alias');
        const selectAllAliases = document.getElementById('select-all-aliases');
        const batchDeleteAliasesBtn = document.getElementById('batch-delete-aliases-btn');
        const aliasCheckboxes = document.querySelectorAll('.alias-checkbox');

        closeBtn?.addEventListener('click', () => this.hideModal());

        saveButtons.forEach(btn => {
            btn.addEventListener('click', e => {
                const routeName = e.target.dataset.route;
                const input = document.querySelector(`.alias-input[data-route="${routeName}"]`);
                const newAlias = input.value.trim();

                if (newAlias) {
                    this.storageService.setRouteAlias(routeName, newAlias);
                    this.showNotification('别名保存成功', 'success');
                } else {
                    this.showNotification('别名不能为空', 'warning');
                }
            });
        });

        removeButtons.forEach(btn => {
            btn.addEventListener('click', e => {
                const routeName = e.target.dataset.route;
                this.confirmRemoveRouteAlias(routeName);
            });
        });

        // 批量操作事件
        selectAllAliases?.addEventListener('change', (e) => {
            const checked = e.target.checked;
            aliasCheckboxes.forEach(checkbox => {
                checkbox.checked = checked;
            });
            this.updateAliasBatchActionsBar();
        });

        aliasCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => this.updateAliasBatchActionsBar());
        });

        batchDeleteAliasesBtn?.addEventListener('click', () => this.confirmBatchDeleteAliases());
    }

    // 更新别名批量操作栏状态
    updateAliasBatchActionsBar() {
        const aliasList = document.querySelector('.route-alias-list-modal');
        const selectedCount = document.getElementById('alias-selected-count');
        const selectAllCheckbox = document.getElementById('select-all-aliases');
        const batchDeleteBtn = document.getElementById('batch-delete-aliases-btn');

        if (!aliasList) return;

        const checkboxes = aliasList.querySelectorAll('.alias-checkbox');
        const checkedBoxes = aliasList.querySelectorAll('.alias-checkbox:checked');
        const count = checkedBoxes.length;

        // 更新选中数量显示
        if (selectedCount) {
            selectedCount.textContent = count;
        }

        // 更新批量删除按钮状态
        if (batchDeleteBtn) {
            batchDeleteBtn.disabled = count === 0;
        }

        // 更新全选复选框状态
        if (selectAllCheckbox) {
            if (count === 0) {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = false;
            } else if (count === checkboxes.length) {
                selectAllCheckbox.checked = true;
                selectAllCheckbox.indeterminate = false;
            } else {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = true;
            }
        }
    }

    // 批量删除线路别名
    confirmBatchDeleteAliases() {
        const aliasList = document.querySelector('.route-alias-list-modal');
        if (!aliasList) return;

        const checkedBoxes = aliasList.querySelectorAll('.alias-checkbox:checked');
        if (checkedBoxes.length === 0) {
            this.showNotification('请先选择要删除的别名', 'warning');
            return;
        }

        const routeNames = Array.from(checkedBoxes).map(cb => cb.dataset.route);

        const content = `
            <h3>批量删除确认</h3>
            <div class="delete-confirm-content">
                <p>确定要删除选中的 <strong class="highlight">${routeNames.length}</strong> 个线路别名吗？</p>
                <div class="selected-sites-preview">
                    <h4>将删除以下线路别名：</h4>
                    <div class="sites-preview-list">
                        ${routeNames.map(name => `
                            <div class="preview-item">
                                <span class="preview-name">${name}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <p class="info-text">💡 删除后将显示原始线路名称。</p>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-secondary" id="cancel-batch-delete-aliases-btn">取消</button>
                <button type="button" class="btn-delete" id="confirm-batch-delete-aliases-btn">确认删除 (${routeNames.length}个)</button>
            </div>
        `;

        this.showModal(content);

        document.getElementById('cancel-batch-delete-aliases-btn').addEventListener('click', () => {
            this.hideModal();
            // 重新显示别名管理界面
            setTimeout(() => this.showRouteAliasModal(), 100);
        });

        document.getElementById('confirm-batch-delete-aliases-btn').addEventListener('click', () => {
            try {
                console.log('[COMPONENTS] 批量删除线路别名:', routeNames);

                // 执行批量删除
                routeNames.forEach(routeName => {
                    this.storageService.removeRouteAlias(routeName);
                });

                this.hideModal();
                this.showNotification(`成功删除 ${routeNames.length} 个线路别名`, 'success');

                // 重新显示别名管理界面
                setTimeout(() => this.showRouteAliasModal(), 100);
            } catch (error) {
                console.error('[COMPONENTS] 批量删除线路别名失败:', error);
                this.showNotification(`批量删除失败：${error.message}`, 'error');
            }
        });
    }

    // 确认删除线路别名
    confirmRemoveRouteAlias(routeName) {
        const content = `
            <h3>删除确认</h3>
            <p>确定要删除线路 "<strong>${routeName}</strong>" 的别名设置吗？</p>
            <p>删除后将显示原始线路名称。</p>
            <div class="form-actions">
                <button type="button" class="btn-secondary" id="cancel-remove-alias">取消</button>
                <button type="button" class="btn-delete" id="confirm-remove-alias">删除</button>
            </div>
        `;

        this.showModal(content);

        const cancelBtn = document.getElementById('cancel-remove-alias');
        const confirmBtn = document.getElementById('confirm-remove-alias');

        cancelBtn.addEventListener('click', () => this.hideModal());

        confirmBtn.addEventListener('click', () => {
            this.storageService.removeRouteAlias(routeName);
            this.hideModal();
            this.showNotification('别名已删除', 'success');
            // 刷新设置页面
            if (window.app) {
                window.app.loadSettings();
            }
        });
    }

    // 创建线路别名列表项
    createRouteAliasItem(routeName, alias) {
        const item = document.createElement('div');
        item.className = 'route-alias-item';
        item.dataset.route = routeName;

        // 复选框
        const checkboxWrapper = document.createElement('div');
        checkboxWrapper.className = 'alias-checkbox-wrapper';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'alias-checkbox';
        checkbox.dataset.route = routeName;
        checkboxWrapper.appendChild(checkbox);

        // 信息区域
        const infoDiv = document.createElement('div');
        infoDiv.className = 'route-alias-info';

        const originalDiv = document.createElement('div');
        originalDiv.className = 'route-alias-original';
        originalDiv.textContent = `原名称: ${routeName}`;
        infoDiv.appendChild(originalDiv);

        const displayDiv = document.createElement('div');
        displayDiv.className = 'route-alias-display';
        displayDiv.textContent = `显示为: ${alias}`;
        infoDiv.appendChild(displayDiv);

        // 操作按钮
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'route-alias-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit btn-edit-alias';
        editBtn.dataset.route = routeName;
        editBtn.textContent = '编辑';
        actionsDiv.appendChild(editBtn);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-delete btn-remove-alias';
        removeBtn.dataset.route = routeName;
        removeBtn.textContent = '删除';
        actionsDiv.appendChild(removeBtn);

        item.appendChild(checkboxWrapper);
        item.appendChild(infoDiv);
        item.appendChild(actionsDiv);

        // 添加事件监听
        checkbox.addEventListener('change', () => this.updateRouteAliasBatchActionsBar());

        editBtn.addEventListener('click', () => {
            this.editRouteAlias(routeName, alias);
        });

        removeBtn.addEventListener('click', () => {
            this.confirmRemoveRouteAlias(routeName);
        });

        return item;
    }

    // 更新线路别名批量操作栏状态
    updateRouteAliasBatchActionsBar() {
        const aliasList = document.getElementById('route-aliases-list');
        const selectedCount = document.getElementById('alias-selected-count');
        const selectAllCheckbox = document.getElementById('select-all-aliases');
        const batchDeleteBtn = document.getElementById('batch-delete-aliases-btn');

        if (!aliasList) return;

        const checkboxes = aliasList.querySelectorAll('.alias-checkbox');
        const checkedBoxes = aliasList.querySelectorAll('.alias-checkbox:checked');
        const count = checkedBoxes.length;

        // 更新选中数量显示
        if (selectedCount) {
            selectedCount.textContent = count;
        }

        // 更新批量删除按钮状态
        if (batchDeleteBtn) {
            batchDeleteBtn.disabled = count === 0;
        }

        // 更新全选复选框状态
        if (selectAllCheckbox) {
            if (count === 0) {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = false;
            } else if (count === checkboxes.length) {
                selectAllCheckbox.checked = true;
                selectAllCheckbox.indeterminate = false;
            } else {
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = true;
            }
        }
    }

    // 全选/取消全选线路别名
    toggleSelectAllAliases(checked) {
        const aliasList = document.getElementById('route-aliases-list');
        if (!aliasList) return;

        const checkboxes = aliasList.querySelectorAll('.alias-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
        });

        this.updateRouteAliasBatchActionsBar();
    }

    // 批量删除线路别名
    confirmBatchDeleteAliasesFromSettings() {
        const aliasList = document.getElementById('route-aliases-list');
        if (!aliasList) return;

        const checkedBoxes = aliasList.querySelectorAll('.alias-checkbox:checked');
        if (checkedBoxes.length === 0) {
            this.showNotification('请先选择要删除的别名', 'warning');
            return;
        }

        const routeNames = Array.from(checkedBoxes).map(cb => cb.dataset.route);

        const content = `
            <h3>批量删除确认</h3>
            <div class="delete-confirm-content">
                <p>确定要删除选中的 <strong class="highlight">${routeNames.length}</strong> 个线路别名吗？</p>
                <div class="selected-sites-preview">
                    <h4>将删除以下线路别名：</h4>
                    <div class="sites-preview-list">
                        ${routeNames.map(name => `
                            <div class="preview-item">
                                <span class="preview-name">${name}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <p class="info-text">💡 删除后将显示原始线路名称。</p>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-secondary" id="cancel-batch-delete-aliases-btn">取消</button>
                <button type="button" class="btn-delete" id="confirm-batch-delete-aliases-btn">确认删除 (${routeNames.length}个)</button>
            </div>
        `;

        this.showModal(content);

        document.getElementById('cancel-batch-delete-aliases-btn').addEventListener('click', () => this.hideModal());

        document.getElementById('confirm-batch-delete-aliases-btn').addEventListener('click', () => {
            try {
                console.log('[COMPONENTS] 批量删除线路别名:', routeNames);

                // 执行批量删除
                routeNames.forEach(routeName => {
                    this.storageService.removeRouteAlias(routeName);
                });

                this.hideModal();
                this.showNotification(`成功删除 ${routeNames.length} 个线路别名`, 'success');

                // 刷新设置页面
                if (window.app) {
                    window.app.loadSettings();
                }
            } catch (error) {
                console.error('[COMPONENTS] 批量删除线路别名失败:', error);
                this.showNotification(`批量删除失败：${error.message}`, 'error');
            }
        });
    }

    // 显示添加别名模态框
    showAddAliasModal() {
        const content = `
            <h3>添加线路别名</h3>
            <form id="add-alias-form" class="alias-form">
                <div class="form-group">
                    <label for="route-name-input">原线路名称</label>
                    <input type="text" id="route-name-input" placeholder="输入原线路名称" required>
                    <small class="form-description">输入播放器中显示的原始线路名称</small>
                </div>
                <div class="form-group">
                    <label for="alias-input">自定义别名</label>
                    <input type="text" id="alias-input" placeholder="输入自定义别名" required>
                    <small class="form-description">输入您希望显示的别名</small>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" id="cancel-add-alias">取消</button>
                    <button type="submit" class="btn-primary">添加</button>
                </div>
            </form>
        `;

        this.showModal(content);

        const form = document.getElementById('add-alias-form');
        const cancelBtn = document.getElementById('cancel-add-alias');

        cancelBtn.addEventListener('click', () => this.hideModal());

        form.addEventListener('submit', e => {
            e.preventDefault();
            const routeName = document.getElementById('route-name-input').value.trim();
            const alias = document.getElementById('alias-input').value.trim();

            if (routeName && alias) {
                this.storageService.setRouteAlias(routeName, alias);
                this.hideModal();
                this.showNotification('别名添加成功', 'success');
                // 刷新设置页面
                if (window.app) {
                    window.app.loadSettings();
                }
            } else {
                this.showNotification('请填写完整信息', 'warning');
            }
        });
    }

    // 编辑线路别名
    editRouteAlias(routeName, currentAlias) {
        const content = `
            <h3>编辑线路别名</h3>
            <form id="edit-alias-form" class="alias-form">
                <div class="form-group">
                    <label>原线路名称</label>
                    <input type="text" value="${routeName}" readonly class="readonly-input">
                </div>
                <div class="form-group">
                    <label for="alias-input">自定义别名</label>
                    <input type="text" id="alias-input" value="${currentAlias}" 
                           placeholder="输入自定义别名" required>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" id="cancel-edit-alias">取消</button>
                    <button type="submit" class="btn-primary">保存</button>
                </div>
            </form>
        `;

        this.showModal(content);

        const form = document.getElementById('edit-alias-form');
        const cancelBtn = document.getElementById('cancel-edit-alias');

        cancelBtn.addEventListener('click', () => this.hideModal());

        form.addEventListener('submit', e => {
            e.preventDefault();
            const newAlias = document.getElementById('alias-input').value.trim();

            if (newAlias) {
                this.storageService.setRouteAlias(routeName, newAlias);
                this.hideModal();
                this.showNotification('别名更新成功', 'success');
                // 刷新设置页面
                if (window.app) {
                    window.app.loadSettings();
                }
            } else {
                this.showNotification('别名不能为空', 'warning');
            }
        });
    }

    // 获取线路显示名称（优先使用别名）
    getRouteDisplayName(routeName) {
        return this.storageService.getRouteAlias(routeName);
    }

    // 确保线路有别名设置（如果没有则创建默认别名）
    ensureRouteAlias(routeName) {
        const alias = this.storageService.getRouteAlias(routeName);
        if (alias === routeName) {
            // 没有设置别名，创建默认别名
            this.storageService.setRouteAlias(routeName, routeName);
        }
        return alias;
    }

    // ==================== 数据导入导出功能 ====================

    // 显示导出配置对话框
    showExportDataModal() {
        const content = `
            <h3>导出配置数据</h3>
            <div class="export-data-modal">
                <div class="export-options">
                    <h4>选择要导出的数据类型：</h4>
                    <div class="export-checkboxes">
                        <label class="checkbox-item">
                            <input type="checkbox" id="export-sites" checked>
                            <span class="checkmark"></span>
                            站点配置（推荐）
                            <small>包含所有站点信息、API地址、屏蔽线路等</small>
                        </label>
                        <label class="checkbox-item">
                            <input type="checkbox" id="export-aliases" checked>
                            <span class="checkmark"></span>
                            线路别名（推荐）
                            <small>包含所有自定义线路别名设置</small>
                        </label>
                        <label class="checkbox-item">
                            <input type="checkbox" id="export-settings">
                            <span class="checkmark"></span>
                            用户设置
                            <small>包含应用个人偏好设置</small>
                        </label>
                        <label class="checkbox-item">
                            <input type="checkbox" id="export-history">
                            <span class="checkmark"></span>
                            播放历史
                            <small>包含观看记录（文件可能较大）</small>
                        </label>
                        <label class="checkbox-item">
                            <input type="checkbox" id="export-progress">
                            <span class="checkmark"></span>
                            观看进度
                            <small>包含视频播放进度信息</small>
                        </label>
                    </div>
                </div>
                <div class="export-info">
                    <p class="info-note">
                        <i>💡</i> 
                        推荐至少导出站点配置和线路别名，这样可以快速恢复常用设置。
                    </p>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-secondary" id="cancel-export-btn">取消</button>
                    <button type="button" class="btn-primary" id="confirm-export-btn">开始导出</button>
                </div>
            </div>
        `;

        this.showModal(content);

        const cancelBtn = document.getElementById('cancel-export-btn');
        const confirmBtn = document.getElementById('confirm-export-btn');

        cancelBtn.addEventListener('click', () => {
            this.hideModal();
        });

        confirmBtn.addEventListener('click', () => {
            this.performDataExport();
        });
    }

    // 执行数据导出
    performDataExport() {
        try {
            // 获取导出选项
            const exportSites = document.getElementById('export-sites').checked;
            const exportAliases = document.getElementById('export-aliases').checked;
            const exportSettings = document.getElementById('export-settings').checked;
            const exportHistory = document.getElementById('export-history').checked;
            const exportProgress = document.getElementById('export-progress').checked;

            if (!exportSites && !exportAliases && !exportSettings && !exportHistory && !exportProgress) {
                this.showNotification('请至少选择一种数据类型进行导出', 'warning');
                return;
            }

            // 获取完整数据
            const fullData = this.storageService.exportAllData();

            // 根据用户选择过滤数据
            const exportData = {
                exportInfo: fullData.exportInfo
            };

            if (exportSites) exportData.sites = fullData.sites;
            if (exportAliases) exportData.routeAliases = fullData.routeAliases;
            if (exportSettings) exportData.userSettings = fullData.userSettings;
            if (exportHistory) exportData.playHistory = fullData.playHistory;
            if (exportProgress) exportData.watchProgress = fullData.watchProgress;

            // 生成文件名
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
            const fileName = `七星追剧-配置备份-${timestamp}.json`;

            // 创建下载链接
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json'
            });
            const url = URL.createObjectURL(blob);

            // 触发下载
            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = fileName;
            downloadLink.style.display = 'none';
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            URL.revokeObjectURL(url);

            this.hideModal();
            this.showNotification(`配置已导出到：${fileName}`, 'success');

            console.log('[COMPONENTS] 导出完成:', {
                fileName,
                dataTypes: {
                    sites: exportSites,
                    aliases: exportAliases,
                    settings: exportSettings,
                    history: exportHistory,
                    progress: exportProgress
                }
            });
        } catch (error) {
            console.error('[COMPONENTS] 导出失败:', error);
            this.showNotification(`导出失败: ${error.message}`, 'error');
        }
    }

    // 显示导入配置对话框
    showImportDataModal() {
        const content = `
            <h3>导入配置数据</h3>
            <div class="import-data-modal">
                <div class="import-file-section">
                    <h4>选择配置文件：</h4>
                    <div class="file-input-wrapper">
                        <input type="file" id="import-file-select" accept=".json" style="display: none;">
                        <button type="button" class="btn-secondary" id="select-file-btn">
                            <i>📁</i> 选择文件
                        </button>
                        <span id="selected-file-name" class="selected-file-name">未选择文件</span>
                    </div>
                    <div class="file-info">
                        <p class="info-note">
                            <i>💡</i> 
                            支持以下格式的配置文件：<br>
                            • 七星追剧导出的 .json 配置文件（完整导入）<br>
                            • 主站信息格式的 JSON 文件（仅提取站点名称和API地址）
                        </p>
                    </div>
                </div>

                <div class="import-options" id="import-options" style="display: none;">
                    <h4>导入选项：</h4>
                    
                    <!-- 重复处理机制 -->
                    <div class="duplicate-handling-section">
                        <h5>重复配置处理：</h5>
                        <label class="checkbox-item">
                            <input type="checkbox" id="overwrite-duplicates">
                            <span class="checkmark"></span>
                            覆盖重复配置
                            <small>勾选后，导入的新配置将覆盖已存在的同名配置；<br>
                            未勾选时，跳过重复配置，保留原有设置（推荐）</small>
                        </label>
                    </div>

                    <div class="import-data-types" id="import-data-types">
                        <!-- 数据类型选择将根据文件内容动态生成 -->
                    </div>
                </div>

                <div class="form-actions">
                    <button type="button" class="btn-secondary" id="cancel-import-btn">取消</button>
                    <button type="button" class="btn-primary" id="confirm-import-btn" disabled>开始导入</button>
                </div>
            </div>
        `;

        this.showModal(content);

        // 绑定事件
        this.setupImportDataEvents();
    }

    // 设置导入数据事件
    setupImportDataEvents() {
        const fileInput = document.getElementById('import-file-select');
        const selectFileBtn = document.getElementById('select-file-btn');
        const selectedFileName = document.getElementById('selected-file-name');
        const importOptions = document.getElementById('import-options');
        const confirmImportBtn = document.getElementById('confirm-import-btn');
        const cancelImportBtn = document.getElementById('cancel-import-btn');

        // 文件选择事件
        selectFileBtn.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', e => {
            const file = e.target.files[0];
            if (file) {
                selectedFileName.textContent = file.name;
                this.validateImportFile(file);
            } else {
                selectedFileName.textContent = '未选择文件';
                importOptions.style.display = 'none';
                confirmImportBtn.disabled = true;
            }
        });

        confirmImportBtn.addEventListener('click', () => {
            this.performDataImport(fileInput.files[0]);
        });

        cancelImportBtn.addEventListener('click', () => {
            this.hideModal();
        });
    }

    // 验证导入文件
    async validateImportFile(file) {
        try {
            const fileContent = await this.readFileAsText(file);
            const importData = JSON.parse(fileContent);

            // 鎇证数据
            const validation = this.storageService.validateImportData(importData);

            console.log('[COMPONENTS] 导入验证结果:', validation);

            if (!validation.isValid) {
                this.showNotification(`文件格式无效: ${validation.errors.join(', ')}`, 'error');
                return;
            }

            // 显示警告信息
            if (validation.warnings.length > 0) {
                console.warn('[COMPONENTS] 导入警告:', validation.warnings);
                // 可以选择显示警告给用户
                validation.warnings.forEach(warning => {
                    console.warn('[COMPONENTS] 警告:', warning);
                });
            }

            // 使用转换后的数据（如果有转换）
            const finalImportData = validation.convertedData || importData;

            console.log('[COMPONENTS] 最终导入数据:', finalImportData);

            // 生成数据类型选择界面
            this.generateImportDataTypes(finalImportData);

            // 显示导入选项
            document.getElementById('import-options').style.display = 'block';
            document.getElementById('confirm-import-btn').disabled = false;

            this.currentImportData = finalImportData;
        } catch (error) {
            console.error('[COMPONENTS] 文件验证失败:', error);
            this.showNotification(`文件读取失败: ${error.message}`, 'error');
        }
    }

    // 生成导入数据类型选择界面
    generateImportDataTypes(importData) {
        const dataTypesDiv = document.getElementById('import-data-types');
        const dataTypes = [];

        if (importData.sites && importData.sites.length > 0) {
            dataTypes.push({
                key: 'sites',
                label: '站点配置',
                description: `${importData.sites.length} 个站点`,
                recommended: true
            });
        }

        if (importData.routeAliases && Object.keys(importData.routeAliases).length > 0) {
            dataTypes.push({
                key: 'routeAliases',
                label: '线路别名',
                description: `${Object.keys(importData.routeAliases).length} 个别名`,
                recommended: true
            });
        }

        if (importData.userSettings && Object.keys(importData.userSettings).length > 0) {
            dataTypes.push({
                key: 'userSettings',
                label: '用户设置',
                description: '个人偏好设置',
                recommended: false
            });
        }

        if (importData.playHistory && importData.playHistory.length > 0) {
            dataTypes.push({
                key: 'playHistory',
                label: '播放历史',
                description: `${importData.playHistory.length} 条记录`,
                recommended: false
            });
        }

        if (importData.watchProgress && Object.keys(importData.watchProgress).length > 0) {
            dataTypes.push({
                key: 'watchProgress',
                label: '观看进度',
                description: `${Object.keys(importData.watchProgress).length} 个进度`,
                recommended: false
            });
        }

        if (dataTypes.length === 0) {
            dataTypesDiv.innerHTML = '<p class="no-data-warning">该文件中没有可导入的数据</p>';
            document.getElementById('confirm-import-btn').disabled = true;
            return;
        }

        const checkboxes = dataTypes.map(type => `
            <label class="checkbox-item">
                <input type="checkbox" id="import-${type.key}" ${type.recommended ? 'checked' : ''}>
                <span class="checkmark"></span>
                ${type.label}${type.recommended ? ' （推荐）' : ''}
                <small>${type.description}</small>
            </label>
        `).join('');

        dataTypesDiv.innerHTML = `
            <h5>选择要导入的数据类型：</h5>
            <div class="import-checkboxes">
                ${checkboxes}
            </div>
        `;
    }

    // 执行数据导入
    async performDataImport(file) {
        try {
            if (!this.currentImportData) {
                this.showNotification('请先选择有效的配置文件', 'warning');
                return;
            }

            console.log('[COMPONENTS] 开始执行导入操作...');

            // 获取导入选项
            const overwriteDuplicates = document.getElementById('overwrite-duplicates')?.checked || false;

            const importOptions = {
                // 重复处理选项
                overwriteDuplicates,

                // 导入选项
                importHistory: document.getElementById('import-playHistory')?.checked || false,
                importProgress: document.getElementById('import-watchProgress')?.checked || false
            };

            console.log('[COMPONENTS] 导入选项:', importOptions);

            // 过滤要导入的数据
            const filteredData = { ...this.currentImportData };

            if (!document.getElementById('import-sites')?.checked) {
                delete filteredData.sites;
            }
            if (!document.getElementById('import-routeAliases')?.checked) {
                delete filteredData.routeAliases;
            }
            if (!document.getElementById('import-userSettings')?.checked) {
                delete filteredData.userSettings;
            }
            if (!importOptions.importHistory) {
                delete filteredData.playHistory;
            }
            if (!importOptions.importProgress) {
                delete filteredData.watchProgress;
            }

            console.log('[COMPONENTS] 过滤后的导入数据:', filteredData);

            // 执行导入
            const results = this.storageService.importAllData(filteredData, importOptions);

            console.log('[COMPONENTS] 导入结果:', results);

            // 先刷新相关界面（在显示结果对话框之前）
            if (window.app) {
                console.log('[COMPONENTS] 刷新界面...');
                window.app.loadSettings();
                window.app.loadSiteSelector();
                window.app.loadCategorySelector();
                console.log('[COMPONENTS] 界面刷新完成');
            }

            // 如果导入了站点配置，需要重新初始化API服务
            const importedSites = results.details && results.details.sites &&
                (results.details.sites.imported > 0 || results.details.sites.overwritten > 0);
            if (importedSites && window.app && window.app.apiService) {
                console.log('[COMPONENTS] 检测到站点配置变更，重新初始化API服务...');
                try {
                    await window.app.apiService.initialize();
                    console.log('[COMPONENTS] API服务重新初始化完成');
                    // 再次刷新界面以确保API服务状态正确
                    window.app.loadSettings();
                    window.app.loadSiteSelector();
                } catch (error) {
                    console.error('[COMPONENTS] API服务重新初始化失败:', error);
                }
            }

            this.hideModal();

            // 显示导入结果
            this.showImportResults(results);
        } catch (error) {
            console.error('[COMPONENTS] 导入失败:', error);
            this.showNotification(`导入失败: ${error.message}`, 'error');
        }
    }

    // 显示导入结果
    showImportResults(results) {
        const successItems = results.imported.map(item => `<div>✅ ${item}</div>`).join('');
        const skippedItems = results.skipped.map(item => `<div>⏭️ ${item}</div>`).join('');
        const overwrittenItems = results.overwritten.map(item => `<div>🔄 ${item}</div>`).join('');
        const errorItems = results.errors.map(item => `<div>❌ ${item}</div>`).join('');

        // 生成详细统计表格
        const details = results.details || {};
        const statsTable = `
            <div class="import-stats-table">
                <table>
                    <thead>
                        <tr>
                            <th>数据类型</th>
                            <th>新增</th>
                            <th>覆盖</th>
                            <th>跳过</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${details.sites ? `
                        <tr>
                            <td>站点配置</td>
                            <td class="stat-success">${details.sites.imported}</td>
                            <td class="stat-warning">${details.sites.overwritten}</td>
                            <td class="stat-info">${details.sites.skipped}</td>
                        </tr>
                        ` : ''}
                        ${details.routeAliases ? `
                        <tr>
                            <td>线路别名</td>
                            <td class="stat-success">${details.routeAliases.imported}</td>
                            <td class="stat-warning">${details.routeAliases.overwritten}</td>
                            <td class="stat-info">${details.routeAliases.skipped}</td>
                        </tr>
                        ` : ''}
                        ${details.userSettings ? `
                        <tr>
                            <td>用户设置</td>
                            <td class="stat-success">${details.userSettings.imported}</td>
                            <td class="stat-warning">${details.userSettings.overwritten}</td>
                            <td class="stat-info">${details.userSettings.skipped}</td>
                        </tr>
                        ` : ''}
                        ${details.playHistory ? `
                        <tr>
                            <td>播放历史</td>
                            <td class="stat-success">${details.playHistory.imported}</td>
                            <td class="stat-warning">${details.playHistory.overwritten}</td>
                            <td class="stat-info">${details.playHistory.skipped}</td>
                        </tr>
                        ` : ''}
                        ${details.watchProgress ? `
                        <tr>
                            <td>观看进度</td>
                            <td class="stat-success">${details.watchProgress.imported}</td>
                            <td class="stat-warning">${details.watchProgress.overwritten}</td>
                            <td class="stat-info">${details.watchProgress.skipped}</td>
                        </tr>
                        ` : ''}
                    </tbody>
                </table>
            </div>
        `;

        const content = `
            <h3>导入完成</h3>
            <div class="import-results">
                ${statsTable}

                ${results.imported.length > 0 ? `
                    <div class="result-section success">
                        <h4>✅ 新增项目 (${results.imported.length})</h4>
                        <div class="result-items">${successItems}</div>
                    </div>
                ` : ''}
                
                ${results.overwritten.length > 0 ? `
                    <div class="result-section warning">
                        <h4>🔄 覆盖项目 (${results.overwritten.length})</h4>
                        <div class="result-items">${overwrittenItems}</div>
                    </div>
                ` : ''}
                
                ${results.skipped.length > 0 ? `
                    <div class="result-section info">
                        <h4>⏭️ 跳过项目 (${results.skipped.length})</h4>
                        <div class="result-items">${skippedItems}</div>
                    </div>
                ` : ''}
                
                ${results.errors.length > 0 ? `
                    <div class="result-section error">
                        <h4>❌ 导入失败 (${results.errors.length})</h4>
                        <div class="result-items">${errorItems}</div>
                    </div>
                ` : ''}
                
                <div class="import-summary">
                    <p>
                        <strong>导入汇总：</strong>
                        新增 ${results.imported.length} 项，
                        覆盖 ${results.overwritten.length} 项，
                        跳过 ${results.skipped.length} 项，
                        失败 ${results.errors.length} 项
                    </p>
                    ${results.backupKey ? `
                        <p class="backup-info">💡 系统已自动备份导入前的配置，如需撤销可在控制台执行撤销操作。</p>
                    ` : ''}
                </div>
            </div>
            <div class="form-actions">
                ${results.backupKey ? `
                    <button type="button" class="btn-secondary" id="undo-import-btn">撤销导入</button>
                ` : ''}
                <button type="button" class="btn-primary" id="close-results-btn">确定</button>
            </div>
        `;

        this.showModal(content);

        // 关闭按钮事件
        document.getElementById('close-results-btn').addEventListener('click', () => {
            this.hideModal();
            // 关闭对话框后刷新界面
            if (window.app) {
                console.log('[COMPONENTS] 关闭导入结果对话框，刷新界面');
                window.app.loadSettings();
                window.app.loadSiteSelector();
                window.app.loadCategorySelector();
            }
        });

        // 撤销导入按钮事件
        const undoBtn = document.getElementById('undo-import-btn');
        if (undoBtn && results.backupKey) {
            undoBtn.addEventListener('click', () => {
                if (confirm('确定要撤销本次导入操作吗？将恢复到导入前的配置状态。')) {
                    const success = this.storageService.undoImport(results.backupKey);
                    if (success) {
                        this.showNotification('已撤销导入，配置已恢复', 'success');
                        this.hideModal();
                        // 刷新界面
                        if (window.app) {
                            window.app.loadSettings();
                            window.app.loadSiteSelector();
                            window.app.loadCategorySelector();
                        }
                    } else {
                        this.showNotification('撤销失败，备份可能已过期', 'error');
                    }
                }
            });
        }

        // 显示通知
        if (results.errors.length > 0) {
            this.showNotification(`导入完成，但有 ${results.errors.length} 项失败`, 'warning');
        } else if (results.imported.length > 0 || results.overwritten.length > 0) {
            this.showNotification(`配置导入成功！新增 ${results.imported.length} 项，覆盖 ${results.overwritten.length} 项`, 'success');
        } else {
            this.showNotification('导入完成，没有新增或覆盖的配置', 'info');
        }
    }

    // 读取文件为文本
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = e => reject(new Error('文件读取失败'));
            reader.readAsText(file, 'utf-8');
        });
    }

    // 设置分享按钮事件
    setupShareEvent() {
        const shareBtn = document.getElementById('share-video-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', () => {
                this.shareCurrentVideo();
            });
        }
    }

    // 分享当前视频
    async shareCurrentVideo() {
        if (!this.currentVideoData) {
            this.showNotification('无法获取当前视频信息', 'error');
            return;
        }

        try {
            // 获取当前站点信息
            const activeSite = this.apiService.getActiveSite();
            if (!activeSite) {
                this.showNotification('无法获取站点信息', 'error');
                return;
            }

            // 生成分享数据
            const shareData = {
                siteName: activeSite.name,
                siteUrl: activeSite.url,
                videoName: this.currentVideoData.vod_name,
                videoId: this.currentVideoData.vod_id,
                videoPic: this.currentVideoData.vod_pic || '',
                videoRemarks: this.currentVideoData.vod_remarks || '',
                videoContent: this.currentVideoData.vod_content || '', // 添加剧情介绍
                detailUrl: `${activeSite.url}?ac=detail&ids=${this.currentVideoData.vod_id}`,
                timestamp: Date.now()
            };

            // 加密数据
            const encryptedData = this.encryptShareData(shareData);

            // 生成图文并茂的分享字符串
            const shareText = this.generateShareText(shareData, encryptedData);

            // 复制到剪切板
            try {
                // 优先使用Electron的剪切板API
                if (window.electron && window.electron.clipboard) {
                    await window.electron.clipboard.writeText(shareText);
                } else {
                    // 备用方案：使用Web API
                    await navigator.clipboard.writeText(shareText);
                }
                this.showNotification('分享内容已复制到剪切板，可发送给好友！', 'success');
            } catch (error) {
                console.error('复制到剪切板失败:', error);
                // 显示分享内容供用户手动复制
                this.showShareModal(shareText);
            }
        } catch (error) {
            console.error('生成分享内容失败:', error);
            this.showNotification('生成分享内容失败', 'error');
        }
    }

    // 加密分享数据
    encryptShareData(data) {
        try {
            console.log('[COMPONENTS] 开始加密分享数据:', data);

            // 精简数据，只保留必要字段
            const compactData = {
                s: data.siteName, // 站点名称
                u: data.siteUrl.replace(/https:\/\//g, 'hs:').replace(/http:\/\//g, 'h:'), // 站点URL（简化协议）
                n: data.videoName, // 视频名称
                i: data.videoId, // 视频ID
                t: data.timestamp // 时间戳
            };

            console.log('[COMPONENTS] 精简后的数据:', compactData);

            // 使用紧凑的JSON格式
            const jsonStr = JSON.stringify(compactData);
            console.log('[COMPONENTS] JSON字符串:', jsonStr);

            // 简化处理，不做额外压缩
            const compressed = this.simpleCompress(jsonStr);
            console.log('[COMPONENTS] 压缩后:', compressed);

            // Base64编码 - 正确处理中文字符
            const base64 = btoa(unescape(encodeURIComponent(compressed)));
            console.log('[COMPONENTS] Base64编码:', base64);

            // 简单字符替换，减少长度
            const result = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
            console.log('[COMPONENTS] 最终加密结果:', result);

            return result;
        } catch (error) {
            console.error('[COMPONENTS] 加密失败:', error);
            return '';
        }
    } // 解密分享数据
    decryptShareData(encryptedStr) {
        try {
            // 先尝试新格式解密
            return this.decryptNewFormat(encryptedStr);
        } catch (error) {
            console.log('[COMPONENTS] 新格式解密失败，尝试旧格式:', error.message);
            // 如果新格式失败，尝试旧格式解密
            try {
                return this.decryptOldFormat(encryptedStr);
            } catch (oldError) {
                console.error('[COMPONENTS] 旧格式解密也失败:', oldError);
                return null;
            }
        }
    }

    // 新格式解密
    decryptNewFormat(encryptedStr) {
        // 恢复Base64格式
        let base64 = encryptedStr.replace(/-/g, '+').replace(/_/g, '/');

        // 添加必要的填充
        while (base64.length % 4) {
            base64 += '=';
        }

        // Base64解码 - 正确处理中文字符
        const compressed = decodeURIComponent(escape(atob(base64)));

        // 解压缩
        const jsonStr = this.simpleDecompress(compressed);

        // 解析JSON
        const compactData = JSON.parse(jsonStr);

        // 检查是否是新格式（有简化字段）
        if (!compactData.s || !compactData.u || !compactData.n || (!compactData.i && compactData.i !== 0)) {
            throw new Error('不是新格式数据');
        }

        // 重构站点URL（处理简化的协议）
        let siteUrl = compactData.u;
        if (siteUrl.startsWith('hs:')) {
            siteUrl = siteUrl.replace('hs:', 'https://');
        } else if (siteUrl.startsWith('h:')) {
            siteUrl = siteUrl.replace('h:', 'http://');
        }

        // 重构完整数据
        const fullData = {
            siteName: compactData.s,
            siteUrl,
            videoName: compactData.n,
            videoId: compactData.i,
            timestamp: compactData.t,
            // 重构其他字段
            videoPic: '',
            videoRemarks: '',
            detailUrl: `${siteUrl}?ac=detail&ids=${compactData.i}`
        };

        return fullData;
    } // 旧格式解密（向后兼容）
    decryptOldFormat(encryptedStr) {
        // 反向混淆
        let hexString = '';
        for (let i = 0; i < encryptedStr.length; i++) {
            const char = encryptedStr[i];
            if (char >= 'a' && char <= 'j') {
                hexString += (char.charCodeAt(0) - 97).toString(); // a-j转回0-9
            } else if (char >= 'k' && char <= 'p') {
                hexString += String.fromCharCode(97 + (char.charCodeAt(0) - 107)); // k-p转回a-f
            } else {
                hexString += char;
            }
        }

        // 十六进制转回Base64
        let base64 = '';
        for (let i = 0; i < hexString.length; i += 2) {
            const hex = hexString.substr(i, 2);
            base64 += String.fromCharCode(parseInt(hex, 16));
        }

        // Base64解码
        const jsonStr = decodeURIComponent(escape(atob(base64)));
        return JSON.parse(jsonStr);
    }

    // 简单压缩算法
    simpleCompress(str) {
        // 简化：直接返回原字符串，不做压缩处理
        // 因为JSON已经很紧凑了
        return str;
    }

    // 简单解压缩算法
    simpleDecompress(str) {
        // 简化：直接返回原字符串，不做解压处理
        return str;
    }

    // 生成图文并茂的分享字符串
    generateShareText(data, encryptedData) {
        // 处理剧情介绍：去除HTML标签，限制长度
        let description = '';
        if (data.videoContent) {
            // 去除HTML标签
            description = data.videoContent.replace(/<[^>]*>/g, '');
            // 限制长度，避免分享内容过长
            if (description.length > 80) {
                description = `${description.substring(0, 80)}...`;
            }
        }

        const shareText = `🎬 【七星追剧】剧集分享 🎬

📺 剧名：${data.videoName}
🌐 来源：${data.siteName}
📝 状态：${data.videoRemarks}
${description ? `� 简介：${description}` : ''}

✨ 这是一部不错的影视作品，推荐给你观看！
💡 复制此消息到"七星追剧"应用，即可直接跳转观看

🔐 分享码：${encryptedData}

📱 下载七星追剧：https://gitee.com/fjcq/qixing-zhuiju/releases/latest`;

        return shareText;
    }

    // 显示分享模态框
    showShareModal(shareText) {
        const content = `
            <div class="share-modal">
                <h3>📤 分享剧集</h3>
                <p class="share-instruction">复制下方内容发送给好友：</p>
                <div class="share-content">
                    <textarea readonly onclick="this.select()">${shareText}</textarea>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn-primary" id="copy-share-btn">复制内容</button>
                    <button type="button" class="btn-secondary" id="close-share-btn">关闭</button>
                </div>
            </div>
        `;

        this.showModal(content);

        // 复制按钮事件
        document.getElementById('copy-share-btn').addEventListener('click', async () => {
            try {
                // 优先使用Electron的剪切板API
                if (window.electron && window.electron.clipboard) {
                    await window.electron.clipboard.writeText(shareText);
                } else {
                    // 备用方案：使用Web API
                    await navigator.clipboard.writeText(shareText);
                }
                this.showNotification('已复制到剪切板', 'success');
                this.hideModal();
            } catch (error) {
                console.error('复制失败:', error);
                this.showNotification('复制失败，请手动选择内容复制', 'error');
            }
        });

        // 关闭按钮事件
        document.getElementById('close-share-btn').addEventListener('click', () => {
            this.hideModal();
        });
    }
}

// 导出组件服务
window.ComponentService = ComponentService;
