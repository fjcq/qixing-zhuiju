/**
 * 设置控制器
 * 管理站点配置、线路别名和应用设置
 */
class SettingsController {
    /**
     * 构造函数
     * @param {object} options - 配置选项
     * @param {object} options.apiService - API服务实例
     * @param {object} options.storageService - 存储服务实例
     * @param {object} options.componentService - 组件服务实例
     */
    constructor(options) {
        this.apiService = options.apiService;
        this.storageService = options.storageService;
        this.componentService = options.componentService;
    }

    /**
     * 加载设置页面
     */
    loadSettings() {
        this.loadSiteList();
        this.loadRouteAliases();
    }

    /**
     * 加载站点列表
     */
    loadSiteList() {
        const siteList = document.getElementById('site-list');
        if (!siteList) return;

        const sites = this.apiService.getSites();
        siteList.innerHTML = '';

        if (sites.length > 0) {
            sites.forEach(site => {
                const siteElement = this.componentService.createSiteItem(site);
                siteElement.draggable = true;
                siteList.appendChild(siteElement);
            });

            this.setupDragAndDrop(siteList);
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

    /**
     * 加载线路别名列表
     */
    loadRouteAliases() {
        const routeAliasesList = document.getElementById('route-aliases-list');
        if (!routeAliasesList) return;

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

    /**
     * 设置拖拽排序功能
     * @param {HTMLElement} siteList - 站点列表容器
     */
    setupDragAndDrop(siteList) {
        const siteItems = siteList.querySelectorAll('.site-item');
        siteItems.forEach(item => {
            // 移除可能存在的旧拖拽事件监听器
            const newItem = item.cloneNode(true);
            item.replaceWith(newItem);

            // 拖拽开始事件
            newItem.addEventListener('dragstart', e => {
                e.target.classList.add('dragging');
                e.dataTransfer.setData('text/plain', e.target.dataset.siteId);
            });

            // 拖拽结束事件
            newItem.addEventListener('dragend', e => {
                e.target.classList.remove('dragging');
            });

            // 重新绑定原始事件监听器
            const { siteId } = newItem.dataset;
            const site = this.apiService.getSites().find(s => s.id === siteId);

            if (site) {
                const testBtn = newItem.querySelector('.btn-test');
                const editBtn = newItem.querySelector('.btn-edit');
                const activateBtn = newItem.querySelector('.btn-activate');
                const deleteBtn = newItem.querySelector('.btn-delete');

                testBtn?.addEventListener('click', () => {
                    this.componentService.testSiteConnection(site);
                });
                editBtn?.addEventListener('click', () => {
                    this.componentService.showEditSiteModal(site);
                });
                activateBtn?.addEventListener('click', () => {
                    this.componentService.activateSite(site.id);
                });
                deleteBtn?.addEventListener('click', () => {
                    this.componentService.confirmDeleteSite(site);
                });
            }
        });

        // 拖拽进入事件
        const dragoverListener = e => {
            e.preventDefault();
            const afterElement = this.getDragAfterElement(siteList, e.clientY);
            const draggable = document.querySelector('.dragging');
            if (draggable) {
                if (afterElement == null) {
                    siteList.appendChild(draggable);
                } else {
                    siteList.insertBefore(draggable, afterElement);
                }
            }
        };

        siteList.addEventListener('dragover', dragoverListener);

        // 拖拽放下事件
        siteList.addEventListener('drop', e => {
            e.preventDefault();
            this.saveSiteOrder(siteList);
        });
    }

    /**
     * 获取拖拽后的元素位置
     * @param {HTMLElement} container - 容器元素
     * @param {number} y - 鼠标Y坐标
     * @returns {HTMLElement|null} 应该插入在其后的元素
     */
    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.site-item:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    /**
     * 保存站点顺序
     * @param {HTMLElement} siteList - 站点列表容器
     */
    saveSiteOrder(siteList) {
        const siteItems = siteList.querySelectorAll('.site-item');
        const siteIds = Array.from(siteItems).map(item => item.dataset.siteId);

        // 更新站点顺序
        this.apiService.reorderSites(siteIds);
        console.log('[SettingsController] 站点顺序已保存:', siteIds);
        this.componentService.showNotification('站点顺序已保存', 'success');
    }

    /**
     * 导出数据
     */
    exportData() {
        try {
            const data = {
                sites: this.apiService.getSites(),
                playHistory: this.storageService.getPlayHistory(),
                favorites: this.storageService.getFavorites(),
                routeAliases: this.storageService.getAllRouteAliases(),
                exportTime: new Date().toISOString(),
                version: '1.4.0'
            };

            const jsonStr = JSON.stringify(data, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `qixing-zhuiju-backup-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.componentService.showNotification('数据导出成功', 'success');
            console.log('[SettingsController] 数据导出成功');
        } catch (error) {
            console.error('[SettingsController] 导出失败:', error);
            this.componentService.showNotification(`导出失败: ${error.message}`, 'error');
        }
    }

    /**
     * 导入数据
     * @param {File} file - 导入的文件
     */
    async importData(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            // 验证数据格式
            if (!data.version || !data.sites) {
                throw new Error('无效的备份文件格式');
            }

            // 导入站点
            if (data.sites && Array.isArray(data.sites)) {
                data.sites.forEach(site => {
                    // 检查站点是否已存在
                    const existingSite = this.apiService.getSites().find(s => s.url === site.url);
                    if (!existingSite) {
                        this.apiService.addSite(site);
                    }
                });
            }

            // 导入播放历史
            if (data.playHistory && Array.isArray(data.playHistory)) {
                data.playHistory.forEach(item => {
                    this.storageService.addPlayHistory(item);
                });
            }

            // 导入收藏
            if (data.favorites && Array.isArray(data.favorites)) {
                data.favorites.forEach(item => {
                    this.storageService.addFavorite(item);
                });
            }

            // 导入线路别名
            if (data.routeAliases && typeof data.routeAliases === 'object') {
                Object.entries(data.routeAliases).forEach(([routeName, alias]) => {
                    this.storageService.setRouteAlias(routeName, alias);
                });
            }

            this.componentService.showNotification('数据导入成功', 'success');
            this.loadSettings();
            console.log('[SettingsController] 数据导入成功');
        } catch (error) {
            console.error('[SettingsController] 导入失败:', error);
            this.componentService.showNotification(`导入失败: ${error.message}`, 'error');
        }
    }

    /**
     * 重置所有设置
     */
    resetAllSettings() {
        if (confirm('确定要重置所有设置吗？这将清除所有站点、历史记录和配置。')) {
            localStorage.clear();
            this.componentService.showNotification('设置已重置，请重启应用', 'success');
            console.log('[SettingsController] 所有设置已重置');
        }
    }
}

// 导出给渲染进程使用
window.SettingsController = SettingsController;
