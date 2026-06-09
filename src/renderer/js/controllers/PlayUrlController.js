/**
 * PlayUrlController
 * 外链页面主控制器：协调 5 个子模块，实现状态机驱动的智能识别播放流程
 *
 * 依赖模块（通过 window 全局访问）：
 * - inputRecognizer.detectInputType 智能识别输入类型
 * - UrlHistoryManager 播放历史管理（包装 storage.js）
 * - fileListRenderer 磁力链文件列表渲染
 * - MagnetParserAdapter 磁力链 IPC 适配器
 * - HistoryDrawer 历史抽屉 UI
 *
 * 状态机：IDLE → EDITING → RECOGNIZED → PARSE_PROGRESS → FILES_READY → PLAYING
 */
(function () {
    'use strict';

    // 状态机常量
    const STATE = {
        IDLE: 'idle',
        EDITING: 'editing',
        RECOGNIZED: 'recognized',
        PARSE_PROGRESS: 'parse_progress',
        FILES_READY: 'files_ready',
        PLAYING: 'playing'
    };

    // 徽章显示配置
    const BADGE_CONFIG = {
        empty: { text: '🌐 URL', cls: 'is-empty' },
        url: { text: '🌐 URL', cls: 'is-url' },
        local: { text: '📁 本地', cls: 'is-local' },
        magnet: { text: '🧲 磁力', cls: 'is-magnet' },
        unknown: { text: '❓ 未知', cls: 'is-unknown' }
    };

    class PlayUrlController {
        /**
         * @param {object} app - 主应用实例（提供 componentService / storageService）
         */
        constructor(app) {
            this.app = app;
            this.componentService = (app && app.componentService) || (window.app && window.app.componentService);
            this.state = STATE.IDLE;
            this._lastInput = '';
            this._currentMagnetUri = '';
            this._currentInfoHash = '';
            this._parseCancelled = false;
            this._detectTimer = null;

            // 子模块：延迟创建，确保全局已就绪
            this._historyManager = null;
            this._magnetParser = null;
            this._historyDrawer = null;
            this._dom = null;
        }

        /**
         * 初始化页面
         */
        initialize() {
            this._cacheDom();
            if (!this._dom || !this._dom.input) {
                console.warn('[PlayUrlController] DOM 未就绪，跳过初始化');
                return;
            }
            this._initSubModules();
            this._setupInputEvents();
            this._setupActionButtons();
            this._setupDropZone();
            this._updateBadge('empty');
            this._updateSubmitState();
        }

        /**
         * 缓存 DOM 引用
         */
        _cacheDom() {
            this._dom = {
                page: document.getElementById('play-url-page'),
                input: document.getElementById('play-url-input'),
                badge: document.getElementById('play-url-badge'),
                submit: document.getElementById('play-url-submit'),
                clearBtn: document.getElementById('play-url-clear-btn'),
                pickFileBtn: document.getElementById('play-url-pick-file'),
                toggleHistoryBtn: document.getElementById('play-url-toggle-history'),
                progress: document.getElementById('play-url-progress'),
                progressStatus: document.getElementById('play-url-progress-status'),
                progressFill: document.getElementById('play-url-progress-fill'),
                progressCancel: document.getElementById('play-url-progress-cancel'),
                files: document.getElementById('play-url-files'),
                historyDrawer: document.getElementById('play-url-history-drawer'),
                historyList: document.getElementById('play-url-history-list'),
                historyClear: document.getElementById('play-url-history-clear')
            };
        }

        /**
         * 初始化子模块
         */
        _initSubModules() {
            // 历史管理
            if (window.UrlHistoryManager) {
                try {
                    this._historyManager = new window.UrlHistoryManager();
                } catch (e) {
                    console.error('[PlayUrlController] 初始化 UrlHistoryManager 失败:', e);
                }
            }

            // 磁力链解析适配器
            if (window.MagnetParserAdapter) {
                this._magnetParser = new window.MagnetParserAdapter();
                // 订阅进度事件
                this._magnetParser.onProgress(data => this._handleMagnetProgress(data));
            }

            // 历史抽屉
            if (window.HistoryDrawer && this._dom.historyDrawer && this._historyManager) {
                this._historyDrawer = new window.HistoryDrawer({
                    container: this._dom.historyDrawer,
                    historyManager: this._historyManager,
                    inferType: item => this._historyManager.inferType(item),
                    onItemClick: item => this._handleHistoryItemClick(item)
                });
            }
        }

        /**
         * 设置输入框事件
         */
        _setupInputEvents() {
            const { input } = this._dom;
            if (!input) return;

            // 输入变化：防抖识别类型
            input.addEventListener('input', () => {
                this._lastInput = input.value;
                this._scheduleDetect();
            });

            // Ctrl+Enter 提交
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    this._handleSubmit();
                }
            });

            // 失焦时也立即识别一次（防抖场景下用户可能已停止输入）
            input.addEventListener('blur', () => {
                if (this._detectTimer) {
                    clearTimeout(this._detectTimer);
                    this._detectTimer = null;
                }
                this._detect();
            });

            // 拖拽文件时显示视觉反馈（具体处理在 _setupDropZone）
        }

        /**
         * 设置操作按钮事件
         */
        _setupActionButtons() {
            const { submit, clearBtn, pickFileBtn, toggleHistoryBtn, progressCancel, historyClear } = this._dom;

            if (submit) {
                submit.addEventListener('click', () => this._handleSubmit());
            }

            if (clearBtn) {
                clearBtn.addEventListener('click', () => this._handleClear());
            }

            if (pickFileBtn) {
                pickFileBtn.addEventListener('click', () => this._handlePickFile());
            }

            if (toggleHistoryBtn) {
                toggleHistoryBtn.addEventListener('click', () => this._toggleHistory());
            }

            if (progressCancel) {
                progressCancel.addEventListener('click', () => this._handleParseCancel());
            }

            if (historyClear) {
                historyClear.addEventListener('click', () => this._handleClearHistory());
            }
        }

        /**
         * 设置拖拽支持（拖入本地文件直接填入输入框）
         */
        _setupDropZone() {
            const { page, input } = this._dom;
            const dropZone = page || input;
            if (!dropZone) return;

            // Electron 中，拖入的 File 对象有 path 属性
            const isFileDrag = e => {
                if (!e.dataTransfer || !e.dataTransfer.types) return false;
                return Array.from(e.dataTransfer.types).includes('Files');
            };

            dropZone.addEventListener('dragover', e => {
                if (isFileDrag(e)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                }
            });

            dropZone.addEventListener('drop', e => {
                if (!isFileDrag(e)) return;
                e.preventDefault();
                const file = e.dataTransfer.files && e.dataTransfer.files[0];
                if (!file) return;
                // Electron 扩展：file.path 是绝对路径
                const filePath = file.path || file.name;
                if (input) {
                    input.value = filePath;
                    this._lastInput = filePath;
                    this._detect();
                }
            });
        }

        /**
         * 防抖触发识别
         */
        _scheduleDetect() {
            if (this._detectTimer) {
                clearTimeout(this._detectTimer);
            }
            this._detectTimer = setTimeout(() => {
                this._detectTimer = null;
                this._detect();
            }, 150);
        }

        /**
         * 识别当前输入并更新徽章与按钮状态
         */
        _detect() {
            const input = this._dom && this._dom.input;
            if (!input) return;
            const value = input.value;
            this._lastInput = value;

            if (!window.inputRecognizer) {
                this._updateBadge('unknown');
                this._updateSubmitState();
                return;
            }

            const result = window.inputRecognizer.detectInputType(value);
            let badgeKey = 'unknown';
            if (result.type === 'empty') {
                badgeKey = 'empty';
            } else if (result.type === 'url') {
                badgeKey = 'url';
            } else if (result.type === 'local') {
                badgeKey = 'local';
            } else if (result.type === 'magnet') {
                badgeKey = 'magnet';
            }

            this._updateBadge(badgeKey);
            this._setState(result.type === 'empty' || result.type === 'unknown' ? STATE.EDITING : STATE.RECOGNIZED);
            this._updateSubmitState();
        }

        /**
         * 更新徽章
         */
        _updateBadge(key) {
            const { badge } = this._dom;
            if (!badge) return;
            const config = BADGE_CONFIG[key] || BADGE_CONFIG.unknown;
            badge.textContent = config.text;
            // 移除所有 is-* class，再添加新的
            badge.className = 'play-url-badge ' + config.cls;
        }

        /**
         * 更新提交按钮可用状态
         */
        _updateSubmitState() {
            const { submit, input } = this._dom;
            if (!submit || !input) return;
            if (!window.inputRecognizer) {
                submit.disabled = true;
                return;
            }
            const result = window.inputRecognizer.detectInputType(input.value);
            const enabled = result.type === 'url' || result.type === 'local' || result.type === 'magnet';
            submit.disabled = !enabled;
        }

        /**
         * 设置状态（带 UI 反馈）
         */
        _setState(newState) {
            this.state = newState;
        }

        /**
         * 处理提交（点立即播放）
         */
        _handleSubmit() {
            if (!window.inputRecognizer) return;
            if (this._dom && this._dom.submit && this._dom.submit.disabled) return;

            const result = window.inputRecognizer.detectInputType(this._lastInput);
            if (result.type === 'empty' || result.type === 'unknown') {
                this._notify('请输入有效的视频链接、磁力链或本地路径', 'warning');
                return;
            }

            if (result.type === 'magnet') {
                const magnetUri = result.magnetUri || ('magnet:?xt=urn:btih:' + result.hash);
                this._handleMagnet(magnetUri, result.hash || '');
            } else if (result.type === 'url') {
                this._handleNetworkUrl(result.url || this._lastInput);
            } else if (result.type === 'local') {
                this._handleLocalFile(result.path || this._lastInput);
            }
        }

        /**
         * 处理清空
         */
        _handleClear() {
            const { input, files } = this._dom;
            if (input) {
                input.value = '';
                this._lastInput = '';
            }
            if (files) {
                files.innerHTML = '';
            }
            this._hideProgress();
            this._updateBadge('empty');
            this._setState(STATE.IDLE);
            this._updateSubmitState();
        }

        /**
         * 处理选择本地文件
         */
        async _handlePickFile() {
            if (!window.electron || !window.electron.ipcRenderer) {
                this._notify('Electron 环境不可用', 'error');
                return;
            }
            try {
                const result = await window.electron.ipcRenderer.invoke('select-video-file');
                if (!result || !result.success) {
                    return; // 用户取消
                }
                const filePath = result.filePath;
                if (this._dom.input) {
                    this._dom.input.value = filePath;
                    this._lastInput = filePath;
                }
                this._detect();
                // 自动播放
                await this._handleLocalFile(filePath);
            } catch (error) {
                console.error('[PlayUrlController] 选择文件失败:', error);
                this._notify(`选择文件失败: ${error.message}`, 'error');
            }
        }

        /**
         * 切换历史抽屉
         */
        _toggleHistory() {
            if (!this._historyDrawer) {
                this._notify('历史功能暂不可用', 'warning');
                return;
            }
            this._historyDrawer.toggle();
        }

        /**
         * 处理清空历史
         */
        _handleClearHistory() {
            if (!this._historyManager) return;
            if (!confirm('确定要清空所有播放历史吗？')) return;
            const list = this._historyManager.getList() || [];
            // 逐条删除（保留 addPlayHistory 的 try-catch 容错）
            list.forEach(item => {
                if (item && item.vod_id) {
                    this._historyManager.removeItem(item.vod_id);
                }
            });
            if (this._historyDrawer) {
                this._historyDrawer.render();
            }
            this._notify('播放历史已清空', 'success');
        }

        /**
         * 处理网络 URL
         * @param {string} url
         */
        async _handleNetworkUrl(url) {
            if (!url) return;
            this._setState(STATE.PLAYING);
            this._addHistory(url, '外链', 'url');
            const fileName = this._extractFileName(url) || '网络视频';
            const videoData = {
                url,
                title: fileName,
                vod_name: fileName,
                episode_name: '正片',
                isDirectPlay: true,
                playSource: 'network'
            };
            await this._openPlayer(videoData);
            this._notify('正在加载视频...', 'info');
        }

        /**
         * 处理本地文件
         * @param {string} filePath
         */
        async _handleLocalFile(filePath) {
            if (!filePath) return;
            this._setState(STATE.PLAYING);
            this._addHistory(filePath, '本地', 'local');
            const fileName = this._extractFileName(filePath) || '本地视频';
            const videoData = {
                url: `file://${filePath}`,
                title: fileName,
                vod_name: fileName,
                episode_name: '正片',
                isDirectPlay: true,
                playSource: 'local',
                localPath: filePath
            };
            await this._openPlayer(videoData);
            this._notify('正在加载本地视频...', 'info');
        }

        /**
         * 处理磁力链
         * @param {string} magnetUri
         * @param {string} infoHash
         */
        async _handleMagnet(magnetUri, infoHash) {
            if (!this._magnetParser || !this._magnetParser.isAvailable()) {
                this._notify('磁力链功能不可用（Electron IPC 缺失）', 'error');
                return;
            }
            this._currentMagnetUri = magnetUri;
            this._currentInfoHash = infoHash || '';
            this._parseCancelled = false;
            this._setState(STATE.PARSE_PROGRESS);
            this._showProgress('正在解析磁力链接...', 0, 'info');
            this._addHistory(magnetUri, '磁力', 'magnet');

            try {
                const result = await this._magnetParser.parse(magnetUri);
                if (this._parseCancelled) {
                    return;
                }
                if (result && result.success) {
                    this._currentInfoHash = result.infoHash || this._currentInfoHash;
                    this._hideProgress();
                    this._renderFilesList(result.files || [], magnetUri);
                    this._setState(STATE.FILES_READY);
                } else {
                    throw new Error((result && result.error) || '磁力链解析失败');
                }
            } catch (error) {
                if (this._parseCancelled) {
                    return;
                }
                console.error('[PlayUrlController] 磁力链解析失败:', error);
                this._showProgress(`解析失败: ${error.message}`, 0, 'error');
                this._setState(STATE.EDITING);
                this._notify(`磁力链解析失败: ${error.message}`, 'error');
            }
        }

        /**
         * 处理磁力链进度事件（来自主进程）
         * @param {{ status: string, progress: number, source?: string }} data
         */
        _handleMagnetProgress(data) {
            if (!data) return;
            // 只在 PARSE_PROGRESS 或 PLAYING 状态下更新
            if (this.state !== STATE.PARSE_PROGRESS && this.state !== STATE.PLAYING) {
                return;
            }
            const status = data.status || (data.progress >= 100 ? '完成' : '处理中...');
            // 主进程日志转发的 progress 通常是 0（不确定进度），下载阶段是 0-100
            const pct = typeof data.progress === 'number' ? data.progress : 0;
            this._showProgress(status, pct, 'info');
        }

        /**
         * 取消正在进行的解析
         */
        _handleParseCancel() {
            this._parseCancelled = true;
            this._hideProgress();
            this._setState(STATE.EDITING);
            this._notify('已取消磁力链解析', 'info');
        }

        /**
         * 渲染磁力链文件列表
         * @param {Array} files
         * @param {string} magnetUri
         */
        _renderFilesList(files, magnetUri) {
            const { files: container } = this._dom;
            if (!container) return;
            if (!window.fileListRenderer) {
                container.innerHTML = '<div class="play-url-empty"><p>文件列表渲染器不可用</p></div>';
                return;
            }
            window.fileListRenderer.renderFileList(container, files, (file, index) => {
                this._playMagnetFile(magnetUri, file);
            });
        }

        /**
         * 播放磁力链指定文件
         * @param {string} magnetUri
         * @param {{ name: string, length: number, [k: string]: any }} file
         */
        async _playMagnetFile(magnetUri, file) {
            if (!this._magnetParser || !file) return;
            this._setState(STATE.PLAYING);
            this._showProgress(`正在准备: ${file.name}`, 0, 'info');
            try {
                const result = await this._magnetParser.play(magnetUri, file.name, this._currentInfoHash);
                if (this._parseCancelled) {
                    return;
                }
                if (result && result.success) {
                    const videoData = {
                        url: result.streamUrl,
                        title: file.name,
                        vod_name: file.name,
                        episode_name: '正片',
                        isDirectPlay: true,
                        playSource: 'magnet',
                        isStreaming: !result.isLocal,
                        isLocal: !!result.isLocal
                    };
                    await this._openPlayer(videoData);
                    this._hideProgress();
                } else {
                    throw new Error((result && result.error) || '播放失败');
                }
            } catch (error) {
                console.error('[PlayUrlController] 播放磁力文件失败:', error);
                this._showProgress(`播放失败: ${error.message}`, 0, 'error');
                this._notify(`播放失败: ${error.message}`, 'error');
            }
        }

        /**
         * 打开播放器
         * @param {object} videoData
         */
        async _openPlayer(videoData) {
            if (!window.electron || !window.electron.ipcRenderer) {
                this._notify('Electron 环境不可用', 'error');
                return;
            }
            try {
                const result = await window.electron.ipcRenderer.invoke('open-player', videoData);
                if (!result || !result.success) {
                    throw new Error((result && result.message) || '打开播放器失败');
                }
            } catch (error) {
                console.error('[PlayUrlController] 打开播放器失败:', error);
                this._notify(`打开播放器失败: ${error.message}`, 'error');
                throw error;
            }
        }

        /**
         * 处理历史项点击
         * @param {{ vod_id: string, vod_name: string, type_name?: string }} item
         */
        async _handleHistoryItemClick(item) {
            if (!item || !item.vod_id) return;
            const vodId = item.vod_id;
            // 折叠抽屉
            if (this._historyDrawer) {
                this._historyDrawer.close();
            }
            // 填入输入框
            if (this._dom.input) {
                this._dom.input.value = vodId;
                this._lastInput = vodId;
            }
            this._detect();
            // 自动播放
            if (!this._historyManager) {
                this._notify('历史管理不可用', 'error');
                return;
            }
            const type = this._historyManager.inferType(item);
            if (type === 'magnet') {
                await this._handleMagnet(vodId);
            } else if (type === 'local') {
                const localPath = vodId.startsWith('file://') ? vodId.replace(/^file:\/\/\//, '') : vodId;
                await this._handleLocalFile(localPath);
            } else if (type === 'url') {
                await this._handleNetworkUrl(vodId);
            } else {
                // 未知类型，尝试作为 URL
                await this._handleNetworkUrl(vodId);
            }
        }

        /**
         * 添加历史
         * @param {string} vodId
         * @param {string} typeName
         * @param {'magnet'|'local'|'url'} internalType
         */
        _addHistory(vodId, typeName, internalType) {
            if (!this._historyManager) return;
            this._historyManager.addItem({
                vod_id: vodId,
                vod_name: this._extractDisplayName(vodId, internalType),
                type_name: typeName
            });
            if (this._historyDrawer && this._historyDrawer.isOpen()) {
                this._historyDrawer.render();
            }
        }

        /**
         * 提取显示名称
         */
        _extractDisplayName(input, type) {
            if (type === 'magnet') {
                // 尝试从 dn 参数提取，否则用 hash 前 8 位
                const dnMatch = input.match(/[?&]dn=([^&]*)/i);
                if (dnMatch && dnMatch[1]) {
                    try {
                        return decodeURIComponent(dnMatch[1]);
                    } catch (e) {
                        return dnMatch[1];
                    }
                }
                const hashMatch = input.match(/btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})/i);
                if (hashMatch && hashMatch[1]) {
                    return `磁力资源 ${hashMatch[1].substring(0, 8)}`;
                }
                return '磁力链接';
            }
            return this._extractFileName(input) || input;
        }

        /**
         * 提取文件名
         */
        _extractFileName(urlOrPath) {
            try {
                const cleaned = String(urlOrPath).split('?')[0].split('#')[0];
                const parts = cleaned.split(/[\\/]/);
                return parts[parts.length - 1] || '';
            } catch (e) {
                return '';
            }
        }

        /**
         * 显示进度条
         * @param {string} status
         * @param {number} pct
         * @param {'info'|'warning'|'error'} variant
         */
        _showProgress(status, pct, variant) {
            const { progress, progressStatus, progressFill } = this._dom;
            if (!progress || !progressStatus || !progressFill) return;
            progressStatus.textContent = status || '处理中...';
            const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
            progressFill.style.width = clamped + '%';
            progress.style.display = 'block';
            progress.className = 'play-url-progress' + (variant && variant !== 'info' ? ' is-' + variant : '');
        }

        /**
         * 隐藏进度条
         */
        _hideProgress() {
            const { progress } = this._dom;
            if (progress) {
                progress.style.display = 'none';
            }
        }

        /**
         * 显示通知（统一封装）
         */
        _notify(message, type) {
            if (this.componentService && typeof this.componentService.showNotification === 'function') {
                this.componentService.showNotification(message, type || 'info');
            } else {
                console.log('[PlayUrlController]', type || 'info', message);
            }
        }
    }

    // 暴露到 window（兼容浏览器脚本加载）
    if (typeof window !== 'undefined') {
        window.PlayUrlController = PlayUrlController;
    }
    // CommonJS 兼容（Jest 测试）
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { PlayUrlController, STATE, BADGE_CONFIG };
    }
})();
