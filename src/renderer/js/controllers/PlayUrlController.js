/**
 * 播放链接控制器
 * 负责处理网络链接、本地文件和磁力链的播放功能
 */
class PlayUrlController {
    constructor(app) {
        this.app = app;
        this.storageService = app.storageService;
        this.componentService = app.componentService;
        this.urlHistory = this.loadUrlHistory();
    }

    /**
     * 初始化播放链接页面
     */
    initialize() {
        console.log('[PlayUrlController] 初始化播放链接页面');
        this.setupEventListeners();
        this.loadUrlHistoryDisplay();
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 播放URL按钮
        const playUrlBtn = document.getElementById('play-url-btn');
        if (playUrlBtn) {
            playUrlBtn.addEventListener('click', () => this.handlePlayUrl());
        }

        // URL输入框回车事件
        const urlInput = document.getElementById('video-url-input');
        if (urlInput) {
            urlInput.addEventListener('keypress', e => {
                if (e.key === 'Enter') {
                    this.handlePlayUrl();
                }
            });
        }

        // 选择本地文件按钮
        const selectFileBtn = document.getElementById('select-file-btn');
        if (selectFileBtn) {
            selectFileBtn.addEventListener('click', () => this.selectLocalFile());
        }

        // 清空URL历史按钮
        const clearHistoryBtn = document.getElementById('clear-url-history-btn');
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => this.clearUrlHistory());
        }
    }

    /**
     * 处理播放URL
     */
    async handlePlayUrl() {
        const urlInput = document.getElementById('video-url-input');
        const url = urlInput?.value?.trim();

        if (!url) {
            this.componentService.showNotification('请输入视频链接', 'warning');
            return;
        }

        console.log('[PlayUrlController] 处理播放URL:', url);

        // 判断URL类型
        if (this.isMagnetLink(url)) {
            // 磁力链接
            await this.handleMagnetLink(url);
        } else if (this.isNetworkUrl(url)) {
            // 网络链接
            await this.playNetworkUrl(url);
        } else {
            this.componentService.showNotification('不支持的链接格式', 'error');
        }
    }

    /**
     * 判断是否为磁力链接
     * 支持格式：
     * 1. 标准磁力链接：magnet:?xt=urn:btih:...
     * 2. 纯info hash：40字符或32字符的十六进制字符串
     * @param {string} url - URL字符串
     * @returns {boolean}
     */
    isMagnetLink(url) {
        // 标准磁力链接格式
        if (url.startsWith('magnet:') || url.includes('magnet:?')) {
            return true;
        }

        // 纯info hash格式（40字符十六进制 = SHA1，或32字符 = base32）
        const cleanUrl = url.trim();
        if (/^[a-fA-F0-9]{40}$/i.test(cleanUrl) || /^[A-Z2-7]{32}$/i.test(cleanUrl)) {
            return true;
        }

        return false;
    }

    /**
     * 将纯info hash转换为标准磁力链接
     * @param {string} url - URL或info hash
     * @returns {string} 标准磁力链接
     */
    normalizeMagnetLink(url) {
        // 如果已经是标准磁力链接，直接返回
        if (url.startsWith('magnet:')) {
            return url;
        }

        // 如果是纯info hash，转换为磁力链接格式
        const cleanUrl = url.trim();
        if (/^[a-fA-F0-9]{40}$/i.test(cleanUrl) || /^[A-Z2-7]{32}$/i.test(cleanUrl)) {
            return `magnet:?xt=urn:btih:${cleanUrl}`;
        }

        return url;
    }

    /**
     * 判断是否为网络URL
     * @param {string} url - URL字符串
     * @returns {boolean}
     */
    isNetworkUrl(url) {
        return url.startsWith('http://') || url.startsWith('https://');
    }

    /**
     * 播放网络URL
     * @param {string} url - 视频URL
     */
    async playNetworkUrl(url) {
        try {
            console.log('[PlayUrlController] 播放网络URL:', url);

            // 保存到历史记录
            this.saveUrlToHistory(url, 'network');

            // 构建视频数据
            const videoData = {
                url: url,
                title: this.extractFileName(url) || '网络视频',
                vod_name: this.extractFileName(url) || '网络视频',
                episode_name: '正片',
                isDirectPlay: true, // 标记为直接播放模式
                playSource: 'network'
            };

            // 打开播放器
            await this.openPlayer(videoData);

            this.componentService.showNotification('正在加载视频...', 'info');
        } catch (error) {
            console.error('[PlayUrlController] 播放网络URL失败:', error);
            this.componentService.showNotification(`播放失败: ${error.message}`, 'error');
        }
    }

    /**
     * 处理磁力链接
     * @param {string} magnetUri - 磁力链接或info hash
     */
    async handleMagnetLink(magnetUri) {
        try {
            console.log('[PlayUrlController] 处理磁力链接:', magnetUri);

            // 转换为标准磁力链接格式
            const normalizedUri = this.normalizeMagnetLink(magnetUri);
            console.log('[PlayUrlController] 标准化磁力链接:', normalizedUri);

            // 显示进度区域
            const progressSection = document.getElementById('magnet-progress-section');
            if (progressSection) {
                progressSection.classList.remove('hidden');
            }

            // 更新状态
            this.updateMagnetStatus('正在解析磁力链接...', 0);

            // 保存到历史记录（保存原始输入）
            this.saveUrlToHistory(magnetUri, 'magnet');

            // 设置进度监听
            if (window.electron && window.electron.onMagnetProgress) {
                window.electron.onMagnetProgress(data => {
                    this.updateMagnetStatus(data.status, data.progress);
                });
            }

            // 调用主进程处理磁力链接
            if (window.electron && window.electron.ipcRenderer) {
                const result = await window.electron.ipcRenderer.invoke('handle-magnet-link', normalizedUri);

                // 移除进度监听
                if (window.electron && window.electron.removeMagnetProgressListener) {
                    window.electron.removeMagnetProgressListener();
                }

                if (result && result.success) {
                    // 保存infoHash供后续播放使用
                    this._currentMagnetInfoHash = result.infoHash || '';
                    // 显示文件列表供用户选择
                    this.showMagnetFilesList(result.files, normalizedUri);
                } else {
                    throw new Error(result?.error || '磁力链接解析失败');
                }
            } else {
                throw new Error('Electron IPC不可用');
            }
        } catch (error) {
            console.error('[PlayUrlController] 处理磁力链接失败:', error);
            // 移除进度监听
            if (window.electron && window.electron.removeMagnetProgressListener) {
                window.electron.removeMagnetProgressListener();
            }
            this.componentService.showNotification(`磁力链接处理失败: ${error.message}`, 'error');
            this.hideMagnetProgress();
        }
    }

    /**
     * 显示磁力链接文件列表
     * @param {Array} files - 文件列表
     * @param {string} magnetUri - 磁力链接
     */
    showMagnetFilesList(files, magnetUri) {
        const filesListContainer = document.getElementById('magnet-files-list');
        if (!filesListContainer) return;

        // 过滤视频文件
        const videoFiles = files.filter(file => this.isVideoFile(file.name));

        if (videoFiles.length === 0) {
            filesListContainer.innerHTML = '<p class="no-files">未找到视频文件</p>';
            return;
        }

        filesListContainer.innerHTML = `
            <p class="files-hint">找到 ${videoFiles.length} 个视频文件，点击播放：</p>
            <div class="magnet-file-list">
                ${videoFiles.map((file, index) => `
                    <div class="magnet-file-item" data-index="${index}" data-name="${file.name}">
                        <span class="file-icon">🎬</span>
                        <span class="file-name">${file.name}</span>
                        <span class="file-size">${this.formatFileSize(file.length)}</span>
                    </div>
                `).join('')}
            </div>
        `;

        // 添加点击事件
        const fileItems = filesListContainer.querySelectorAll('.magnet-file-item');
        fileItems.forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.playMagnetFile(magnetUri, videoFiles[index]);
            });
        });
    }

    /**
     * 播放磁力链接中的文件
     * @param {string} magnetUri - 磁力链接
     * @param {object} file - 文件信息
     */
    async playMagnetFile(magnetUri, file) {
        // 将进度监听器声明提升到try外部，确保catch块能访问以正确移除
        let progressHandler = null;

        try {
            console.log('[PlayUrlController] 播放磁力文件:', file.name);

            this.updateMagnetStatus(`正在准备: ${file.name}`, 0);

            // 监听下载进度
            if (window.electron && window.electron.ipcRenderer) {
                progressHandler = (data) => {
                    if (data.fileName === file.name) {
                        const statusText = this.getMagnetStatusText(data);
                        this.updateMagnetStatus(statusText, data.progress);

                        // 下载完成后移除监听
                        if (data.progress >= 100 || data.status === 'done') {
                            window.electron.ipcRenderer.removeListener('magnet-download-progress', progressHandler);
                            progressHandler = null;
                        }
                    }
                };
                window.electron.ipcRenderer.on('magnet-download-progress', progressHandler);

                const result = await window.electron.ipcRenderer.invoke('play-magnet-file', {
                    magnetUri,
                    fileName: file.name,
                    infoHash: this._currentMagnetInfoHash || ''
                });

                if (result && result.success) {
                    // 构建视频数据
                    const videoData = {
                        url: result.streamUrl,
                        title: file.name,
                        vod_name: file.name,
                        episode_name: '正片',
                        isDirectPlay: true,
                        playSource: 'magnet',
                        isStreaming: !result.isLocal,
                        isLocal: result.isLocal || false
                    };

                    await this.openPlayer(videoData);
                } else {
                    throw new Error(result?.error || '播放失败');
                }
            }
        } catch (error) {
            console.error('[PlayUrlController] 播放磁力文件失败:', error);
            this.componentService.showNotification(`播放失败: ${error.message}`, 'error');
            this.hideMagnetProgress();
        } finally {
            // 无论成功还是失败，都确保移除监听器防止内存泄漏
            if (progressHandler && window.electron && window.electron.ipcRenderer) {
                window.electron.ipcRenderer.removeListener('magnet-download-progress', progressHandler);
            }
        }
    }

    /**
     * 根据状态数据生成提示文本
     * @param {object} data - 进度数据
     * @returns {string} 状态文本
     */
    getMagnetStatusText(data) {
        const speed = data.downloadSpeed > 0
            ? ` (${(data.downloadSpeed / 1024 / 1024).toFixed(1)} MB/s)`
            : '';
        const wires = data.wires > 0 ? ` [${data.wires}个连接]` : '';
        const peers = data.numPeers > 0 ? ` [发现${data.numPeers}个节点]` : '';

        switch (data.status) {
            case 'connecting':
                return '正在连接做种者，请稍候...';
            case 'no-peers':
                return '正在寻找做种者...';
            case 'no-peers-warning':
                return '⚠ 30秒内未找到做种者，该资源可能无人做种，继续尝试中...';
            case 'connected-waiting':
                return `已连接${data.wires}个节点，等待数据传输...`;
            case 'slow-warning':
                return `⚠ 60秒内无数据下载，该资源可能做种者不活跃，继续尝试中...`;
            case 'downloading':
                return `下载中: ${data.progress}%${speed}${wires}`;
            case 'done':
                return '下载完成';
            default:
                if (data.progress > 0) {
                    return `下载中: ${data.progress}%${speed}${wires}`;
                }
                return '正在准备...';
        }
    }

    /**
     * 选择本地文件
     */
    async selectLocalFile() {
        try {
            console.log('[PlayUrlController] 选择本地文件');

            // 调用主进程打开文件选择对话框
            if (window.electron && window.electron.ipcRenderer) {
                const result = await window.electron.ipcRenderer.invoke('select-video-file');

                if (result && result.success && result.filePath) {
                    // 更新显示的文件路径
                    const filePathElement = document.getElementById('selected-file-path');
                    if (filePathElement) {
                        filePathElement.textContent = result.filePath;
                    }

                    // 播放本地文件
                    await this.playLocalFile(result.filePath);
                }
            } else {
                this.componentService.showNotification('Electron IPC不可用', 'error');
            }
        } catch (error) {
            console.error('[PlayUrlController] 选择文件失败:', error);
            this.componentService.showNotification(`选择文件失败: ${error.message}`, 'error');
        }
    }

    /**
     * 播放本地文件
     * @param {string} filePath - 本地文件路径
     */
    async playLocalFile(filePath) {
        try {
            console.log('[PlayUrlController] 播放本地文件:', filePath);

            // 保存到历史记录
            this.saveUrlToHistory(filePath, 'local');

            // 构建视频数据
            const fileName = this.extractFileName(filePath);
            const videoData = {
                url: `file://${filePath}`,
                title: fileName,
                vod_name: fileName,
                episode_name: '正片',
                isDirectPlay: true,
                playSource: 'local',
                localPath: filePath
            };

            await this.openPlayer(videoData);

            this.componentService.showNotification('正在加载本地视频...', 'info');
        } catch (error) {
            console.error('[PlayUrlController] 播放本地文件失败:', error);
            this.componentService.showNotification(`播放失败: ${error.message}`, 'error');
        }
    }

    /**
     * 打开播放器
     * @param {object} videoData - 视频数据
     */
    async openPlayer(videoData) {
        try {
            if (window.electron && window.electron.ipcRenderer) {
                const result = await window.electron.ipcRenderer.invoke('open-player', videoData);

                if (result && result.success) {
                    console.log('[PlayUrlController] 播放器已打开');
                } else {
                    throw new Error(result?.message || '打开播放器失败');
                }
            } else {
                throw new Error('Electron IPC不可用');
            }
        } catch (error) {
            console.error('[PlayUrlController] 打开播放器失败:', error);
            throw error;
        }
    }

    /**
     * 更新磁力链接状态
     * @param {string} status - 状态文本
     * @param {number} progress - 进度百分比
     */
    updateMagnetStatus(status, progress) {
        const statusElement = document.getElementById('magnet-status');
        const progressBar = document.getElementById('magnet-progress-bar');

        if (statusElement) {
            statusElement.textContent = status;
        }

        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }
    }

    /**
     * 隐藏磁力进度区域
     */
    hideMagnetProgress() {
        const progressSection = document.getElementById('magnet-progress-section');
        if (progressSection) {
            progressSection.classList.add('hidden');
        }
    }

    /**
     * 判断是否为视频文件
     * @param {string} fileName - 文件名
     * @returns {boolean}
     */
    isVideoFile(fileName) {
        const videoExtensions = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m3u8', '.mpd', '.flv', '.wmv'];
        const lowerName = fileName.toLowerCase();
        return videoExtensions.some(ext => lowerName.endsWith(ext));
    }

    /**
     * 提取文件名
     * @param {string} urlOrPath - URL或路径
     * @returns {string}
     */
    extractFileName(urlOrPath) {
        try {
            const parts = urlOrPath.split('/');
            const lastPart = parts[parts.length - 1];
            // 移除查询参数
            return lastPart.split('?')[0] || '视频';
        } catch {
            return '视频';
        }
    }

    /**
     * 格式化文件大小
     * @param {number} bytes - 字节数
     * @returns {string}
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 保存URL到历史记录
     * @param {string} url - URL
     * @param {string} type - 类型 (network/local/magnet)
     */
    saveUrlToHistory(url, type) {
        const history = this.loadUrlHistory();

        // 移除重复项
        const filtered = history.filter(item => item.url !== url);

        // 添加新记录
        filtered.unshift({
            url,
            type,
            name: this.extractFileName(url),
            time: Date.now()
        });

        // 限制数量
        const limited = filtered.slice(0, 20);

        // 保存
        localStorage.setItem('URL_PLAY_HISTORY', JSON.stringify(limited));
        this.urlHistory = limited;

        // 更新显示
        this.loadUrlHistoryDisplay();
    }

    /**
     * 加载URL历史记录
     * @returns {Array}
     */
    loadUrlHistory() {
        try {
            return JSON.parse(localStorage.getItem('URL_PLAY_HISTORY') || '[]');
        } catch {
            return [];
        }
    }

    /**
     * 加载URL历史记录显示
     */
    loadUrlHistoryDisplay() {
        const historyList = document.getElementById('url-history-list');
        if (!historyList) return;

        const history = this.loadUrlHistory();

        if (history.length === 0) {
            historyList.innerHTML = '<div class="empty-history">暂无播放历史</div>';
            return;
        }

        historyList.innerHTML = history.map(item => `
            <div class="url-history-item" data-url="${item.url}" data-type="${item.type}">
                <span class="history-icon">${this.getTypeIcon(item.type)}</span>
                <span class="history-name" title="${item.url}">${item.name}</span>
                <span class="history-time">${this.formatTime(item.time)}</span>
                <button class="history-remove" title="删除">×</button>
            </div>
        `).join('');

        // 添加点击事件
        const items = historyList.querySelectorAll('.url-history-item');
        items.forEach(item => {
            // 点击播放
            item.addEventListener('click', e => {
                if (!e.target.classList.contains('history-remove')) {
                    this.replayHistoryItem(item.dataset.url, item.dataset.type);
                }
            });

            // 删除按钮
            const removeBtn = item.querySelector('.history-remove');
            if (removeBtn) {
                removeBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    this.removeHistoryItem(item.dataset.url);
                });
            }
        });
    }

    /**
     * 获取类型图标
     * @param {string} type - 类型
     * @returns {string}
     */
    getTypeIcon(type) {
        switch (type) {
            case 'network':
                return '🌐';
            case 'local':
                return '📁';
            case 'magnet':
                return '🧲';
            default:
                return '🎬';
        }
    }

    /**
     * 格式化时间
     * @param {number} timestamp - 时间戳
     * @returns {string}
     */
    formatTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;

        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
        return `${Math.floor(diff / 86400000)}天前`;
    }

    /**
     * 重新播放历史项
     * @param {string} url - URL
     * @param {string} type - 类型
     */
    async replayHistoryItem(url, type) {
        const urlInput = document.getElementById('video-url-input');
        if (urlInput) {
            urlInput.value = url;
        }

        if (type === 'local') {
            await this.playLocalFile(url.replace('file://', ''));
        } else if (type === 'magnet') {
            await this.handleMagnetLink(url);
        } else {
            await this.playNetworkUrl(url);
        }
    }

    /**
     * 移除历史项
     * @param {string} url - URL
     */
    removeHistoryItem(url) {
        const history = this.loadUrlHistory();
        const filtered = history.filter(item => item.url !== url);
        localStorage.setItem('URL_PLAY_HISTORY', JSON.stringify(filtered));
        this.urlHistory = filtered;
        this.loadUrlHistoryDisplay();
    }

    /**
     * 清空URL历史
     */
    clearUrlHistory() {
        if (confirm('确定要清空所有播放历史吗？')) {
            localStorage.removeItem('URL_PLAY_HISTORY');
            this.urlHistory = [];
            this.loadUrlHistoryDisplay();
            this.componentService.showNotification('播放历史已清空', 'success');
        }
    }
}

// 导出控制器
window.PlayUrlController = PlayUrlController;
