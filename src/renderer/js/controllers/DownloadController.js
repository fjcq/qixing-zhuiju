// 下载管理控制器
// 职责：渲染下载文件列表，处理搜索/筛选/排序/重命名/删除/移动/播放等操作
// 状态机：IDLE -> LOADING -> READY，操作完成后回到 READY

(function() {
    'use strict';

    // 来源类型 → 显示文本 / 图标 / 颜色
    const SOURCE_META = {
        url:    { label: 'URL 下载', icon: '🔗', tag: 'dl-source-url' },
        magnet: { label: '磁力链',  icon: '🧲', tag: 'dl-source-magnet' },
        import: { label: '本地导入', icon: '📂', tag: 'dl-source-import' }
    };

    // 状态徽标：downloading / paused / completed / error
    const STATUS_META = {
        downloading: { label: '下载中', icon: '⏬', tag: 'dl-status-active' },
        paused:      { label: '已暂停', icon: '⏸', tag: 'dl-status-paused' },
        completed:   { label: '已完成', icon: '✓', tag: 'dl-status-done' },
        error:       { label: '失败',   icon: '✕', tag: 'dl-status-error' }
    };

    // 支持的视频扩展名（用于缩略图角标显示）
    const VIDEO_EXTS = new Set(['mp4', 'mkv', 'webm', 'avi', 'mov', 'm3u8', 'flv', 'wmv', 'ts', 'mpeg', 'mpg']);

    class DownloadController {
        constructor(app) {
            this.app = app;
            this.state = 'IDLE';
            // 当前内存中的文件列表
            this.files = [];
            // 搜索/筛选状态（去抖）
            this._searchTimer = null;
            this.initialized = false;
        }

        /**
         * 初始化：绑定事件、首次加载、监听主进程进度事件
         */
        initialize() {
            if (this.initialized) return;
            this.initialized = true;
            this._bindEvents();
            this._bindIpcListeners();
            // 首次加载（不阻塞 UI）
            this._setState('LOADING');
            this._loadFiles().finally(() => this._setState('READY'));
        }

        /**
         * 切换到该页时调用：刷新文件列表
         */
        onShow() {
            // 列表可能在后台有变化（其他窗口触发下载完成），这里也刷新一次
            this._loadFiles();
        }

        /**
         * 对外公开：按文件 id 播放（供历史页面等场景调用）
         * 关键：如果文件还没加载到内存（如从未进入过下载页），先主动加载一次
         * 因为 _playFile 内部查 this.files，找不到就提示"文件不存在"
         * @param {string} id
         * @returns {Promise<boolean>} 是否成功开始播放（不保证播放器真的开起来）
         */
        async playById(id) {
            if (!id) return false;
            if (!this.initialized) {
                // 懒初始化（避免从其他页面跳转过来时 controller 还没创建）
                this.initialize();
            }
            // 内存里没有 → 主动拉一次
            if (!this.files || !this.files.find(f => f.id === id)) {
                await this._loadFiles();
            }
            if (!this.files.find(f => f.id === id)) {
                this.app.componentService.showNotification('文件已不存在，请刷新下载页', 'error');
                return false;
            }
            await this._playFile(id);
            return true;
        }

        /**
         * 状态切换（单点切换）
         */
        _setState(next) {
            this.state = next;
        }

        /**
         * 转义 HTML
         */
        _escapeHtml(str) {
            if (str == null) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        /**
         * 格式化字节数（B/KB/MB/GB）
         */
        _formatSize(bytes) {
            if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            let i = 0;
            let n = bytes;
            while (n >= 1024 && i < units.length - 1) {
                n /= 1024;
                i++;
            }
            return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
        }

        /**
         * 格式化时间戳为本地化字符串
         */
        _formatTime(ts) {
            if (!ts) return '';
            const d = new Date(ts);
            const now = new Date();
            const isToday = d.toDateString() === now.toDateString();
            if (isToday) {
                return `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
            }
            return d.toLocaleString('zh-CN', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        }

        /**
         * 格式化预计剩余时间（秒 → 文本）
         * 遵循项目内"全 2 位对齐"规范：
         *   < 60s    → 00:ss
         *   < 60min  → mm:ss
         *   >= 60min → hh:mm:ss
         * 无效输入（null/NaN/非正数）返回 '--:--' 兜底
         */
        _formatEta(seconds) {
            if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
            const s = Math.floor(seconds);
            if (s < 60) {
                return `00:${s.toString().padStart(2, '0')}`;
            }
            if (s < 3600) {
                const m = Math.floor(s / 60);
                const ss = s % 60;
                return `${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
            }
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const ss = s % 60;
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
        }

        /**
         * 绑定 DOM 事件
         */
        _bindEvents() {
            const refreshBtn = document.getElementById('downloads-refresh-btn');
            const importBtn = document.getElementById('downloads-import-btn');
            const openFolderBtn = document.getElementById('downloads-open-folder-btn');
            const searchInput = document.getElementById('downloads-search-input');
            const sourceFilter = document.getElementById('downloads-source-filter');
            const sortBy = document.getElementById('downloads-sort-by');
            const sortDir = document.getElementById('downloads-sort-dir');

            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => {
                    this._setState('LOADING');
                    this._loadFiles().finally(() => this._setState('READY'));
                    this._loadActiveTasks();
                });
            }
            if (importBtn) {
                importBtn.addEventListener('click', () => this._importLocal());
            }
            if (openFolderBtn) {
                openFolderBtn.addEventListener('click', () => this._openDownloadFolder());
            }
            if (searchInput) {
                searchInput.addEventListener('input', () => {
                    // 去抖：200ms
                    clearTimeout(this._searchTimer);
                    this._searchTimer = setTimeout(() => this._loadFiles(), 200);
                });
            }
            if (sourceFilter) {
                sourceFilter.addEventListener('change', () => this._loadFiles());
            }
            if (sortBy) {
                sortBy.addEventListener('change', () => this._loadFiles());
            }
            if (sortDir) {
                sortDir.addEventListener('change', () => this._loadFiles());
            }
        }

        /**
         * 绑定主进程 IPC 事件
         */
        _bindIpcListeners() {
            if (!window.electron || !window.electron.ipcRenderer) return;
            const self = this;
            // 订阅磁力链状态变化：实时同步到下载页列表
            // （子进程会通过 magnet-status 事件持续推送 speed/eta/peer 等实时指标，
            //   _handleMagnetStatus 负责把更新合并到对应的 file item）
            window.electron.ipcRenderer.on('magnet-status', (data) => {
                if (!data) return;
                self._handleMagnetStatus(data);
            });
            // 订阅全局磁力进度条取消事件（X 按钮由 app.js 在 document.body 上委托触发）
            // 收到事件时：清理自己的订阅 + 隐藏进度条
            // 这里存到 this._onMagnetProgressCancel 以便后续可 removeEventListener
            if (!this._onMagnetProgressCancel) {
                this._onMagnetProgressCancel = () => {
                    self._unbindMagnetProgress();
                    self._unbindPlayerListeners();
                    self._hideMagnetProgress();
                };
                document.addEventListener('magnet-progress-cancel', this._onMagnetProgressCancel);
            }
        }

        /**
         * 扫描旧磁力缓存（用于头部"迁移"按钮）
         */
        async scanLegacyMagnet() {
            try {
                const r = await window.electron.ipcRenderer.invoke('magnet-cache-scan');
                if (!r || r.scanned === 0) {
                    this.app.componentService.showNotification('未发现旧磁力缓存', 'info');
                    return null;
                }
                if (r.errors && r.errors.length) {
                    console.warn('[DL] 扫描旧缓存时出现错误:', r.errors);
                }
                return r;
            } catch (e) {
                this.app.componentService.showNotification('扫描旧缓存失败: ' + e.message, 'error');
                return null;
            }
        }

        /**
         * 迁移旧磁力缓存
         * @param {object} options
         * @param {boolean} [options.removeOld=false] - 是否删除旧文件
         */
        async migrateLegacyMagnet(options = {}) {
            const scan = await this.scanLegacyMagnet();
            if (!scan) return;
            const totalFiles = scan.items.reduce((sum, it) => sum + it.files.length, 0);
            const totalSize = scan.items.reduce((sum, it) => sum + (it.totalLength || 0), 0);
            const sizeText = this._formatSize(totalSize);
            const confirmMsg = `发现 ${scan.items.length} 个磁力项，共 ${totalFiles} 个文件 (${sizeText})，迁移到下载目录？\n` +
                `完成后可立即在「下载」页管理（播放/暂停/继续/删除）。\n\n` +
                `是否同时删除原临时目录的旧文件？\n（建议先迁移，确认无误后手动清理）`;
            const removeOld = window.confirm(confirmMsg + '\n\n点击"确定"=复制+删除旧文件；点击"取消"=仅复制不删除（之后再次询问）');
            const removeOldFinal = removeOld ? window.confirm('再次确认：是否删除原临时目录中的旧文件？\n（取消 = 只复制不删）') : false;
            if (removeOld && !removeOldFinal) {
                // 用户第一次确认要删，第二次又取消 → 不删
            }
            this.app.componentService.showNotification('开始迁移，请稍候...', 'info');
            try {
                const res = await window.electron.ipcRenderer.invoke('magnet-cache-migrate', {
                    removeOld: removeOld && removeOldFinal
                });
                if (res && res.success) {
                    const r = res.report;
                    const msg = `迁移完成：${r.migrated} 个磁力项成功，${r.skipped} 个跳过，${r.errors.length} 个错误`;
                    this.app.componentService.showNotification(msg, r.errors.length > 0 ? 'warning' : 'success');
                    await this._loadFiles();
                } else {
                    this.app.componentService.showNotification('迁移失败: ' + (res?.error || '未知错误'), 'error');
                }
            } catch (e) {
                this.app.componentService.showNotification('迁移异常: ' + e.message, 'error');
            }
        }

        /**
         * 处理磁力链状态变化（更新内存 + 增量渲染）
         * 现在也承载"实时下载速度/ETA/peer 数"等增量信息（主进程从子进程的 progress 事件合并过来）
         */
        _handleMagnetStatus(data) {
            // 在内存列表中找到对应记录（按 infoHash + name 匹配）
            const idx = this.files.findIndex(f =>
                f.sourceType === 'magnet' && f.infoHash === data.infoHash &&
                (!data.fileName || f.name === data.fileName)
            );
            if (data.status === 'removed') {
                if (idx !== -1) {
                    this.files.splice(idx, 1);
                    this._renderFiles();
                }
                return;
            }
            if (idx === -1) {
                // 主进程已 addMagnetFile 创建了记录；下一轮 _loadFiles() 会拉到
                // 立即刷新一次以展示新记录
                this._loadFiles();
                return;
            }
            const item = this.files[idx];
            if (Number.isFinite(data.downloaded)) item.size = data.downloaded;
            if (Number.isFinite(data.total) && data.total > 0) item.totalSize = data.total;
            // status 直接信任主进程透传过来的值（用户可控的 paused/downloading/completed），
            // 不要被 progress 事件里的 peer-state（no-peers/connected-waiting）覆盖
            if (data.status) item.status = data.status;
            // 实时下载指标（仅在传入时更新，避免无意义刷写）
            if (Number.isFinite(data.downloadSpeed)) item.downloadSpeed = data.downloadSpeed;
            if (Number.isFinite(data.numPeers)) item.numPeers = data.numPeers;
            if (Number.isFinite(data.wires)) item.wires = data.wires;
            if (data.eta != null) item.eta = data.eta; // 允许 null
            item.mtime = Date.now();
            this._renderFiles();
        }

        /**
         * 收集当前筛选条件
         */
        _collectOptions() {
            const searchInput = document.getElementById('downloads-search-input');
            const sourceFilter = document.getElementById('downloads-source-filter');
            const sortBy = document.getElementById('downloads-sort-by');
            const sortDir = document.getElementById('downloads-sort-dir');
            return {
                search: searchInput ? searchInput.value : '',
                sourceType: sourceFilter ? sourceFilter.value : '',
                sortBy: sortBy ? sortBy.value : 'mtime',
                sortDir: sortDir ? sortDir.value : 'desc'
            };
        }

        /**
         * 加载文件列表
         */
        async _loadFiles() {
            const loading = document.getElementById('downloads-loading');
            const list = document.getElementById('downloads-list');
            const empty = document.getElementById('downloads-empty');
            if (loading) loading.classList.remove('hidden');

            try {
                const opts = this._collectOptions();
                const res = await window.electron.ipcRenderer.invoke('download-list', opts);
                if (res && res.success) {
                    this.files = res.list || [];
                    this.rootDir = res.rootDir || '';
                    this._renderFiles();
                } else {
                    this.files = [];
                    this._renderFiles();
                    if (res && res.error) {
                        this.app.componentService.showNotification(`加载下载列表失败: ${res.error}`, 'error');
                    }
                }
            } catch (error) {
                console.error('[DOWNLOAD-CTRL] 加载列表异常:', error);
                this.files = [];
                this._renderFiles();
                this.app.componentService.showNotification('加载下载列表异常', 'error');
            } finally {
                if (loading) loading.classList.add('hidden');
                if (empty) {
                    if (this.files.length === 0) {
                        empty.classList.remove('hidden');
                    } else {
                        empty.classList.add('hidden');
                    }
                }
            }
        }

        /**
         * 渲染文件列表
         * 所有下载内容统一在主列表展示，包括进行中的磁力下载（边下边播可见）——
         * 不再有独立的"正在下载"活动任务区，避免同文件两处展示造成困惑
         */
        _renderFiles() {
            const list = document.getElementById('downloads-list');
            const empty = document.getElementById('downloads-empty');
            if (!list) return;
            if (!this.files || this.files.length === 0) {
                list.innerHTML = '';
                if (empty) empty.classList.remove('hidden');
                return;
            }
            if (empty) empty.classList.add('hidden');

            // 一次性拼接 HTML（性能：避免逐条 appendChild）
            const html = this.files.map(f => this._renderFileItem(f)).join('');
            list.innerHTML = html;

            // 绑定每条的操作按钮事件
            list.querySelectorAll('.downloads-item').forEach(el => {
                const id = el.dataset.id;
                el.querySelector('.dl-btn-play')?.addEventListener('click', () => this._playFile(id));
                el.querySelector('.dl-btn-rename')?.addEventListener('click', () => this._renameFile(id));
                el.querySelector('.dl-btn-move')?.addEventListener('click', () => this._moveFile(id));
                el.querySelector('.dl-btn-reveal')?.addEventListener('click', () => this._revealFile(id));
                el.querySelector('.dl-btn-delete')?.addEventListener('click', () => this._deleteFile(id));
                el.querySelector('.dl-btn-pause')?.addEventListener('click', () => this._pauseMagnet(id));
                el.querySelector('.dl-btn-resume')?.addEventListener('click', () => this._resumeMagnet(id));
                el.querySelector('.dl-btn-retry')?.addEventListener('click', () => this._retryMagnet(id));
            });
        }

        /**
         * 渲染单个文件项 HTML
         */
        _renderFileItem(f) {
            const meta = SOURCE_META[f.sourceType] || SOURCE_META.import;
            const status = f.status || 'completed';
            const statusMeta = STATUS_META[status] || STATUS_META.completed;
            const ext = (f.ext || '').toLowerCase();
            const isVideo = VIDEO_EXTS.has(ext);
            // 进度：磁力/未完成记录才计算
            const total = Number(f.totalSize || 0);
            const downloaded = Number(f.size || 0);
            const showProgress = (status === 'downloading' || status === 'paused') && total > 0;
            const progress = showProgress ? Math.max(0, Math.min(100, (downloaded / total) * 100)) : 0;
            const sizeText = this._formatSize(downloaded) + (total > 0 ? ` / ${this._formatSize(total)}` : '');
            const timeText = this._formatTime(f.addedAt || f.mtime);
            // 实时下载指标：仅 downloading 状态有意义（paused 速度为 0，completed 不显示）
            const isActive = status === 'downloading';
            const speedBps = Number(f.downloadSpeed || 0);
            const peers = Number(f.numPeers || 0);
            const etaSec = f.eta;
            // 速度文本（bytes/sec → 自适应单位）
            const speedText = isActive ? `↓ ${this._formatSize(speedBps)}/s` : '';
            // 预计剩余时间（复用 utils.js 的 formatEta 风格：< 60s → 00:ss，< 60min → mm:ss，>= 60min → hh:mm:ss）
            const etaText = isActive && Number.isFinite(etaSec) && etaSec > 0 ? `剩余 ${this._formatEta(etaSec)}` : '';
            // peer 数文本
            const peersText = isActive && peers > 0 ? `${peers} 节点` : '';
            // 用 · 分隔的实时指标区
            const liveInfo = isActive && (speedText || etaText || peersText)
                ? `<span class="dl-live-info">${[speedText, etaText, peersText].filter(Boolean).join(' · ')}</span>`
                : '';
            // 来源 URL 仅作为 tooltip 展示（避免过长）
            const sourceTooltip = f.sourceUrl ? ` title="${this._escapeHtml(f.sourceUrl)}"` : '';
            const safeName = this._escapeHtml(f.name);
            const safeExt = this._escapeHtml(ext.toUpperCase());
            const safeSize = this._escapeHtml(sizeText);
            const safeTime = this._escapeHtml(timeText);
            const safeSource = this._escapeHtml(meta.label);
            const safeStatus = this._escapeHtml(statusMeta.label);

            // 缩略图：当前用类型图标占位（视频用胶片图标），未来可扩展读取同目录同名 jpg
            const thumb = isVideo
                ? `<div class="dl-thumb dl-thumb-video">🎬</div>`
                : `<div class="dl-thumb dl-thumb-file">📄</div>`;

            // 进度条：仅未完成时渲染
            const progressBar = showProgress
                ? `<div class="dl-progress-row">
                        <div class="dl-progress">
                            <div class="dl-progress-bar ${status === 'paused' ? 'dl-progress-paused' : ''}" style="width: ${progress.toFixed(1)}%"></div>
                        </div>
                        <span class="dl-progress-text">${progress.toFixed(1)}%</span>
                    </div>`
                : '';

            // 操作按钮：按 sourceType + status 决定
            const actions = this._renderActions(f, status);

            return `
                <div class="downloads-item dl-status-${status}" data-id="${this._escapeHtml(f.id)}" title="${safeName}">
                    ${thumb}
                    <div class="dl-info">
                        <div class="dl-name">${safeName}</div>
                        <div class="dl-meta-row">
                            <span class="dl-tag ${meta.tag}"${sourceTooltip}>${meta.icon} ${safeSource}</span>
                            <span class="dl-tag ${statusMeta.tag}">${statusMeta.icon} ${safeStatus}</span>
                            <span class="dl-tag dl-tag-ext">${safeExt || 'FILE'}</span>
                            <span class="dl-meta-size">${safeSize}</span>
                            ${liveInfo}
                            <span class="dl-meta-time">${safeTime}</span>
                        </div>
                        ${progressBar}
                    </div>
                    <div class="dl-actions">
                        ${actions}
                    </div>
                </div>
            `;
        }

        /**
         * 根据记录类型 + 状态渲染操作按钮组
         * - completed: 播放 / 重命名 / 移动 / 删除
         * - downloading (magnet): 播放(边下边播) / 暂停 / 在文件夹中显示 / 删除
         * - paused (magnet): 播放(边下边播) / 继续 / 在文件夹中显示 / 删除
         * - 其他错误态: 重新下载 / 删除
         */
        _renderActions(f, status) {
            const safeId = this._escapeHtml(f.id);
            // 通用：所有状态都有"在文件夹中显示"和"删除"
            const common = `
                <button class="dl-btn dl-btn-reveal" title="在文件夹中显示">📁</button>
                <button class="dl-btn dl-btn-delete" title="删除">🗑</button>
            `;
            // 视频文件才显示"播放"按钮：边下边播 / 完成播放
            // 非视频（图片/压缩包等）即使下完也不在该控件内播放
            const showPlay = (ext) => {
                const e = (ext || '').toLowerCase();
                return VIDEO_EXTS.has(e);
            };
            if (status === 'downloading') {
                const playBtn = showPlay(f.ext) ? `<button class="dl-btn dl-btn-play" title="边下边播">▶</button>` : '';
                if (f.sourceType === 'magnet') {
                    return `${playBtn}<button class="dl-btn dl-btn-pause" title="暂停下载">⏸</button>${common}`;
                }
                // URL 下载中：暂停（由 downloadManager 内部状态机控制）
                return `${playBtn}<button class="dl-btn dl-btn-pause" title="暂停下载">⏸</button>${common}`;
            }
            if (status === 'paused') {
                const playBtn = showPlay(f.ext) ? `<button class="dl-btn dl-btn-play" title="边下边播">▶</button>` : '';
                return `${playBtn}<button class="dl-btn dl-btn-resume" title="继续下载">▶</button>${common}`;
            }
            if (status === 'error') {
                return `<button class="dl-btn dl-btn-retry" title="重试下载">↻</button>${common}`;
            }
            // completed：完整操作
            return `
                <button class="dl-btn dl-btn-play" title="播放">▶</button>
                <button class="dl-btn dl-btn-rename" title="重命名">✎</button>
                <button class="dl-btn dl-btn-move" title="移动到子目录">↗</button>
                ${common}
            `;
        }

        /**
         * 暂停磁力下载（磁力来源专用）
         * 子进程没有该 torrent 时（多见于播放器关闭后子进程被销毁），
         * 直接把 manifest 状态切到 paused —— 此时下载其实已经停了
         */
        async _pauseMagnet(id) {
            const file = this.files.find(f => f.id === id);
            if (!file) return;
            if (file.sourceType !== 'magnet') {
                this.app.componentService.showNotification('该类型暂不支持暂停', 'error');
                return;
            }
            try {
                const res = await window.electron.ipcRenderer.invoke('magnet-pause', {
                    infoHash: file.infoHash || '',
                    fileName: file.name
                });
                if (res && res.type === 'paused') {
                    this.app.componentService.showNotification('已暂停下载', 'success');
                    // 状态更新由 magnet-status 事件回流，无需手动 _renderFiles
                    return;
                }
                if (res && res.code === 'TORRENT_NOT_FOUND') {
                    // 子进程已销毁 / 没有这个 torrent：下载其实已停，把 UI/manifest 切成 paused
                    await this._setMagnetFileStatus(id, 'paused');
                    this.app.componentService.showNotification('已暂停下载', 'success');
                    return;
                }
                this.app.componentService.showNotification(`暂停失败: ${res?.error || '未知错误'}`, 'error');
            } catch (error) {
                this.app.componentService.showNotification('暂停异常', 'error');
            }
        }

        /**
         * 继续磁力下载：优先快速路径（子进程持有 torrent 则直接 resume），
         * 否则回退到 magnet-replay 重新启动（断点续传）
         */
        async _resumeMagnet(id) {
            const file = this.files.find(f => f.id === id);
            if (!file) return;
            if (file.sourceType !== 'magnet') {
                this.app.componentService.showNotification('该类型暂不支持继续', 'error');
                return;
            }
            try {
                // 优先：让子进程恢复（如果它还持有该 torrent）
                const res = await window.electron.ipcRenderer.invoke('magnet-resume', {
                    infoHash: file.infoHash || '',
                    fileName: file.name
                });
                if (res && res.type === 'resumed') {
                    this.app.componentService.showNotification('已继续下载', 'success');
                    return;
                }
                if (!(res && res.code === 'TORRENT_NOT_FOUND')) {
                    // 真错误（非 torrent 缺失）直接提示，不走 replay 回退
                    this.app.componentService.showNotification(`继续失败: ${res?.error || '未知错误'}`, 'error');
                    return;
                }
                // 子进程已销毁 / 没有这个 torrent：回退到磁盘断点续传（magnet-replay）
                if (!file.infoHash) {
                    this.app.componentService.showNotification('缺少磁力信息，无法继续', 'error');
                    return;
                }
                // 兜底：旧记录的 sourceUrl 可能为空（历史 manifest 缺失），
                // 用 infoHash 构造最小磁力链接——会比原 magnetUri 慢（无 tracker），
                // 但至少能继续下载（webtorrent 会从 DHT/PEX 找节点）
                const replayMagnetUri = file.sourceUrl || `magnet:?xt=urn:btih:${file.infoHash}`;
                const replay = await window.electron.ipcRenderer.invoke('magnet-replay', {
                    magnetUri: replayMagnetUri,
                    fileName: file.name,
                    infoHash: file.infoHash
                });
                if (replay && replay.success) {
                    this.app.componentService.showNotification('已从断点恢复下载', 'success');
                    // 不主动打开播放器，避免"点继续"就跳到播放
                } else {
                    this.app.componentService.showNotification(`恢复失败: ${replay?.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                this.app.componentService.showNotification('继续下载异常', 'error');
            }
        }

        /**
         * 本地把磁力文件状态切到指定值（同步更新内存 + manifest + UI）
         * 用于子进程已销毁场景：用户点的暂停不会回流 magnet-status 事件，
         * 需主动把状态写回以便下次 _loadFiles 时看到正确状态
         * @param {string} id
         * @param {'paused'|'downloading'|'error'} status
         */
        async _setMagnetFileStatus(id, status) {
            const file = this.files.find(f => f.id === id);
            if (!file) return;
            file.status = status;
            file.mtime = Date.now();
            // 通知主进程落盘
            try {
                await window.electron.ipcRenderer.invoke('magnet-set-status', { id, status });
            } catch (e) {
                console.error('[DOWNLOAD-CTRL] magnet-set-status 异常:', e);
            }
            this._renderFiles();
        }

        /**
         * 重试磁力下载（错误态重新触发）
         */
        async _retryMagnet(id) {
            const file = this.files.find(f => f.id === id);
            if (!file || file.sourceType !== 'magnet') return;
            if (!file.sourceUrl || !file.infoHash) {
                this.app.componentService.showNotification('缺少磁力信息，无法重试', 'error');
                return;
            }
            try {
                const res = await window.electron.ipcRenderer.invoke('magnet-replay', {
                    magnetUri: file.sourceUrl,
                    fileName: file.name,
                    infoHash: file.infoHash
                });
                if (res && res.success) {
                    this.app.componentService.showNotification('已开始重试下载', 'success');
                } else {
                    this.app.componentService.showNotification(`重试失败: ${res?.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                this.app.componentService.showNotification('重试异常', 'error');
            }
        }

        /**
         * 播放下载文件
         * 磁力文件：两段 IPC（play-magnet-file → open-player）+ 实时进度反馈（全局浮动条）
         *   - play-magnet-file 内部要等 c.add ready（首次 5-30 秒，复用子进程 torrent 毫秒级）
         *   - 在调 play-magnet-file 之前立刻订阅 magnet-download-progress 事件，
         *     浮动条第一时间出现，用户能看到'正在连接/下载中'等实时状态
         *   - player-canplay 时统一清理订阅 + 隐藏浮动条
         * 本地/URL 文件：走 open-player 用 file:// 协议直接读盘（文件不存在则提示而非静默失败）
         */
        async _playFile(id) {
            const file = this.files.find(f => f.id === id);
            if (!file) {
                this.app.componentService.showNotification('文件不存在', 'error');
                return;
            }
            try {
                // 磁力文件：本地优先快速路径 + 实时进度反馈
                if (file.sourceType === 'magnet') {
                    if (!file.infoHash) {
                        this.app.componentService.showNotification('缺少磁力信息，无法播放', 'error');
                        return;
                    }
                    // 兜底：旧记录 sourceUrl 为空时用 infoHash 构造最小磁力链（无 tracker 走 DHT/PEX）
                    const magnetUri = file.sourceUrl || `magnet:?xt=urn:btih:${file.infoHash}`;

                    // === 快速路径 1：文件已下完，毫秒级 file:// 打开，**不显示浮动条** ===
                    // 用户在下载页点播放，绝大多数场景是"之前下载过的"——文件应已在本地
                    // 命中即跳过 webtorrent/子进程/流服务器,直接走本地播放器
                    let localCheck = null;
                    try {
                        localCheck = await window.electron.ipcRenderer.invoke('magnet-check-local', {
                            infoHash: file.infoHash,
                            fileName: file.name
                        });
                    } catch (e) {
                        // 快速路径查不到不报错,继续走 webtorrent 兜底
                    }
                    if (localCheck && localCheck.exists && localCheck.size > 0 && localCheck.path) {
                        // 直接 file:// 打开播放器,完全跳过磁力子进程
                        const videoData = {
                            url: 'file:///' + localCheck.path.replace(/\\/g, '/'),
                            title: file.name,
                            vod_name: file.name,
                            episode_name: file.name,
                            isDirectPlay: true,
                            playSource: 'local',
                            isLocal: true,
                            isStreaming: false,
                            type_name: '下载',
                            siteName: '本地',
                            // 用统一 dl_ 前缀,历史页面可识别并路由回 DownloadController
                            vod_id: 'dl_' + file.id,
                            vod_pic: ''
                        };
                        await window.electron.ipcRenderer.invoke('open-player', videoData);
                        return;
                    }

                    // === 快速路径 2：文件未下完,走 webtorrent 流服务器(边下边播) ===
                    // 此时才需要显示"准备中"提示,告知用户后台在做什么
                    // 防御性清理旧订阅（防止从下载页/历史页重复点播放导致回调多次触发）
                    this._unbindMagnetProgress();
                    this._unbindPlayerListeners();
                    // 极简提示:loading 转圈 + 固定文字,不显示进度条
                    // 进度条会因为"已下载 X% / 100%"等数字跳动让用户误以为卡了/没动
                    this._showMagnetProgress(`准备播放: ${file.name}`, null, 'info');
                    // 关键：player-canplay 订阅必须放在 await 之前！
                    // 否则 open-player 之后视频快速 canplay，IPC 事件触发时还没订阅就丢失了
                    this._bindPlayerCanplay(() => {
                        this._unbindMagnetProgress();
                        this._unbindPlayerListeners();
                        this._hideMagnetProgress();
                    });
                    // 订阅磁力下载进度,让浮动条文本随真实状态变化
                    // 节流:相同 status+相近 progress 不重复更新,避免刷屏
                    this._lastProgressRender = { status: '', percent: -1, peers: -1 };
                    this._bindMagnetProgress((data) => {
                        if (!data) return;
                        const status = data.status || 'connecting';
                        // 数字安全
                        let pct = Number(data.progress);
                        if (!isFinite(pct) || pct < 0) pct = 0;
                        if (pct > 100) pct = 100;
                        const peers = Number(data.numPeers || 0);
                        // 节流:status 变了或 percent 跨过 1% 整数边界才更新
                        const last = this._lastProgressRender;
                        const pctFloor = Math.floor(pct);
                        if (last.status === status
                            && last.percent === pctFloor
                            && last.peers === peers) {
                            return;
                        }
                        this._lastProgressRender = { status, percent: pctFloor, peers };
                        let text;
                        switch (status) {
                            case 'connecting':
                                text = `准备播放: ${file.name} - 正在连接网络...`;
                                this._showMagnetProgress(text, null, 'info');
                                break;
                            case 'metadata':
                                text = `准备播放: ${file.name} - 正在解析元数据...`;
                                this._showMagnetProgress(text, null, 'info');
                                break;
                            case 'downloading':
                                text = `准备播放: ${file.name} - 下载中 ${pctFloor}% (${peers} 节点)`;
                                this._showMagnetProgress(text, pct, 'info');
                                break;
                            case 'ready':
                                text = `准备播放: ${file.name} - 准备就绪`;
                                this._showMagnetProgress(text, 100, 'info');
                                break;
                            case 'error':
                                text = `播放失败: ${data.message || '未知错误'}`;
                                this._showMagnetProgress(text, null, 'error');
                                break;
                            default:
                                text = `准备播放: ${file.name}`;
                                this._showMagnetProgress(text, null, 'info');
                        }
                    });
                    // 1) 调起/恢复磁力下载并获取 streamUrl
                    const result = await window.electron.ipcRenderer.invoke('play-magnet-file', {
                        magnetUri,
                        fileName: file.name,
                        infoHash: file.infoHash
                    });
                    if (!(result && result.success)) {
                        const reason = (result && (result.message || result.error)) || '未知错误';
                        this._unbindMagnetProgress();
                        this._unbindPlayerListeners();
                        this._showMagnetProgress(`播放失败: ${reason}`, null, 'error');
                        // 1.5s 后再隐藏，让用户看清错误文本
                        setTimeout(() => this._hideMagnetProgress(), 1500);
                        this.app.componentService.showNotification(`播放失败: ${reason}`, 'error');
                        return;
                    }
                    // 2) 真正打开播放器窗口（用 streamUrl）
                    // 关键：play-magnet-file 只返回 streamUrl 不开窗，必须再调 open-player
                    const videoData = {
                        url: result.streamUrl,
                        title: file.name,
                        vod_name: file.name,
                        episode_name: file.name,
                        isDirectPlay: true,
                        playSource: 'magnet',
                        isStreaming: !result.isLocal,
                        isLocal: !!result.isLocal,
                        type_name: '下载',
                        siteName: '磁力',
                        // 用统一 dl_ 前缀，历史页面可识别并路由回 DownloadController
                        vod_id: 'dl_' + file.id,
                        vod_pic: ''
                    };
                    const openResult = await window.electron.ipcRenderer.invoke('open-player', videoData);
                    if (!(openResult && openResult.success)) {
                        const reason = (openResult && openResult.message) || '未知错误';
                        this._unbindMagnetProgress();
                        this._unbindPlayerListeners();
                        this._showMagnetProgress(`打开播放器失败: ${reason}`, null, 'error');
                        setTimeout(() => this._hideMagnetProgress(), 1500);
                        this.app.componentService.showNotification(`打开播放器失败: ${reason}`, 'error');
                    }
                    return;
                }
                // 本地/URL 文件：先校验文件存在，避免 file:// 静默失败
                if (!file.path) {
                    this.app.componentService.showNotification('文件路径无效，无法播放', 'error');
                    return;
                }
                const fileResult = await window.electron.ipcRenderer.invoke('check-file-exists', file.path);
                if (fileResult && fileResult.exists === false) {
                    this.app.componentService.showNotification('文件不存在或已被移动/删除', 'error');
                    return;
                }
                const videoData = {
                    url: 'file:///' + file.path.replace(/\\/g, '/'),
                    title: file.name,
                    isLocal: true,
                    playSource: 'local',
                    type_name: '下载',
                    siteName: '本地',
                    vod_id: 'dl_' + file.id,
                    vod_name: file.name,
                    vod_pic: ''
                };
                const result = await window.electron.ipcRenderer.invoke('open-player', videoData);
                if (result && result.success) {
                    this.app.componentService.showNotification('已打开播放器', 'success');
                } else {
                    this.app.componentService.showNotification(`播放失败: ${result?.message || '未知错误'}`, 'error');
                }
            } catch (error) {
                console.error('[DOWNLOAD-CTRL] 播放失败:', error);
                this.app.componentService.showNotification('播放失败', 'error');
            }
        }

        /**
         * 重命名：弹模态框输入新名
         */
        async _renameFile(id) {
            const file = this.files.find(f => f.id === id);
            if (!file) return;
            const newName = window.prompt('请输入新的文件名（含扩展名）：', file.name);
            if (newName == null) return; // 取消
            const trimmed = newName.trim();
            if (!trimmed) {
                this.app.componentService.showNotification('文件名不能为空', 'warning');
                return;
            }
            try {
                const res = await window.electron.ipcRenderer.invoke('download-rename', { id, newName: trimmed });
                if (res && res.success) {
                    this.app.componentService.showNotification('重命名成功', 'success');
                    this._loadFiles();
                } else {
                    this.app.componentService.showNotification(`重命名失败: ${res?.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                this.app.componentService.showNotification('重命名异常', 'error');
            }
        }

        /**
         * 移动：列出子目录，让用户选择
         */
        async _moveFile(id) {
            try {
                const res = await window.electron.ipcRenderer.invoke('download-list-folders');
                const folders = (res && res.success) ? (res.folders || []) : [];
                const opts = ['📁 根目录', ...folders.map(f => `📂 ${f}`), '➕ 新建子目录...'];
                const choice = window.prompt(
                    `将文件移动到子目录：\n${opts.map((o, i) => `${i}. ${o}`).join('\n')}\n\n输入序号或子目录名（留空取消）：`
                );
                if (choice == null || choice.trim() === '') return;
                const trimmed = choice.trim();
                let target;
                if (/^\d+$/.test(trimmed)) {
                    const idx = parseInt(trimmed, 10);
                    if (idx < 0 || idx >= opts.length) {
                        this.app.componentService.showNotification('序号无效', 'warning');
                        return;
                    }
                    if (idx === 0) target = '';
                    else if (idx === opts.length - 1) {
                        const newName = window.prompt('请输入新子目录名称：');
                        if (!newName) return;
                        target = newName.trim();
                    } else {
                        target = folders[idx - 1];
                    }
                } else {
                    target = trimmed;
                }
                const moveRes = await window.electron.ipcRenderer.invoke('download-move', { id, subDir: target });
                if (moveRes && moveRes.success) {
                    this.app.componentService.showNotification('移动成功', 'success');
                    this._loadFiles();
                } else {
                    this.app.componentService.showNotification(`移动失败: ${moveRes?.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                this.app.componentService.showNotification('移动异常', 'error');
            }
        }

        /**
         * 在系统资源管理器中显示
         * 磁力文件未下载完成时主进程会自动回退到打开 infoHash 目录，
         * 此时会带 message 字段提示用户
         */
        async _revealFile(id) {
            try {
                const res = await window.electron.ipcRenderer.invoke('download-reveal', { id });
                if (res && res.success) {
                    if (res.message) {
                        this.app.componentService.showNotification(res.message, 'info');
                    }
                } else {
                    this.app.componentService.showNotification(`操作失败: ${res?.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                this.app.componentService.showNotification('打开文件夹异常', 'error');
            }
        }

        /**
         * 删除文件（带确认）
         */
        async _deleteFile(id) {
            const file = this.files.find(f => f.id === id);
            if (!file) return;
            if (!window.confirm(`确定要删除「${file.name}」吗？\n该操作不可撤销。`)) return;
            try {
                // 磁力文件：先通知子进程销毁 torrent + 清磁盘存储
                // 关键：用户可能已下载了一半但还没播，torrent 在子进程里仍占着 peer 连接 / 磁盘
                // 不告诉子进程的话，即使删了磁盘文件，子进程还会继续往已删的路径写 → 浪费带宽
                if (file.sourceType === 'magnet' && file.infoHash) {
                    await window.electron.ipcRenderer.invoke('magnet-remove', {
                        infoHash: file.infoHash,
                        fileName: file.name
                    });
                }
                const res = await window.electron.ipcRenderer.invoke('download-delete', { id });
                if (res && res.success) {
                    this.app.componentService.showNotification('已删除', 'success');
                    this._loadFiles();
                } else {
                    this.app.componentService.showNotification(`删除失败: ${res?.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                this.app.componentService.showNotification('删除异常', 'error');
            }
        }

        /**
         * 导入本地视频文件
         */
        async _importLocal() {
            try {
                const res = await window.electron.ipcRenderer.invoke('download-import-local');
                if (res && res.success) {
                    const count = (res.imported || []).length;
                    this.app.componentService.showNotification(`已导入 ${count} 个文件`, 'success');
                    this._loadFiles();
                } else if (res && res.message) {
                    // 取消是正常的，不报错
                } else {
                    this.app.componentService.showNotification(`导入失败: ${res?.error || '未知错误'}`, 'error');
                }
            } catch (error) {
                this.app.componentService.showNotification('导入异常', 'error');
            }
        }

        /**
         * 打开下载目录
         */
        async _openDownloadFolder() {
            try {
                // 获取 rootDir
                if (!this.rootDir) {
                    const res = await window.electron.ipcRenderer.invoke('download-list', {});
                    if (res && res.rootDir) this.rootDir = res.rootDir;
                }
                if (!this.rootDir) {
                    this.app.componentService.showNotification('尚未获取下载目录', 'warning');
                    return;
                }
                // 通过 open-path 直接调用 shell.openPath 打开 rootDir
                const res = await window.electron.ipcRenderer.invoke('open-path', { path: this.rootDir });
                if (!res || !res.success) {
                    // 兜底：如果 open-path 失败，提示路径
                    this.app.componentService.showNotification(
                        `打开目录失败: ${res?.error || '未知错误'}（${this.rootDir}）`,
                        'error'
                    );
                }
            } catch (error) {
                this.app.componentService.showNotification('打开目录失败: ' + error.message, 'error');
            }
        }

        // ============================================================
        // 磁力播放进度反馈辅助方法
        // 设计：复用 PlayUrlController 的全局浮动进度条 #global-magnet-progress
        // 不直接走 PlayUrlController.resumeMagnetFromHistory 是因为下载页上下文
        // （_dom = 外链页 hidden）的状态机与外链页路径不同，容易触发"播放失败"误判
        // 这里直接操作全局 DOM + 订阅 IPC 事件，简洁可靠
        // ============================================================

        /**
         * 显示全局浮动提示条
         * 极简设计：固定文字 + loading 转圈，不显示进度条（对"边下边播"是噪音）
         * @param {string} text 提示文本
         * @param {number|null} percent 进度 0-100，**传 null 时隐藏进度条**
         * @param {'info'|'warning'|'success'|'error'} variant 变体
         */
        _showMagnetProgress(text, percent, variant) {
            const el = document.getElementById('global-magnet-progress');
            const stageEl = document.getElementById('global-magnet-progress-stage');
            const fillEl = document.getElementById('global-magnet-progress-fill');
            const barEl = document.getElementById('global-magnet-progress-bar');
            if (!el) return;
            el.classList.remove('is-warning', 'is-success', 'is-error');
            if (variant && variant !== 'info') {
                el.classList.add('is-' + variant);
            }
            el.style.display = 'block';
            if (stageEl) {
                stageEl.textContent = text || '';
            }
            // 进度条:percent=null 时隐藏,否则显示(用真实下载百分比)
            if (barEl) {
                if (percent == null) {
                    barEl.style.display = 'none';
                } else {
                    barEl.style.display = 'block';
                    if (fillEl) {
                        // 数字安全:null/undefined/NaN/Infinity/负数/超过 100 都兜底到 0-100 区间
                        let pct = percent;
                        if (pct == null || !isFinite(pct) || pct < 0) {
                            pct = 0;
                        } else if (pct > 100) {
                            pct = 100;
                        }
                        fillEl.style.width = pct + '%';
                    }
                }
            }
            // 不再设 60 秒硬切定时器 —— 浮动条必须由真实状态驱动
            // 状态变化由 _bindMagnetProgress 监听 progress 事件更新
        }

        /**
         * 隐藏全局浮动进度条
         */
        _hideMagnetProgress() {
            const el = document.getElementById('global-magnet-progress');
            if (!el) return;
            el.style.display = 'none';
            const stageEl = document.getElementById('global-magnet-progress-stage');
            if (stageEl) stageEl.textContent = '';
        }

        /**
         * 订阅 magnet-download-progress 事件
         * 关键：保存 handler 引用，后续 _unbindMagnetProgress 才能正确 removeListener
         * 不使用 window.electron.on(... anonymous arrow)，否则 removeListener 无法定位
         */
        _bindMagnetProgress(callback) {
            if (!window.electron) return;
            if (this._magnetProgressHandler) {
                this._unbindMagnetProgress();
            }
            this._magnetProgressHandler = (data) => {
                try {
                    callback(data);
                } catch (err) {
                    console.error('[DownloadController] magnet-download-progress 回调异常:', err);
                }
            };
            // preload 暴露的是 window.electron.on（带 channel 白名单 + 自动包装 event 参数）
            // 旧的 window.electron.safeOn / window.electron.ipcRenderer.on 都不存在，静默失败导致进度条永不更新
            if (typeof window.electron.on === 'function') {
                window.electron.on('magnet-download-progress', this._magnetProgressHandler);
            } else if (typeof window.electron.ipcRenderer !== 'undefined'
                && typeof window.electron.ipcRenderer.on === 'function') {
                // 兜底：旧版 preload 兼容
                window.electron.ipcRenderer.on('magnet-download-progress', this._magnetProgressHandler);
            } else {
                console.error('[DownloadController] _bindMagnetProgress 失败: window.electron.on 和 ipcRenderer.on 都不存在');
            }
        }

        /**
         * 取消 magnet-download-progress 订阅
         */
        _unbindMagnetProgress() {
            if (!this._magnetProgressHandler) return;
            try {
                // 优先用 preload 暴露的 removeListener（带 channel 白名单 + 包装函数映射）
                if (window.electron && typeof window.electron.removeListener === 'function') {
                    window.electron.removeListener('magnet-download-progress', this._magnetProgressHandler);
                } else if (window.electron && window.electron.ipcRenderer
                    && typeof window.electron.ipcRenderer.removeListener === 'function') {
                    window.electron.ipcRenderer.removeListener(
                        'magnet-download-progress', this._magnetProgressHandler
                    );
                }
            } catch (err) {
                console.warn('[DownloadController] 取消 magnet-download-progress 订阅失败:', err);
            }
            this._magnetProgressHandler = null;
        }

        /**
         * 订阅 player-canplay 事件
         * 用于视频可播放时自动清理订阅 + 隐藏浮动条
         */
        _bindPlayerCanplay(callback) {
            if (!window.electron) return;
            if (this._playerCanplayHandler) {
                this._unbindPlayerListeners();
            }
            this._playerCanplayHandler = () => {
                console.log('[DownloadController] 收到 player-canplay，关闭浮动条');
                try {
                    callback();
                } catch (err) {
                    console.error('[DownloadController] player-canplay 回调异常:', err);
                }
            };
            // 关键:必须用 preload 暴露的专用 API (onPlayerCanplay)
            // —— window.electron.on 的白名单 [preload.js:98-106] 不包含 'player-canplay',
            // 调 window.electron.on('player-canplay', ...) 会被白名单拦截静默失败,
            // 导致浮动条永远不关闭(用户报告的核心问题)
            // 顺序: 专用 API > ipcRenderer.on (兜底,理论上用不到)
            if (typeof window.electron.onPlayerCanplay === 'function') {
                window.electron.onPlayerCanplay(this._playerCanplayHandler);
            } else if (window.electron.ipcRenderer
                && typeof window.electron.ipcRenderer.on === 'function') {
                window.electron.ipcRenderer.on('player-canplay', this._playerCanplayHandler);
            } else {
                console.error('[DownloadController] _bindPlayerCanplay 失败: window.electron.onPlayerCanplay 和 ipcRenderer.on 都不存在');
            }
        }

        /**
         * 取消 player-loaded/player-canplay 订阅
         */
        _unbindPlayerListeners() {
            ['_playerCanplayHandler', '_playerLoadedHandler'].forEach((key) => {
                const handler = this[key];
                if (!handler) return;
                const channel = key === '_playerCanplayHandler' ? 'player-canplay' : 'player-loaded';
                try {
                    if (window.electron && typeof window.electron.removeListener === 'function') {
                        window.electron.removeListener(channel, handler);
                    } else if (window.electron && window.electron.ipcRenderer
                        && typeof window.electron.ipcRenderer.removeListener === 'function') {
                        window.electron.ipcRenderer.removeListener(channel, handler);
                    }
                } catch (err) {
                    console.warn(`[DownloadController] 取消 ${channel} 订阅失败:`, err);
                }
                this[key] = null;
            });
        }
    }

    // 同时暴露到 window 全局和 module.exports（兼容 Electron 渲染端和 Jest）
    if (typeof window !== 'undefined') {
        window.DownloadController = DownloadController;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DownloadController;
    }
})();
