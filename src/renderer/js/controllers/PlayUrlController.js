/**
 * PlayUrlController
 * 外链页面主控制器：协调 4 个子模块，实现状态机驱动的智能识别播放流程
 *
 * 依赖模块（通过 window 全局访问）：
 * - inputRecognizer.detectInputType 智能识别输入类型
 * - UrlHistoryManager 播放历史管理（包装 storage.js，写入统一 play_history）
 * - fileListRenderer 磁力链文件列表渲染
 * - MagnetParserAdapter 磁力链 IPC 适配器
 *
 * 历史查看请进入"历史"页（#history-page），本页面不再维护独立抽屉
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
                progress: document.getElementById('play-url-progress'),
                progressStatus: document.getElementById('play-url-progress-status'),
                progressFill: document.getElementById('play-url-progress-fill'),
                progressCancel: document.getElementById('play-url-progress-cancel'),
                files: document.getElementById('play-url-files')
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
            const { submit, clearBtn, pickFileBtn, progressCancel } = this._dom;

            if (submit) {
                submit.addEventListener('click', () => this._handleSubmit());
            }

            if (clearBtn) {
                clearBtn.addEventListener('click', () => this._handleClear());
            }

            if (pickFileBtn) {
                pickFileBtn.addEventListener('click', () => this._handlePickFile());
            }

            if (progressCancel) {
                progressCancel.addEventListener('click', () => this._handleParseCancel());
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
         * 处理网络 URL
         * @param {string} url
         */
        async _handleNetworkUrl(url) {
            if (!url) return;
            this._setState(STATE.PLAYING);
            const fileName = this._extractFileName(url) || '网络视频';
            // 写入历史：episode_name 用文件名
            this._addHistory(url, '外链', 'url', {
                vod_name: fileName,
                episode_name: fileName
            });
            const videoData = {
                url,
                title: fileName,
                vod_name: fileName,
                episode_name: fileName,
                isDirectPlay: true,
                playSource: 'network',
                type_name: '外链',
                siteName: '外链'
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
            const fileName = this._extractFileName(filePath) || '本地视频';
            this._addHistory(filePath, '本地', 'local', {
                vod_name: fileName,
                episode_name: fileName
            });
            const videoData = {
                url: `file://${filePath}`,
                title: fileName,
                vod_name: fileName,
                episode_name: fileName,
                isDirectPlay: true,
                playSource: 'local',
                localPath: filePath,
                type_name: '本地',
                siteName: '本地'
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
            // 注意：磁力历史在 _playMagnetFile 用户真正挑了文件后才写入（这里不写）
            // 避免"未观看"却产生历史条目（之前一直显示"正片"就是这个原因）

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
         * 6 阶段进度反馈:P1 准备 → P2 元数据/下载 → P3 流服务器 → P4 打开播放器 → P5 缓冲 → P6 播放就绪
         * P1-P4 由本函数驱动;P5/P6 来自主进程 player-loaded/player-canplay 事件;
         * 子进程 download-progress 通过 MagnetDownloadProgressMapper 映射后填充 P2 子阶段文本
         * @param {string} magnetUri
         * @param {{ name: string, length: number, size?: number, [k: string]: any }} file
         */
        async _playMagnetFile(magnetUri, file) {
            if (!this._magnetParser || !file) return;

            // 清理之前的订阅(防御性:防止重复订阅导致回调多次触发)
            this._magnetParser.removeDownloadProgressListener();
            if (window.electron && window.electron.removePlayerLoadedListener) {
                window.electron.removePlayerLoadedListener();
                window.electron.removePlayerCanplayListener();
            }

            this._setState(STATE.PLAYING);

            // 阶段 P1: 准备播放资源
            this._showProgress('① 准备播放: ' + file.name, 5, 'info');

            try {
                // 写入历史:用户真正挑了文件后,episode_name = 文件名(避免显示"正片")
                this._addHistory(magnetUri, '磁力', 'magnet', {
                    vod_name: file.name,
                    episode_name: file.name
                });

                // 阶段 P2: 解析磁力元数据(订阅 download-progress 后,子进程会持续发进度)
                this._showProgress('② 解析磁力元数据...', 10, 'info');
                if (window.electron && window.electron.onPlayerLoaded) {
                    window.electron.onPlayerLoaded(() => this._handlePlayerLoaded());
                }
                if (window.electron && window.electron.onPlayerCanplay) {
                    window.electron.onPlayerCanplay(() => this._handlePlayerCanplay());
                }
                this._magnetParser.onDownloadProgress((data) => this._handleMagnetDownloadProgress(data));

                const playResult = await this._magnetParser.play(
                    magnetUri,
                    file.name,
                    this._currentInfoHash
                );

                if (this._parseCancelled) {
                    return;
                }
                if (!playResult || !playResult.streamUrl) {
                    throw new Error('播放准备失败:未获取到流地址');
                }

                // 阶段 P3: 启动流服务器(play 已 resolve,streamUrl 拿到)
                this._showProgress('③ 启动流服务器...', 30, 'info');

                const videoData = {
                    url: playResult.streamUrl,
                    type: 'magnet',
                    title: file.name,
                    vod_name: file.name,
                    episode_name: file.name,
                    isDirectPlay: true,
                    playSource: 'magnet',
                    isStreaming: !playResult.isLocal,
                    isLocal: !!playResult.isLocal,
                    type_name: '磁力',
                    siteName: '磁力',
                    magnetUri: magnetUri,
                    infoHash: this._currentInfoHash,
                    fileName: file.name,
                    fileSize: file.length || file.size || 0
                };

                // 阶段 P4: 打开播放器(进入后,主进程会发 player-loaded → 阶段 P5;视频 canplay → 阶段 P6)
                // 关键:不立即 _hideProgress,等 player-canplay 事件
                this._showProgress('④ 打开播放器窗口...', 40, 'info');
                await this._openPlayer(videoData);
            } catch (err) {
                console.error('[PlayUrlController] 播放磁力文件失败:', err);
                this._showProgress('✗ 播放失败: ' + ((err && err.message) || err), 0, 'error');
                this._magnetParser.removeDownloadProgressListener();
                if (window.electron && window.electron.removePlayerLoadedListener) {
                    window.electron.removePlayerLoadedListener();
                    window.electron.removePlayerCanplayListener();
                }
                this._notify('播放失败: ' + ((err && err.message) || err), 'error');
                throw err;
            }
        }

        /**
         * 处理磁力子进程 download-progress 事件
         * 把子进程 payload 映射到阶段对象并显示
         * @param {{ status?: string, progress?: number, numPeers?: number }} data
         */
        _handleMagnetDownloadProgress(data) {
            if (!data || !window.MagnetDownloadProgressMapper) return;
            const mapped = window.MagnetDownloadProgressMapper.mapMagnetDownloadProgress(data);
            this._showProgress(mapped.stageText, mapped.progress, mapped.variant);
        }

        /**
         * 处理主进程 player-loaded 事件
         * 进入 P5 视频缓冲中阶段
         */
        _handlePlayerLoaded() {
            this._showProgress('⑤ 视频缓冲中...', 50, 'info');
        }

        /**
         * 处理主进程 player-canplay 事件
         * 关闭进度条,允许 200ms 渐隐动画
         */
        _handlePlayerCanplay() {
            // 解绑订阅,避免内存泄露
            this._magnetParser.removeDownloadProgressListener();
            if (window.electron && window.electron.removePlayerLoadedListener) {
                window.electron.removePlayerLoadedListener();
                window.electron.removePlayerCanplayListener();
            }
            this._hideProgress();
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
         * 添加历史（外链播放后写入统一 play_history，历史页可继续查看/再播）
         * @param {string} vodId
         * @param {string} typeName
         * @param {'magnet'|'local'|'url'} internalType
         */
        _addHistory(vodId, typeName, internalType, overrides = {}) {
            if (!this._historyManager) return;
            this._historyManager.addItem({
                vod_id: vodId,
                vod_name: this._extractDisplayName(vodId, internalType),
                type_name: typeName,
                // 允许覆盖 episode_name / vod_name（如磁力用户挑的具体文件名）
                ...(overrides || {})
            });
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
         * @param {string} text 状态文本
         * @param {number} percent 进度百分比(0-100)
         * @param {'info'|'warning'|'success'|'error'} variant 变体类型,影响颜色
         */
        _showProgress(text, percent, variant) {
            const { progress, progressStatus, progressFill } = this._dom;
            if (!progress) return;
            // 清理旧变体,再根据入参添加新变体(info 不加)
            progress.classList.remove('is-warning', 'is-success', 'is-error');
            if (variant && variant !== 'info') {
                progress.classList.add('is-' + variant);
            }
            progress.style.display = 'block';
            if (progressFill) {
                const safePct = isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
                progressFill.style.width = safePct + '%';
            }
            if (progressStatus) {
                progressStatus.textContent = text || '';
            }
            // 二级阶段文本:写入独立 .progress-stage 元素,如不存在则动态创建
            let stageEl = progress.querySelector('.progress-stage');
            if (!stageEl) {
                stageEl = document.createElement('div');
                stageEl.className = 'progress-stage';
                if (progressFill) {
                    progress.insertBefore(stageEl, progressFill);
                } else {
                    progress.appendChild(stageEl);
                }
            }
            stageEl.textContent = text || '';
        }

        /**
         * 隐藏进度条
         */
        _hideProgress() {
            const { progress } = this._dom;
            if (progress) {
                const stageEl = progress.querySelector('.progress-stage');
                if (stageEl) stageEl.textContent = '';
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

        /**
         * 从历史页"复播"入口：填入 vod_id 后自动提交
         * @param {string} vodId
         */
        async playExternalFromHistory(vodId) {
            if (!vodId) return;
            if (!this._dom) {
                this.initialize();
            }
            if (!this._dom || !this._dom.input) {
                this._notify('外链页未就绪', 'warning');
                return;
            }
            // 清掉旧文件列表/进度，避免视觉残留
            if (this._dom.files) {
                this._dom.files.innerHTML = '';
            }
            this._hideProgress();
            this._dom.input.value = vodId;
            this._lastInput = vodId;
            this._detect();
            await this._handleSubmit();
        }

        /**
         * 从磁力历史"续播"：跳过 parse，直接调 play() 走主进程本地缓存
         * - 需要 vod_id (magnet URI / hash) + fileName (历史里存的 vod_name)
         * - 主进程 play() 命中缓存则毫秒级返 streamUrl；缓存失效会触发 re-resolve
         *   （re-resolve 是服务端一次网络解析，渲染端无需拉文件列表）
         * - 失败时（文件已被移除、hash 错等）返回 false，调用方应回退到 playExternalFromHistory
         * @param {string} magnetUri
         * @param {string} fileName
         * @returns {Promise<boolean>} 是否成功打开播放器
         */
        async resumeMagnetFromHistory(magnetUri, fileName) {
            if (!magnetUri || !fileName) return false;
            if (!this._magnetParser || !this._magnetParser.isAvailable()) {
                this._notify('磁力链功能不可用（Electron IPC 缺失）', 'error');
                return false;
            }
            if (!this._dom) {
                this.initialize();
            }
            // 清掉旧文件列表/进度，避免视觉残留
            if (this._dom && this._dom.files) {
                this._dom.files.innerHTML = '';
            }
            this._parseCancelled = false;
            this._currentMagnetUri = magnetUri;
            this._currentInfoHash = this._extractInfoHash(magnetUri);
            this._setState(STATE.PLAYING);
            this._showProgress(`正在恢复: ${fileName}`, 0, 'info');
            try {
                const result = await this._magnetParser.play(magnetUri, fileName, this._currentInfoHash);
                if (this._parseCancelled) {
                    return false;
                }
                if (result && result.success) {
                    const videoData = {
                        url: result.streamUrl,
                        title: fileName,
                        vod_name: fileName,
                        episode_name: fileName,
                        isDirectPlay: true,
                        playSource: 'magnet',
                        isStreaming: !result.isLocal,
                        isLocal: !!result.isLocal,
                        type_name: '磁力',
                        siteName: '磁力'
                    };
                    await this._openPlayer(videoData);
                    this._hideProgress();
                    return true;
                }
                throw new Error((result && result.error) || '恢复失败');
            } catch (error) {
                console.error('[PlayUrlController] 恢复磁力文件失败:', error);
                this._showProgress(`恢复失败: ${error.message}`, 0, 'error');
                this._notify(`恢复失败: ${error.message}`, 'error');
                return false;
            }
        }

        /**
         * 从磁力 URI 提取 infoHash（v1 40 字符 hex / v2 32 字符 base32）
         * 用于传给主进程 play() 命中本地缓存
         * @param {string} magnetUri
         * @returns {string}
         */
        _extractInfoHash(magnetUri) {
            if (!magnetUri || typeof magnetUri !== 'string') return '';
            const m = magnetUri.match(/btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})/i);
            return m ? m[1] : '';
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
