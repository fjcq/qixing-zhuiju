// 播放器页面脚本
class VideoPlayer {
    constructor() {
        this.video = null;
        this.hls = null;
        this.videoData = null;
        this.currentEpisodeIndex = 1;
        this.allEpisodes = [];
        this.allRoutes = [];
        this.currentRouteIndex = 0;
        this.isAutoNext = true;
        this.playbackHistory = [];
        this.storageService = null; // 添加存储服务引用
        this.isCasting = false; // 投屏状态
        this.presentationRequest = null; // 投屏请求
        this.selectedCastDevice = null; // 选中的投屏设备

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

    // 初始化播放器
    initialize() {
        console.log('[PLAYER] 初始化播放器...');

        // 初始化存储服务
        this.storageService = new StorageService();
        console.log('[PLAYER] 存储服务初始化完成');

        this.video = document.getElementById('video-player');

        // 强制移除原生控制栏
        if (this.video) {
            this.video.removeAttribute('controls');
            this.video.controls = false;
        }

        // 隐藏其他顶部控制元素（但不影响悬浮控制栏内的按钮）
        setTimeout(() => {
            this.hideTopControls();
        }, 50);

        this.setupVideoEvents();
        this.setupControlEvents();

        // 初始化播放控制栏状态
        this.initializeControlsState();

        // 初始化弹幕系统
        this.initializeDanmaku();

        // 初始化视频显示属性
        this.adjustVideoDisplay();

        // 确保选集面板默认隐藏
        this.hideEpisodePanel();

        // 监听主进程发送的视频数据
        if (window.electron && window.electron.ipcRenderer) {
            window.electron.ipcRenderer.on('video-data', (data) => {
                console.log('[PLAYER] 收到视频数据:', data);
                this.loadVideoData(data);
            });
        } else {
            console.error('[PLAYER] Electron IPC 不可用');
        }

        console.log('[PLAYER] 播放器初始化完成');

        // 初始化时隐藏右上角按钮，与底部控制栏行为一致
        setTimeout(() => {
            const topRightControls = document.querySelector('.top-right-controls');
            if (topRightControls) {
                topRightControls.style.opacity = '0';
                topRightControls.style.visibility = 'hidden';
                topRightControls.style.pointerEvents = 'none';
                console.log('[PLAYER] 初始化时隐藏右上角按钮');
            }
        }, 100);
    }

    // 初始化弹幕系统
    initializeDanmaku() {
        // 等待增强版弹幕系统加载完成
        const initDanmaku = () => {
            if (typeof EnhancedDanmakuSystem !== 'undefined') {
                // 使用增强版弹幕系统
                if (!window.danmakuSystem) {
                    window.danmakuSystem = new EnhancedDanmakuSystem();
                }
                console.log('[PLAYER] 增强版弹幕系统已就绪');
            } else if (window.danmakuSystem) {
                // 使用基础弹幕系统
                console.log('[PLAYER] 基础弹幕系统已就绪');
            } else {
                console.log('[PLAYER] 等待弹幕系统加载...');
                setTimeout(initDanmaku, 100);
            }
        };
        initDanmaku();
    }

    // 强制隐藏顶部控制元素
    hideTopControls() {
        // 查找并隐藏所有可能的顶部控制元素，但保留右上角按钮
        const selectors = [
            '.overlay-header',
            '#overlay-header',
            '[class*="header"]:not(.top-right-controls)',
            '[class*="overlay-control"]'
        ];

        selectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    // 确保不隐藏右上角控制按钮区域
                    if (el && el.style && !el.classList.contains('top-right-controls') && !el.classList.contains('btn-top-control')) {
                        el.style.display = 'none !important';
                        el.style.visibility = 'hidden !important';
                        el.style.opacity = '0 !important';
                        el.style.pointerEvents = 'none !important';
                        el.setAttribute('hidden', 'true');
                    }
                });
            } catch (e) {
                console.log('隐藏控件时出错:', e);
            }
        });

        console.log('[PLAYER] 隐藏顶部控制元素，但保留右上角按钮');
    }

    // 加载视频数据
    loadVideoData(data) {
        console.log('[PLAYER] 加载视频数据:', data);

        this.videoData = data.videoData || data;
        // currentEpisode是数组索引（从0开始），需要转换为从1开始的显示索引
        this.currentEpisodeIndex = (data.videoData?.currentEpisode ?? -1) + 1; // 将数组索引转换为显示索引

        // 保存播放进度信息（来自历史记录）
        this.resumeProgress = data.resumeProgress || null;
        if (this.resumeProgress) {
            console.log('[PLAYER] 接收到继续播放进度:', this.resumeProgress, 'seconds');
        }

        // 如果直接传入了集数名称，保存它
        if (data.episodeName) {
            this.videoData.episode_name = data.episodeName;
        }

        // 从routes中获取所有线路信息
        if (data.videoData?.routes && Array.isArray(data.videoData.routes)) {
            this.allRoutes = data.videoData.routes;
            this.currentRouteIndex = data.videoData.currentRoute || 0;
            const currentRoute = this.allRoutes[this.currentRouteIndex];
            this.allEpisodes = currentRoute?.episodes || [];
            console.log('[PLAYER] 所有线路:', this.allRoutes.length);
            console.log('[PLAYER] 当前线路:', currentRoute?.name);
            console.log('[PLAYER] 剧集数量:', this.allEpisodes.length);
            console.log('[PLAYER] 当前集数索引:', this.currentEpisodeIndex);
        } else {
            this.allRoutes = [];
            this.allEpisodes = [];
        }

        // 更新界面信息
        this.updateVideoInfo();
        this.createRouteSelector();
        this.createEpisodeList();

        // 开始播放
        if (data.url) {
            console.log('[PLAYER] 开始播放:', data.url);
            this.playEpisode(this.currentEpisodeIndex, data.url);
        }
    }

    // 更新视频信息
    updateVideoInfo() {
        const titleElement = document.getElementById('video-title');
        const episodeElement = document.getElementById('video-episode');

        if (titleElement && this.videoData) {
            titleElement.textContent = this.videoData.vod_name || '未知视频';
        }

        if (episodeElement) {
            let episodeText = '';

            if (this.allEpisodes.length > 0) {
                // 有剧集数据，查找当前集数
                const currentEpisode = this.allEpisodes.find(ep => ep.index === this.currentEpisodeIndex);
                if (currentEpisode && currentEpisode.name) {
                    // 找到当前集数且有名称，使用真实名称
                    episodeText = currentEpisode.name;
                } else {
                    // 有剧集数据但找不到当前集数
                    episodeText = '未知集数';
                }
            } else {
                // 没有剧集数据，使用默认名称或从videoData中获取
                if (this.videoData && this.videoData.episode_name) {
                    // 如果videoData中有episode_name，使用它
                    episodeText = this.videoData.episode_name;
                } else if (this.videoData && this.videoData.vod_remarks) {
                    // 如果有备注信息（通常包含集数信息），使用它
                    episodeText = this.videoData.vod_remarks;
                } else {
                    // 都没有的话，使用通用的"正片"
                    episodeText = '正片';
                }
            }

            episodeElement.textContent = episodeText;
        }

        // 更新集数控制按钮状态
        this.updateEpisodeControls();
    }

    // 创建剧集列表
    createEpisodeList() {
        const episodesContainer = document.getElementById('episodes');
        if (!episodesContainer || this.allEpisodes.length === 0) return;

        episodesContainer.innerHTML = '';

        this.allEpisodes.forEach(episode => {
            const episodeBtn = document.createElement('div');
            episodeBtn.className = 'episode-item';
            episodeBtn.textContent = episode.name;
            episodeBtn.dataset.episodeIndex = episode.index;
            episodeBtn.dataset.episodeUrl = episode.url;

            // 标记当前播放的集数
            if (episode.index === this.currentEpisodeIndex) {
                episodeBtn.classList.add('current');
            }

            // 标记已观看的集数（从本地存储获取）
            if (this.isEpisodeWatched(episode.index)) {
                episodeBtn.classList.add('watched');
            }

            episodeBtn.addEventListener('click', () => {
                this.playEpisode(episode.index, episode.url);
                // 点击选集后自动隐藏面板
                this.hideEpisodePanel();
            });

            episodesContainer.appendChild(episodeBtn);
        });
    }

    // 创建线路选择器
    createRouteSelector() {
        const routeTabsContainer = document.getElementById('route-tabs');
        if (!routeTabsContainer) return;

        // 如果只有一个线路或没有线路，隐藏线路选择器
        const routeSelection = document.getElementById('route-selection');
        if (this.allRoutes.length <= 1) {
            if (routeSelection) {
                routeSelection.style.display = 'none';
            }
            return;
        }

        // 显示线路选择器
        if (routeSelection) {
            routeSelection.style.display = 'block';
        }

        routeTabsContainer.innerHTML = '';

        this.allRoutes.forEach((route, index) => {
            const routeTab = document.createElement('button');
            routeTab.className = `route-tab ${index === this.currentRouteIndex ? 'active' : ''}`;
            routeTab.textContent = `${route.name} (${route.episodes.length}集)`;
            routeTab.dataset.routeIndex = index;

            routeTab.addEventListener('click', () => {
                this.switchRoute(index);
            });

            routeTabsContainer.appendChild(routeTab);
        });
    }

    // 切换线路
    switchRoute(routeIndex) {
        if (routeIndex < 0 || routeIndex >= this.allRoutes.length) {
            console.error('[PLAYER] 无效的线路索引:', routeIndex);
            return;
        }

        console.log(`[PLAYER] 切换到线路 ${routeIndex}: ${this.allRoutes[routeIndex].name}`);

        this.currentRouteIndex = routeIndex;
        this.allEpisodes = this.allRoutes[routeIndex].episodes;

        // 更新线路选择器状态
        const routeTabs = document.querySelectorAll('.route-tab');
        routeTabs.forEach((tab, index) => {
            tab.classList.toggle('active', index === routeIndex);
        });

        // 重新创建剧集列表
        this.createEpisodeList();

        // 自动播放第一集（如果当前集数在新线路中不存在）
        const currentEpisodeInNewRoute = this.allEpisodes.find(ep => ep.index === this.currentEpisodeIndex);
        if (!currentEpisodeInNewRoute && this.allEpisodes.length > 0) {
            // 当前集数在新线路中不存在，播放第一集
            const firstEpisode = this.allEpisodes[0];
            this.playEpisode(firstEpisode.index, firstEpisode.url);
        }
    }

    // 播放指定集数
    async playEpisode(episodeIndex, episodeUrl) {
        try {
            console.log(`播放第${episodeIndex}集:`, episodeUrl);

            this.currentEpisodeIndex = episodeIndex;
            this.showLoading();

            // 清理之前的播放器
            this.cleanup();

            // 更新界面状态
            this.updateVideoInfo();
            this.updateEpisodeList();

            // 设置弹幕房间
            this.setupDanmakuRoom(episodeUrl);

            // 开始播放视频
            await this.loadVideo(episodeUrl);

            // 记录播放历史
            this.recordPlayback(episodeIndex, episodeUrl);

            this.hideLoading();
        } catch (error) {
            console.error('播放失败:', error);
            this.showError('视频加载失败，请重试');
        }
    }

    // 设置弹幕房间
    setupDanmakuRoom(videoUrl) {
        if (window.danmakuSystem && videoUrl) {
            // 创建唯一的视频标识符
            const videoId = this.generateVideoId(videoUrl);
            console.log(`[PLAYER] 设置弹幕房间: ${videoId}`);
            window.danmakuSystem.setCurrentVideo(videoId);
        }
    }

    // 生成视频唯一标识符
    generateVideoId(videoUrl) {
        // 结合视频名称、集数和URL生成唯一标识
        const videoName = this.videoData?.vod_name || 'unknown';
        const episode = this.currentEpisodeIndex || 1;
        const urlHash = this.simpleHash(videoUrl);

        return `${videoName}_ep${episode}_${urlHash}`;
    }

    // 简单哈希函数
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return Math.abs(hash).toString(36);
    }

    // 加载视频
    async loadVideo(videoUrl) {
        if (!videoUrl || !this.video) {
            throw new Error('视频URL或播放器元素无效');
        }

        console.log('原始视频URL:', videoUrl);

        // 清理和处理URL
        let cleanUrl = videoUrl.trim();

        // 如果URL包含多个地址，取第一个
        if (cleanUrl.includes('#')) {
            const urls = cleanUrl.split('#');
            cleanUrl = urls.find(url => url.trim()) || urls[0];
        }

        console.log('处理后的视频URL:', cleanUrl);

        // 简化判断：检查是否为直接视频文件
        if (this.isDirectVideoFile(cleanUrl)) {
            console.log('检测到直接视频文件，使用原生播放器');
            await this.loadVideoFile(cleanUrl);
        } else {
            console.log('检测到网页链接，使用iframe播放器');
            await this.loadWebPage(cleanUrl);
        }

        // 恢复播放进度（仅对直接视频文件有效）
        if (this.isDirectVideoFile(cleanUrl)) {
            this.restorePlaybackProgress();
        }
    }

    // 检查是否为直接视频文件
    isDirectVideoFile(url) {
        const lowerUrl = url.toLowerCase();
        const videoExtensions = ['.m3u8', '.mp4', '.flv', '.avi', '.mkv', '.mov', '.wmv', '.webm', '.ogg', '.3gp'];
        return videoExtensions.some(ext => lowerUrl.includes(ext));
    }

    // 加载直接视频文件
    async loadVideoFile(videoUrl) {
        console.log('加载直接视频文件:', videoUrl);

        // 显示原生video元素并设置正确的显示属性
        this.video.style.display = 'block';
        this.video.style.objectFit = 'contain';
        this.video.style.width = '100%';
        this.video.style.height = '100%';
        this.video.style.maxWidth = '100%';
        this.video.style.maxHeight = '100%';

        // 清理可能存在的iframe
        this.cleanupWebPage();

        // 根据文件类型选择播放方式
        if (videoUrl.includes('.m3u8') || videoUrl.includes('m3u8') || videoUrl.includes('.M3U8')) {
            await this.loadHLSVideo(videoUrl);
        } else {
            await this.loadDirectVideo(videoUrl);
        }
    }

    // 加载网页（云播）
    async loadWebPage(webPageUrl) {
        console.log('加载网页播放器:', webPageUrl);

        // 隐藏原生video元素
        this.video.style.display = 'none';

        const playerContainer = document.querySelector('.player-container');

        // 创建或获取iframe容器
        let webPageContainer = document.getElementById('webpage-player-container');
        if (!webPageContainer) {
            webPageContainer = document.createElement('div');
            webPageContainer.id = 'webpage-player-container';
            webPageContainer.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: #000;
                display: flex;
                flex-direction: column;
                z-index: 1;
            `;
            playerContainer.appendChild(webPageContainer);
        }

        // 创建工具栏
        const toolbar = document.createElement('div');
        toolbar.style.cssText = `
            background: rgba(0,0,0,0.9);
            color: white;
            padding: 8px 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 14px;
            flex-shrink: 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        `;

        toolbar.innerHTML = `
            <div style="display: flex; align-items: center; gap: 15px;">
                <span>🌐 网页播放器</span>
                <button id="refresh-webpage" style="padding: 4px 8px; background: #28a745; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">刷新</button>
            </div>
            <div>
                <button id="toggle-fullscreen" style="padding: 4px 8px; background: #6c757d; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">全屏</button>
            </div>
        `;

        // 创建iframe
        const iframe = document.createElement('iframe');
        iframe.src = webPageUrl;
        iframe.style.cssText = `
            width: 100%;
            flex: 1;
            border: none;
            background: #000;
        `;
        iframe.allowFullscreen = true;
        iframe.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
        iframe.sandbox = "allow-same-origin allow-scripts allow-forms allow-popups allow-presentation allow-top-navigation-by-user-activation";

        // 清空容器并添加新内容
        webPageContainer.innerHTML = '';
        webPageContainer.appendChild(toolbar);
        webPageContainer.appendChild(iframe);

        // 添加工具栏按钮事件
        const refreshBtn = toolbar.querySelector('#refresh-webpage');
        const fullscreenBtn = toolbar.querySelector('#toggle-fullscreen');

        refreshBtn.addEventListener('click', () => {
            iframe.src = webPageUrl + (webPageUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
        });

        fullscreenBtn.addEventListener('click', () => {
            if (iframe.requestFullscreen) {
                iframe.requestFullscreen();
            } else if (iframe.webkitRequestFullscreen) {
                iframe.webkitRequestFullscreen();
            }
        });

        return new Promise((resolve) => {
            iframe.onload = () => {
                console.log('网页iframe加载完成');
                resolve();
            };

            iframe.onerror = (error) => {
                console.error('网页iframe加载失败:', error);
                toolbar.innerHTML = `
                    <div style="color: #ff6b6b;">网页加载失败</div>
                    <div>
                        <button onclick="location.reload()" style="padding: 4px 8px; background: #28a745; color: white; border: none; border-radius: 3px; cursor: pointer;">重试</button>
                    </div>
                `;
                resolve();
            };

            // 设置超时
            setTimeout(() => {
                console.log('网页iframe加载完成（超时结束）');
                resolve();
            }, 8000);
        });
    }

    // 清理网页播放器
    cleanupWebPage() {
        const webPageContainer = document.getElementById('webpage-player-container');
        if (webPageContainer) {
            webPageContainer.remove();
        }

        // 恢复原生video元素
        if (this.video) {
            this.video.style.display = 'block';
        }
    }

    // 加载HLS视频
    async loadHLSVideo(videoUrl) {
        console.log('加载HLS视频:', videoUrl);

        // 确保视频元素的显示属性
        this.video.style.objectFit = 'contain';
        this.video.style.width = '100%';
        this.video.style.height = '100%';
        this.video.style.maxWidth = '100%';
        this.video.style.maxHeight = '100%';

        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            this.hls = new Hls({
                enableWorker: false,
                lowLatencyMode: true,
                backBufferLength: 90,
                maxBufferLength: 30,
                maxMaxBufferLength: 600,
                startLevel: -1,
                capLevelToPlayerSize: true
            });

            this.hls.loadSource(videoUrl);
            this.hls.attachMedia(this.video);

            return new Promise((resolve, reject) => {
                this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    console.log('HLS manifest 解析完成');
                    this.video.play().then(resolve).catch(reject);
                });

                this.hls.on(Hls.Events.ERROR, (event, data) => {
                    console.error('HLS 错误:', data);
                    if (data.fatal) {
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                console.log('网络错误，尝试恢复...');
                                this.hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                console.log('媒体错误，尝试恢复...');
                                this.hls.recoverMediaError();
                                break;
                            default:
                                reject(new Error(`HLS播放错误: ${data.details}`));
                                break;
                        }
                    }
                });
            });
        } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari原生支持
            console.log('使用原生HLS支持');
            this.video.src = videoUrl;
            return this.video.play();
        } else {
            throw new Error('浏览器不支持HLS播放，请尝试其他播放源');
        }
    }

    // 加载普通视频
    async loadDirectVideo(videoUrl) {
        console.log('加载普通视频:', videoUrl);

        // 确保视频元素的显示属性
        this.video.style.objectFit = 'contain';
        this.video.style.width = '100%';
        this.video.style.height = '100%';
        this.video.style.maxWidth = '100%';
        this.video.style.maxHeight = '100%';

        this.video.src = videoUrl;

        return new Promise((resolve, reject) => {
            const onLoadedMetadata = () => {
                console.log('[PLAYER] 视频元数据加载完成:', {
                    videoWidth: this.video.videoWidth,
                    videoHeight: this.video.videoHeight,
                    duration: this.video.duration
                });

                this.video.removeEventListener('loadedmetadata', onLoadedMetadata);
                this.video.removeEventListener('error', onError);
                this.video.play().then(resolve).catch(reject);
            };

            const onError = () => {
                this.video.removeEventListener('loadedmetadata', onLoadedMetadata);
                this.video.removeEventListener('error', onError);
                reject(new Error('视频加载失败'));
            };

            this.video.addEventListener('loadedmetadata', onLoadedMetadata);
            this.video.addEventListener('error', onError);
        });
    }

    // 设置视频事件
    setupVideoEvents() {
        if (!this.video) return;

        // 播放进度更新
        this.video.addEventListener('timeupdate', () => {
            this.savePlaybackProgress();
        });

        // 视频结束事件
        this.video.addEventListener('ended', () => {
            console.log('视频播放结束');
            this.markEpisodeWatched(this.currentEpisodeIndex);

            if (this.isAutoNext) {
                this.playNextEpisode();
            }
        });

        // 播放错误事件 - 只在使用原生播放器时显示错误
        this.video.addEventListener('error', (e) => {
            // 检查是否正在使用网页播放器
            const webPageContainer = document.getElementById('webpage-player-container');
            if (webPageContainer && webPageContainer.style.display !== 'none') {
                console.log('网页播放器正在使用，忽略video元素错误');
                return;
            }

            console.error('视频播放错误:', e);
            this.showError('视频播放出现错误');
        });

        // 视频加载事件
        this.video.addEventListener('loadstart', () => {
            this.showLoading();
        });

        this.video.addEventListener('canplay', () => {
            this.hideLoading();
        });

        // 键盘快捷键
        document.addEventListener('keydown', async (e) => {
            if (e.target.tagName.toLowerCase() !== 'input') {
                await this.handleKeyboard(e);
            }
        });

        // 窗口大小变化监听器 - 确保视频适应新窗口大小
        window.addEventListener('resize', () => {
            console.log('[PLAYER] 窗口大小变化，调整视频显示');
            this.adjustVideoDisplay();
        });

        // 视频尺寸变化监听器
        this.video.addEventListener('loadedmetadata', () => {
            console.log('[PLAYER] 视频元数据加载完成，调整显示');
            this.adjustVideoDisplay();
        });

        // 双击全屏功能
        this.video.addEventListener('dblclick', (e) => {
            e.preventDefault();
            this.toggleFullscreen();
            console.log('[PLAYER] 双击切换全屏');
        });

        // 单击切换播放/暂停
        this.video.addEventListener('click', (e) => {
            e.preventDefault();
            this.togglePlayPause();
            console.log('[PLAYER] 单击切换播放/暂停');
        });

        // 监听播放状态变化
        this.video.addEventListener('play', () => {
            this.updatePlayPauseButton(true);
            console.log('[PLAYER] 视频开始播放');
        });

        this.video.addEventListener('pause', () => {
            this.updatePlayPauseButton(false);
            console.log('[PLAYER] 视频暂停');
        });

        // 监听音量变化
        this.video.addEventListener('volumechange', () => {
            this.updateVolumeButton();
        });
    }

    // 调整视频显示以适应窗口
    adjustVideoDisplay() {
        if (!this.video) return;

        // 确保视频使用正确的缩放模式
        this.video.style.objectFit = 'contain';
        this.video.style.width = '100%';
        this.video.style.height = '100%';
        this.video.style.maxWidth = '100%';
        this.video.style.maxHeight = '100%';

        console.log('[PLAYER] 视频显示属性已调整:', {
            videoWidth: this.video.videoWidth,
            videoHeight: this.video.videoHeight,
            containerWidth: this.video.offsetWidth,
            containerHeight: this.video.offsetHeight,
            objectFit: this.video.style.objectFit
        });
    }

    // 设置控制按钮事件
    setupControlEvents() {
        console.log('[PLAYER] 开始设置控制按钮事件');

        // 上一集按钮
        const prevBtn = document.getElementById('prev-episode');
        if (prevBtn) {
            // 移除可能已存在的监听器，防止重复绑定
            const newPrevBtn = prevBtn.cloneNode(true);
            prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);

            newPrevBtn.addEventListener('click', () => {
                this.playPrevEpisode();
            });
        }

        // 下一集按钮
        const nextBtn = document.getElementById('next-episode');
        if (nextBtn) {
            // 移除可能已存在的监听器，防止重复绑定
            const newNextBtn = nextBtn.cloneNode(true);
            nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);

            newNextBtn.addEventListener('click', () => {
                this.playNextEpisode();
            });
        }

        // 重试按钮
        const retryBtn = document.getElementById('retry-btn');
        if (retryBtn) {
            // 移除可能已存在的监听器，防止重复绑定
            const newRetryBtn = retryBtn.cloneNode(true);
            retryBtn.parentNode.replaceChild(newRetryBtn, retryBtn);

            newRetryBtn.addEventListener('click', () => {
                this.retryCurrentEpisode();
            });
        }

        // 显示/隐藏选集面板按钮
        const toggleEpisodesBtn = document.getElementById('toggle-episodes');
        if (toggleEpisodesBtn) {
            // 移除可能已存在的监听器，防止重复绑定
            const newToggleEpisodesBtn = toggleEpisodesBtn.cloneNode(true);
            toggleEpisodesBtn.parentNode.replaceChild(newToggleEpisodesBtn, toggleEpisodesBtn);

            newToggleEpisodesBtn.addEventListener('click', () => {
                this.toggleEpisodePanel();
            });
        }

        // 置顶按钮 - 关键修复点
        const toggleAlwaysOnTopBtn = document.getElementById('toggle-always-on-top');
        if (toggleAlwaysOnTopBtn) {
            console.log('[PLAYER] 找到置顶按钮，准备设置事件监听');

            // 使用cloneNode方法彻底移除所有已存在的事件监听器
            const newToggleBtn = toggleAlwaysOnTopBtn.cloneNode(true);
            toggleAlwaysOnTopBtn.parentNode.replaceChild(newToggleBtn, toggleAlwaysOnTopBtn);

            // 为新按钮添加单一的事件监听器
            newToggleBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[PLAYER] 置顶按钮被点击 - 开始处理');
                await this.toggleAlwaysOnTop();
            });

            console.log('[PLAYER] 置顶按钮事件监听设置完成');
        } else {
            console.error('[PLAYER] 未找到置顶按钮元素');
        }

        // 投屏按钮
        const castVideoBtn = document.getElementById('cast-video');
        if (castVideoBtn) {
            console.log('[PLAYER] 设置投屏按钮事件监听');
            castVideoBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[PLAYER] 投屏按钮被点击');
                await this.toggleCasting();
            });
        }

        // 分享按钮
        const shareVideoBtn = document.getElementById('share-video');
        if (shareVideoBtn) {
            console.log('[PLAYER] 设置分享按钮事件监听');
            shareVideoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('[PLAYER] 分享按钮被点击');
                this.shareCurrentVideo();
            });
        } else {
            console.error('[PLAYER] 未找到分享按钮元素');
        }

        // 弹幕按钮
        const toggleDanmakuBtn = document.getElementById('toggle-danmaku');
        if (toggleDanmakuBtn) {
            toggleDanmakuBtn.addEventListener('click', () => {
                this.toggleDanmakuPanel();
            });
        }

        // 播放速度按钮
        const playbackSpeedBtn = document.getElementById('playback-speed');
        if (playbackSpeedBtn) {
            playbackSpeedBtn.addEventListener('click', () => {
                this.cyclePlaybackSpeed();
            });
        }

        // 关闭弹幕面板按钮
        const closeDanmakuPanelBtn = document.getElementById('close-danmaku-panel');
        if (closeDanmakuPanelBtn) {
            closeDanmakuPanelBtn.addEventListener('click', () => {
                this.hideDanmakuPanel();
            });
        }

        // 弹幕启用/禁用开关
        const enableDanmakuCheckbox = document.getElementById('enable-danmaku');
        if (enableDanmakuCheckbox) {
            enableDanmakuCheckbox.addEventListener('change', (e) => {
                this.toggleDanmakuDisplay(e.target.checked);
            });
        }

        // 弹幕类型切换
        const danmakuTypeSelect = document.getElementById('danmaku-type');
        if (danmakuTypeSelect) {
            danmakuTypeSelect.addEventListener('change', (e) => {
                this.changeDanmakuType(e.target.value);
            });
        }

        // 发送弹幕按钮
        const sendDanmakuBtn = document.getElementById('send-danmaku');
        if (sendDanmakuBtn) {
            sendDanmakuBtn.addEventListener('click', () => {
                this.sendDanmaku();
            });
        }

        // 弹幕输入框回车发送
        const danmakuInput = document.getElementById('danmaku-input');
        if (danmakuInput) {
            danmakuInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendDanmaku();
                }
            });
        }

        // 弹幕面板阻止事件冒泡（仅为安全起见保留，实际不再需要外部点击关闭）
        const danmakuPanel = document.getElementById('danmaku-input-container');
        if (danmakuPanel) {
            danmakuPanel.addEventListener('click', (e) => {
                // 阻止点击事件冒泡到外层，防止面板被意外关闭
                e.stopPropagation();
            });
        }

        // 关闭选集面板按钮
        const closeEpisodesBtn = document.getElementById('close-episodes');
        if (closeEpisodesBtn) {
            closeEpisodesBtn.addEventListener('click', () => {
                this.hideEpisodePanel();
            });
        }

        // 点击播放器区域隐藏选集面板
        const playerContainer = document.querySelector('.player-container');
        if (playerContainer) {
            playerContainer.addEventListener('click', (e) => {
                if (e.target === playerContainer || e.target === this.video) {
                    this.hideEpisodePanel();
                }
            });
        }

        // 设置自定义播放控制栏事件
        this.setupPlaybackControls();

        // 鼠标移动显示悬浮控制栏
        this.setupOverlayControls();

        // 设置全屏状态监听
        this.setupFullscreenListeners();
    }

    // 播放上一集
    playPrevEpisode() {
        if (this.currentEpisodeIndex > 1) {
            const prevEpisode = this.allEpisodes.find(ep => ep.index === this.currentEpisodeIndex - 1);
            if (prevEpisode) {
                this.playEpisode(prevEpisode.index, prevEpisode.url);
            }
        }
    }

    // 播放下一集
    playNextEpisode() {
        if (this.currentEpisodeIndex < this.allEpisodes.length) {
            const nextEpisode = this.allEpisodes.find(ep => ep.index === this.currentEpisodeIndex + 1);
            if (nextEpisode) {
                this.playEpisode(nextEpisode.index, nextEpisode.url);
            }
        }
    }

    // 重试当前集
    retryCurrentEpisode() {
        const currentEpisode = this.allEpisodes.find(ep => ep.index === this.currentEpisodeIndex);
        if (currentEpisode) {
            this.playEpisode(currentEpisode.index, currentEpisode.url);
        }
    }

    // 更新集数控制按钮
    updateEpisodeControls() {
        const prevBtn = document.getElementById('prev-episode');
        const nextBtn = document.getElementById('next-episode');

        if (prevBtn) {
            prevBtn.disabled = this.currentEpisodeIndex <= 1;
        }

        if (nextBtn) {
            nextBtn.disabled = this.currentEpisodeIndex >= this.allEpisodes.length;
        }
    }

    // 更新剧集列表状态
    updateEpisodeList() {
        const episodeItems = document.querySelectorAll('.episode-item');
        episodeItems.forEach(item => {
            const episodeIndex = parseInt(item.dataset.episodeIndex);

            // 移除当前状态
            item.classList.remove('current');

            // 添加当前播放状态
            if (episodeIndex === this.currentEpisodeIndex) {
                item.classList.add('current');
            }
        });
    }

    // 处理键盘快捷键
    async handleKeyboard(e) {
        if (!this.video) return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                this.togglePlayPause();
                break;
            case 'F5':
                e.preventDefault();
                this.refreshVideo();
                break;
            case 'Enter':
                e.preventDefault();
                this.toggleDanmakuPanel();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                this.video.currentTime = Math.max(0, this.video.currentTime - 10);
                break;
            case 'ArrowRight':
                e.preventDefault();
                this.video.currentTime = Math.min(this.video.duration, this.video.currentTime + 10);
                break;
            case 'ArrowUp':
                e.preventDefault();
                this.video.volume = Math.min(1, this.video.volume + 0.1);
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.video.volume = Math.max(0, this.video.volume - 0.1);
                break;
            case 'KeyF':
                e.preventDefault();
                this.toggleFullscreen();
                break;
            case 'KeyE':
                e.preventDefault();
                this.toggleEpisodePanel();
                break;
            case 'KeyC':
                e.preventDefault();
                // 全屏模式下按C键显示/隐藏控制栏
                this.toggleControlsInFullscreen();
                break;
            case 'Escape':
                e.preventDefault();
                this.hideEpisodePanel();
                this.hideDanmakuPanel();
                break;
            case 'KeyT':
                e.preventDefault();
                await this.toggleAlwaysOnTop();
                break;
        }
    }

    // 切换全屏模式下的控制栏显示
    toggleControlsInFullscreen() {
        const overlay = document.getElementById('player-overlay');
        const isFullscreen = !!(document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement);

        if (isFullscreen && overlay) {
            if (overlay.classList.contains('show')) {
                // 当前显示，立即隐藏
                overlay.classList.remove('show');
                document.body.classList.remove('mouse-active');
                console.log('[PLAYER] 手动隐藏控制栏和鼠标');
            } else {
                // 当前隐藏，显示并设置3秒后自动隐藏
                overlay.classList.add('show');
                document.body.classList.add('mouse-active');
                console.log('[PLAYER] 手动显示控制栏和鼠标');

                // 3秒后自动隐藏
                setTimeout(() => {
                    if (!overlay.matches(':hover')) {
                        overlay.classList.remove('show');
                        document.body.classList.remove('mouse-active');
                        console.log('[PLAYER] 手动显示后3秒自动隐藏');
                    }
                }, 3000);
            }
        }
    }    // 切换窗口置顶状态
    async toggleAlwaysOnTop() {
        // 防止重复调用 - 如果正在切换中，直接返回
        if (this._isTogglingAlwaysOnTop) {
            console.log('[PLAYER] 置顶功能正在切换中，忽略重复调用');
            return;
        }

        this._isTogglingAlwaysOnTop = true;

        console.log('[PLAYER] ========== 开始置顶状态切换 ==========');

        try {
            if (window.electron && window.electron.window && window.electron.window.toggleAlwaysOnTop) {
                console.log('[PLAYER] 调用主进程置顶API...');

                const isAlwaysOnTop = await window.electron.window.toggleAlwaysOnTop();
                console.log(`[PLAYER] 主进程返回的置顶状态: ${isAlwaysOnTop}`);

                // 更新按钮状态
                const toggleBtn = document.getElementById('toggle-always-on-top');
                console.log(`[PLAYER] 找到置顶按钮元素: ${toggleBtn ? '是' : '否'}`);

                if (toggleBtn) {
                    // 清除旧样式
                    toggleBtn.classList.remove('active');
                    toggleBtn.style.background = '';
                    toggleBtn.style.transform = '';

                    // 直接更新按钮文本和标题，因为按钮结构是直接包含emoji的
                    toggleBtn.textContent = isAlwaysOnTop ? '🔒' : '📌';
                    toggleBtn.title = isAlwaysOnTop ? '取消置顶 (按T键快捷切换)' : '窗口置顶 (按T键快捷切换)';

                    if (isAlwaysOnTop) {
                        toggleBtn.classList.add('active');
                        // 更醒目的置顶状态显示
                        toggleBtn.style.background = 'rgba(76, 175, 80, 0.9)'; // 更鲜艳的绿色
                        toggleBtn.style.boxShadow = '0 0 12px rgba(76, 175, 80, 0.6)'; // 发光效果
                        toggleBtn.style.color = '#fff';
                        toggleBtn.style.transform = 'scale(1.15)';
                    } else {
                        toggleBtn.style.background = 'rgba(0, 0, 0, 0.7)';
                        toggleBtn.style.boxShadow = 'none';
                        toggleBtn.style.color = '#fff';
                        toggleBtn.style.transform = 'scale(1)';
                    }

                    console.log(`[PLAYER] 按钮状态已更新 - 图标: ${toggleBtn.textContent}, 标题: ${toggleBtn.title}`);
                }

                // 显示更明显的通知
                const message = isAlwaysOnTop ?
                    '🔝 窗口已置顶！' :
                    '📌 置顶已取消';

                this.showNotification(message, isAlwaysOnTop ? 'success' : 'info');

                // 额外的视觉反馈 - 在播放器界面上临时显示大字提示
                this.showLargeStatusMessage(
                    isAlwaysOnTop ? '🔒 已置顶' : '📌 已取消',
                    isAlwaysOnTop ? '#4caf50' : '#2196f3',
                    1500
                ); console.log(`[PLAYER] ========== 置顶状态切换完成: ${isAlwaysOnTop ? '已置顶' : '已取消'} ==========`);
                return isAlwaysOnTop;
            } else {
                console.error('[PLAYER] 置顶功能不可用 - Electron API未找到');
                this.showNotification('置顶功能不可用', 'error');
                return false;
            }
        } catch (error) {
            console.error('[PLAYER] 切换置顶状态失败:', error);
            this.showNotification(`置顶功能异常: ${error.message}`, 'error');
            return false;
        } finally {
            // 立即释放锁，让下次调用可以正常进行
            this._isTogglingAlwaysOnTop = false;
        }
    }

    // 在播放器界面显示大字状态消息
    showLargeStatusMessage(message, color, duration = 2000) {
        console.log(`[PLAYER] 显示大字状态消息: ${message}`);

        // 移除已存在的状态消息
        const existingMessage = document.querySelector('.large-status-message');
        if (existingMessage) {
            existingMessage.remove();
        }

        // 创建大字状态消息元素
        const statusMessage = document.createElement('div');
        statusMessage.className = 'large-status-message';
        statusMessage.textContent = message;

        Object.assign(statusMessage.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: color,
            color: '#fff',
            padding: '20px 40px',
            borderRadius: '12px',
            fontSize: '24px',
            fontWeight: 'bold',
            zIndex: '99999',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
            opacity: '0',
            transition: 'opacity 0.3s ease, transform 0.3s ease',
            textAlign: 'center',
            minWidth: '200px'
        });

        document.body.appendChild(statusMessage);

        // 动画显示
        requestAnimationFrame(() => {
            statusMessage.style.opacity = '1';
            statusMessage.style.transform = 'translate(-50%, -50%) scale(1.05)';
        });

        // 自动隐藏
        setTimeout(() => {
            statusMessage.style.opacity = '0';
            statusMessage.style.transform = 'translate(-50%, -50%) scale(0.95)';
            setTimeout(() => {
                if (statusMessage.parentNode) {
                    statusMessage.parentNode.removeChild(statusMessage);
                }
            }, 300);
        }, duration);
    }

    // 切换全屏
    toggleFullscreen() {
        const playerContainer = document.querySelector('.player-container');

        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            // 使用播放器容器进入全屏，而不是仅视频元素
            if (playerContainer && playerContainer.requestFullscreen) {
                playerContainer.requestFullscreen();
            } else if (playerContainer && playerContainer.webkitRequestFullscreen) {
                playerContainer.webkitRequestFullscreen();
            } else if (playerContainer && playerContainer.mozRequestFullScreen) {
                playerContainer.mozRequestFullScreen();
            } else {
                // 降级到视频元素全屏
                this.video.requestFullscreen();
            }
        }
    }

    // 更新全屏按钮图标
    updateFullscreenButton(isFullscreen) {
        const fullscreenBtn = document.getElementById('fullscreen-btn');
        if (fullscreenBtn) {
            const icon = fullscreenBtn.querySelector('.icon');
            if (icon) {
                icon.textContent = isFullscreen ? '⛶' : '⛶';
            }
            fullscreenBtn.title = isFullscreen ? '退出全屏' : '全屏';
        }
    }

    // 保存播放进度
    savePlaybackProgress() {
        if (!this.video || !this.videoData || !this.storageService) return;

        const currentTime = this.video.currentTime;
        const duration = this.video.duration;

        if (currentTime > 0 && duration > 0) {
            console.log('[PLAYER] 保存播放进度:', {
                vodId: this.videoData.vod_id,
                episode: this.currentEpisodeIndex,
                currentTime: Math.round(currentTime),
                duration: Math.round(duration),
                percentage: Math.round((currentTime / duration) * 100)
            });

            // 使用存储服务保存进度
            this.storageService.saveWatchProgress(
                this.videoData.vod_id,
                this.currentEpisodeIndex,
                currentTime,
                duration
            );
        }
    }

    // 恢复播放进度
    restorePlaybackProgress() {
        if (!this.video || !this.videoData) return;

        try {
            let progress = null;

            // 优先使用从历史记录传入的播放进度
            if (this.resumeProgress && this.resumeProgress > 10) {
                progress = {
                    currentTime: this.resumeProgress,
                    percentage: 0 // 百分比需要等视频加载完成后计算
                };
                console.log('[PLAYER] 使用历史记录播放进度:', progress.currentTime, 'seconds');
            } else {
                // 如果没有历史记录进度，尝试从存储中获取
                if (window.parent && window.parent.app && window.parent.app.storageService) {
                    progress = window.parent.app.storageService.getWatchProgress(
                        this.videoData.vod_id,
                        this.currentEpisodeIndex
                    );
                } else {
                    const progressKey = `progress_${this.videoData.vod_id}_${this.currentEpisodeIndex}`;
                    const saved = localStorage.getItem(progressKey);
                    if (saved) {
                        progress = JSON.parse(saved);
                    }
                }
            }

            if (progress && progress.currentTime > 10) {
                // 等待视频元数据加载完成后设置播放进度
                const setProgressWhenReady = () => {
                    if (this.video.duration && !isNaN(this.video.duration)) {
                        // 确保进度不超过视频总时长的90%
                        const maxTime = this.video.duration * 0.9;
                        const seekTime = Math.min(progress.currentTime, maxTime);

                        this.video.currentTime = seekTime;
                        console.log(`[PLAYER] 恢复播放进度: ${seekTime}s / ${this.video.duration}s (${Math.round((seekTime / this.video.duration) * 100)}%)`);

                        // 清除历史记录中的播放进度，避免重复使用
                        this.resumeProgress = null;
                    } else {
                        // 如果视频还没准备好，等待一段时间后重试
                        setTimeout(setProgressWhenReady, 500);
                    }
                };

                // 如果视频已经准备好，直接设置；否则等待
                if (this.video.readyState >= 1) {
                    setProgressWhenReady();
                } else {
                    this.video.addEventListener('loadedmetadata', setProgressWhenReady, { once: true });
                }
            }
        } catch (error) {
            console.warn('[PLAYER] 恢复播放进度失败:', error);
        }
    }

    // 标记集数为已观看
    markEpisodeWatched(episodeIndex) {
        const watchedKey = `watched_${this.videoData.vod_id}_${episodeIndex}`;
        localStorage.setItem(watchedKey, 'true');

        // 更新界面
        const episodeItem = document.querySelector(`[data-episode-index="${episodeIndex}"]`);
        if (episodeItem) {
            episodeItem.classList.add('watched');
        }
    }

    // 检查集数是否已观看
    isEpisodeWatched(episodeIndex) {
        const watchedKey = `watched_${this.videoData.vod_id}_${episodeIndex}`;
        return localStorage.getItem(watchedKey) === 'true';
    }

    // 记录播放历史
    recordPlayback(episodeIndex, episodeUrl) {
        console.log('[PLAYER] 记录播放历史:', {
            视频ID: this.videoData.vod_id,
            集数索引: episodeIndex,
            URL: episodeUrl
        });

        // 保存到内部播放历史数组
        this.playbackHistory.push({
            videoId: this.videoData.vod_id,
            episodeIndex,
            episodeUrl,
            timestamp: Date.now()
        });

        // 限制历史记录长度
        if (this.playbackHistory.length > 50) {
            this.playbackHistory = this.playbackHistory.slice(-50);
        }

        // 更新全局播放历史记录
        if (this.storageService && this.videoData) {
            try {
                // 查找当前剧集信息
                const currentRoute = this.allRoutes[this.currentRouteIndex];
                const currentEpisode = this.allEpisodes.find(ep => ep.index === episodeIndex);

                // 获取当前活跃站点信息
                let siteName = '未知站点';
                if (window.parent && window.parent.app && window.parent.app.apiService) {
                    const activeSite = window.parent.app.apiService.getActiveSite();
                    siteName = activeSite ? activeSite.name : '未知站点';
                }

                // 更新播放历史
                const historyData = {
                    vod_id: this.videoData.vod_id,
                    vod_name: this.videoData.vod_name,
                    vod_pic: this.videoData.vod_pic,
                    type_name: this.videoData.type_name || '未知类型',
                    current_episode: episodeIndex,
                    episode_name: currentEpisode?.name || `第${episodeIndex}集`,
                    site_name: siteName
                };

                console.log('[PLAYER] 更新播放历史数据:', historyData);
                this.storageService.addPlayHistory(historyData);
                console.log('[PLAYER] 播放历史已更新');
            } catch (error) {
                console.error('[PLAYER] 更新播放历史失败:', error);
            }
        } else {
            console.warn('[PLAYER] 存储服务不可用，无法更新播放历史');
        }
    }

    // 显示加载状态
    showLoading() {
        const loading = document.getElementById('player-loading');
        const error = document.getElementById('player-error');

        if (loading) loading.classList.remove('hidden');
        if (error) error.classList.add('hidden');
    }

    // 隐藏加载状态
    hideLoading() {
        const loading = document.getElementById('player-loading');
        if (loading) loading.classList.add('hidden');
    }

    // 显示错误信息
    showError(message) {
        const loading = document.getElementById('player-loading');
        const error = document.getElementById('player-error');

        if (loading) loading.classList.add('hidden');
        if (error) {
            error.classList.remove('hidden');
            const errorMsg = error.querySelector('p');
            if (errorMsg) errorMsg.textContent = message;
        }
    }

    // 关闭播放器
    closePlayer() {
        if (window.electron && window.electron.ipcRenderer) {
            window.electron.ipcRenderer.invoke('close-player');
        } else {
            console.error('[PLAYER] 无法关闭播放器 - Electron IPC 不可用');
            window.close(); // 备用方案
        }
    }

    // 设置自定义播放控制栏
    setupPlaybackControls() {
        if (!this.video) return;

        // 播放/暂停按钮
        const playPauseBtn = document.getElementById('play-pause-btn');
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => {
                this.togglePlayPause();
            });
        }

        // 全屏按钮
        const fullscreenBtn = document.getElementById('fullscreen-btn');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => {
                this.toggleFullscreen();
            });
        }

        // 音量按钮
        const volumeBtn = document.getElementById('volume-btn');
        if (volumeBtn) {
            volumeBtn.addEventListener('click', () => {
                this.toggleMute();
            });
        }

        // 进度条控制
        this.setupProgressBar();

        // 音量条控制
        this.setupVolumeBar();

        // 更新时间显示和进度条
        this.video.addEventListener('timeupdate', () => {
            this.updateProgressDisplay();
        });

        // 视频加载完成时更新总时长
        this.video.addEventListener('loadedmetadata', () => {
            this.updateDurationDisplay();
        });

        // 播放状态改变时更新按钮
        this.video.addEventListener('play', () => {
            this.updatePlayPauseButton(true);
        });

        this.video.addEventListener('pause', () => {
            this.updatePlayPauseButton(false);
        });

        // 音量变化时更新音量按钮和进度条
        this.video.addEventListener('volumechange', () => {
            this.updateVolumeDisplay();
        });
    }

    // 初始化控制栏状态
    initializeControlsState() {
        // 设置默认音量
        if (this.video) {
            this.video.volume = 0.8; // 设置为80%音量
            this.video.playbackRate = 1.0; // 设置默认播放速度
        }

        // 确保右上角按钮始终显示
        const topRightControls = document.querySelector('.top-right-controls');
        if (topRightControls) {
            topRightControls.style.display = 'flex';
            topRightControls.style.visibility = 'visible';
            topRightControls.style.opacity = '1';
            topRightControls.style.zIndex = '1000';
            console.log('[PLAYER] 初始化右上角按钮显示');
        }

        // 初始化显示状态
        setTimeout(() => {
            this.updatePlayPauseButton(false); // 初始为暂停状态
            this.updateVolumeDisplay();
            this.updateVolumeButton();
            this.updateFullscreenButton(false);
            this.updateDurationDisplay();
            this.updatePlaybackSpeedButton(1.0); // 初始化播放速度显示
        }, 100);
    }

    // 切换播放/暂停
    togglePlayPause() {
        if (this.video.paused) {
            this.video.play();
        } else {
            this.video.pause();
        }
    }

    // 切换静音
    toggleMute() {
        this.video.muted = !this.video.muted;
    }

    // 播放速度控制
    cyclePlaybackSpeed() {
        if (!this.video) return;

        const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        const currentSpeed = this.video.playbackRate;
        let nextIndex = speeds.indexOf(currentSpeed) + 1;

        if (nextIndex >= speeds.length) {
            nextIndex = 0;
        }

        const newSpeed = speeds[nextIndex];
        this.video.playbackRate = newSpeed;

        // 更新按钮显示
        this.updatePlaybackSpeedButton(newSpeed);

        console.log('[PLAYER] 播放速度设置为:', newSpeed + 'x');
    }

    // 更新播放速度按钮显示
    updatePlaybackSpeedButton(speed) {
        const speedBtn = document.getElementById('playback-speed');
        if (speedBtn) {
            const icon = speedBtn.querySelector('.icon');
            if (icon) {
                icon.textContent = speed + 'x';
            }
            speedBtn.title = '播放速度: ' + speed + 'x';
        }
    }

    // 刷新视频
    refreshVideo() {
        if (!this.video || !this.currentRouteUrl) return;

        const currentTime = this.video.currentTime;
        console.log('[PLAYER] 刷新视频，当前时间:', currentTime);

        // 重新加载视频
        this.loadVideo(this.currentRouteUrl, this.currentEpisodeIndex);

        // 延迟恢复播放位置
        setTimeout(() => {
            if (this.video && currentTime > 0) {
                this.video.currentTime = currentTime;
                console.log('[PLAYER] 恢复播放位置:', currentTime);
            }
        }, 1000);
    }

    // 更新播放/暂停按钮
    updatePlayPauseButton(isPlaying) {
        const playPauseBtn = document.getElementById('play-pause-btn');
        if (playPauseBtn) {
            const icon = playPauseBtn.querySelector('.icon');
            if (icon) {
                icon.textContent = isPlaying ? '⏸️' : '▶️';
            }
            playPauseBtn.title = isPlaying ? '暂停' : '播放';
        }
    }

    // 更新音量按钮
    updateVolumeButton() {
        const volumeBtn = document.getElementById('volume-btn');
        if (volumeBtn) {
            const icon = volumeBtn.querySelector('.icon');
            if (icon) {
                if (this.video.muted || this.video.volume === 0) {
                    icon.textContent = '🔇';
                    volumeBtn.title = '取消静音';
                } else if (this.video.volume < 0.5) {
                    icon.textContent = '🔉';
                    volumeBtn.title = '静音';
                } else {
                    icon.textContent = '🔊';
                    volumeBtn.title = '静音';
                }
            }
        }
        // 更新音量条显示
        this.updateVolumeDisplay();
    }

    // 更新时间显示和进度条
    updateProgressDisplay() {
        const currentTime = this.video.currentTime;
        const duration = this.video.duration || 0;

        // 更新时间显示
        const currentTimeElement = document.getElementById('current-time');
        if (currentTimeElement) {
            currentTimeElement.textContent = this.formatTime(currentTime);
        }

        // 更新进度条
        const progressFill = document.getElementById('progress-fill');
        const progressHandle = document.getElementById('progress-handle');
        if (progressFill && progressHandle && duration > 0) {
            const percentage = (currentTime / duration) * 100;
            progressFill.style.width = percentage + '%';
            progressHandle.style.left = percentage + '%';
        }
    }

    // 更新总时长显示
    updateDurationDisplay() {
        const duration = this.video.duration || 0;
        const totalTimeElement = document.getElementById('total-time');
        if (totalTimeElement) {
            totalTimeElement.textContent = this.formatTime(duration);
        }
    }

    // 更新音量显示
    updateVolumeDisplay() {
        const volumeBtn = document.getElementById('volume-btn');
        const volumeFill = document.getElementById('volume-fill');
        const volumeHandle = document.getElementById('volume-handle');

        // 更新音量按钮图标
        if (volumeBtn) {
            const icon = volumeBtn.querySelector('.icon');
            if (icon) {
                if (this.video.muted || this.video.volume === 0) {
                    icon.textContent = '🔇';
                } else if (this.video.volume < 0.5) {
                    icon.textContent = '🔉';
                } else {
                    icon.textContent = '🔊';
                }
            }
        }

        // 更新音量条
        if (volumeFill && volumeHandle) {
            const volume = this.video.muted ? 0 : this.video.volume;
            const percentage = volume * 100;
            volumeFill.style.width = percentage + '%';
            volumeHandle.style.left = percentage + '%';
        }
    }

    // 设置进度条控制
    setupProgressBar() {
        const progressBar = document.getElementById('progress-bar');
        const progressHandle = document.getElementById('progress-handle');

        console.log('[PLAYER] 查找进度条元素...');
        console.log('[PLAYER] 进度条元素:', progressBar);
        console.log('[PLAYER] 进度条手柄元素:', progressHandle);

        if (!progressBar || !progressHandle) {
            console.error('[PLAYER] 进度条元素未找到 - progressBar:', progressBar, 'progressHandle:', progressHandle);
            return;
        }

        let isDragging = false;
        console.log('[PLAYER] 进度条控制初始化成功');

        // 创建时间预览元素
        let timePreview = progressBar.querySelector('.progress-preview');
        if (!timePreview) {
            timePreview = document.createElement('div');
            timePreview.className = 'progress-preview';
            timePreview.textContent = '00:00'; // 默认文本用于调试
            progressBar.appendChild(timePreview);
            console.log('[PLAYER] 创建时间预览元素:', timePreview);
        } else {
            console.log('[PLAYER] 时间预览元素已存在:', timePreview);
        }

        // 检查进度条的位置和大小
        const progressBarRect = progressBar.getBoundingClientRect();
        console.log('[PLAYER] 进度条位置和大小:', progressBarRect);

        // 立即测试显示时间预览（调试用）- 已移除调试代码
        /*
        setTimeout(() => {
            if (timePreview) {
                timePreview.style.cssText = `
                    position: absolute !important;
                    bottom: 100% !important;
                    left: 50% !important;
                    transform: translateX(-50%) !important;
                    background: red !important;
                    color: white !important;
                    padding: 4px 8px !important;
                    border-radius: 4px !important;
                    font-size: 12px !important;
                    white-space: nowrap !important;
                    z-index: 99999 !important;
                    pointer-events: none !important;
                    margin-bottom: 8px !important;
                    display: block !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                `;
                console.log('[PLAYER] 强制显示时间预览元素（红色调试版本）');
                console.log('[PLAYER] 时间预览父元素:', timePreview.parentElement);
                console.log('[PLAYER] 时间预览样式:', timePreview.style.cssText);
                
                // 检查时间预览的位置
                const previewRect = timePreview.getBoundingClientRect();
                console.log('[PLAYER] 时间预览位置和大小:', previewRect);
            }
        }, 2000); // 延长到2秒，确保其他样式加载完成
        */        const updateProgress = (e) => {
            if (!this.video || !this.video.duration) return;

            const rect = progressBar.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
            const newTime = (percentage / 100) * this.video.duration;

            if (!isNaN(newTime)) {
                this.video.currentTime = newTime;
                console.log('[PLAYER] 进度条拖动到:', newTime.toFixed(2), '秒');
            }
        };

        const showTimePreview = (e) => {
            if (!this.video || !this.video.duration) {
                console.log('[PLAYER] 无法显示时间预览：视频未加载或无时长');
                return;
            }

            const rect = progressBar.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
            const previewTime = (percentage / 100) * this.video.duration;

            if (!isNaN(previewTime)) {
                const minutes = Math.floor(previewTime / 60);
                const seconds = Math.floor(previewTime % 60);
                timePreview.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                timePreview.style.cssText = `
                    position: absolute !important;
                    bottom: 100% !important;
                    left: ${percentage}% !important;
                    transform: translateX(-50%) !important;
                    background: rgba(0, 0, 0, 0.9) !important;
                    color: white !important;
                    padding: 4px 8px !important;
                    border-radius: 4px !important;
                    font-size: 12px !important;
                    white-space: nowrap !important;
                    z-index: 10000 !important;
                    pointer-events: none !important;
                    margin-bottom: 8px !important;
                    display: block !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                `;
                console.log('[PLAYER] 显示时间预览:', timePreview.textContent, '位置:', percentage + '%', '元素:', timePreview);
            }
        };

        const hideTimePreview = () => {
            timePreview.style.cssText = `
                position: absolute !important;
                bottom: 100% !important;
                left: 50% !important;
                transform: translateX(-50%) !important;
                background: rgba(0, 0, 0, 0.9) !important;
                color: white !important;
                padding: 4px 8px !important;
                border-radius: 4px !important;
                font-size: 12px !important;
                white-space: nowrap !important;
                z-index: 10000 !important;
                pointer-events: none !important;
                margin-bottom: 8px !important;
                display: none !important;
                opacity: 0 !important;
                visibility: hidden !important;
            `;
            console.log('[PLAYER] 隐藏时间预览');
        };

        // 鼠标悬停显示时间预览 - 阻止事件冒泡避免与悬浮控制栏冲突
        progressBar.addEventListener('mousemove', (e) => {
            e.stopPropagation(); // 阻止冒泡到播放器容器
            showTimePreview(e);
        });
        progressBar.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
            showTimePreview(e);
        });
        progressBar.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
            hideTimePreview();
        });

        // 点击进度条跳转
        progressBar.addEventListener('click', (e) => {
            console.log('[PLAYER] 进度条被点击');
            updateProgress(e);
        });

        // 拖拽开始
        progressHandle.addEventListener('mousedown', (e) => {
            console.log('[PLAYER] 开始拖拽进度条');
            isDragging = true;
            progressBar.classList.add('dragging');
            e.preventDefault();
            e.stopPropagation();
        });

        // 拖拽过程
        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                updateProgress(e);
            }
        });

        // 拖拽结束
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                console.log('[PLAYER] 结束拖拽进度条');
                isDragging = false;
                progressBar.classList.remove('dragging');
            }
        });

        // 确保进度条可以接收鼠标事件
        progressBar.style.pointerEvents = 'auto';
        progressHandle.style.pointerEvents = 'auto';
    }

    // 设置音量条控制
    setupVolumeBar() {
        const volumeBar = document.getElementById('volume-bar');
        const volumeHandle = document.getElementById('volume-handle');

        if (!volumeBar || !volumeHandle) return;

        let isDragging = false;

        const updateVolume = (e) => {
            const rect = volumeBar.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
            const newVolume = percentage / 100;

            this.video.volume = newVolume;
            this.video.muted = newVolume === 0;
        };

        volumeBar.addEventListener('click', updateVolume);

        volumeHandle.addEventListener('mousedown', (e) => {
            isDragging = true;
            volumeBar.classList.add('dragging');
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                updateVolume(e);
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                volumeBar.classList.remove('dragging');
            }
        });
    }

    // 格式化时间显示
    formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';

        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);

        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    // 设置悬浮控制栏 - 统一的鼠标和控制栏管理
    setupOverlayControls() {
        const playerContainer = document.querySelector('.player-container');
        const overlay = document.getElementById('player-overlay');

        if (!playerContainer || !overlay) return;

        let hideTimer = null;

        const showOverlay = () => {
            // 始终显示鼠标和控制栏（全屏和窗口模式统一）
            document.body.classList.add('mouse-active');
            overlay.classList.add('show');

            if (hideTimer) {
                clearTimeout(hideTimer);
            }

            // 3秒后自动隐藏
            hideTimer = setTimeout(() => {
                if (!overlay.matches(':hover')) {
                    document.body.classList.remove('mouse-active');
                    overlay.classList.remove('show');
                }
            }, 3000);
        };

        const hideOverlay = () => {
            if (hideTimer) {
                clearTimeout(hideTimer);
            }
            // 如果鼠标不在控制栏上，立即隐藏
            if (!overlay.matches(':hover')) {
                document.body.classList.remove('mouse-active');
                overlay.classList.remove('show');
            }
        };

        playerContainer.addEventListener('mousemove', showOverlay);
        playerContainer.addEventListener('mouseleave', hideOverlay);
        overlay.addEventListener('mouseenter', () => {
            if (hideTimer) {
                clearTimeout(hideTimer);
            }
        });
        overlay.addEventListener('mouseleave', () => {
            // 鼠标离开控制栏后，3秒后隐藏
            hideTimer = setTimeout(() => {
                document.body.classList.remove('mouse-active');
                overlay.classList.remove('show');
            }, 3000);
        });

        // 调试：检查右上角按钮状态 - 已移除强制显示调试代码
        const topRightControls = document.querySelector('.top-right-controls');
        console.log('[PLAYER] 悬浮控制栏初始化完成');
        console.log('[PLAYER] 右上角按钮元素:', topRightControls);
        if (topRightControls) {
            const style = window.getComputedStyle(topRightControls);
            console.log('[PLAYER] 右上角按钮计算样式:');
            console.log('- display:', style.display);
            console.log('- opacity:', style.opacity);
            console.log('- visibility:', style.visibility);
            console.log('- z-index:', style.zIndex);
            console.log('- position:', style.position);
            console.log('- top:', style.top);
            console.log('- right:', style.right);

            // 测试：立即显示右上角按钮（无红色背景）
            setTimeout(() => {
                overlay.classList.add('show');
                console.log('[PLAYER] 测试：手动添加show类到overlay');

                // 检查show类是否生效
                const hasShow = overlay.classList.contains('show');
                console.log('[PLAYER] overlay是否有show类:', hasShow);

                const afterStyle = window.getComputedStyle(topRightControls);
                console.log('[PLAYER] 添加show类后的样式:');
                console.log('- opacity:', afterStyle.opacity);
                console.log('- visibility:', afterStyle.visibility);
            }, 2000);
        }
    }    // 设置全屏状态监听器
    setupFullscreenListeners() {
        const playerContainer = document.querySelector('.player-container');
        const overlay = document.getElementById('player-overlay');
        const danmakuInputContainer = document.getElementById('danmaku-input-container');
        const episodePanel = document.getElementById('episode-panel');
        const topRightControls = document.querySelector('.top-right-controls');

        // 全屏状态变化监听
        const handleFullscreenChange = () => {
            const isFullscreen = !!(document.fullscreenElement ||
                document.webkitFullscreenElement ||
                document.mozFullScreenElement);

            console.log('[PLAYER] 全屏状态变化:', isFullscreen);
            console.log('[PLAYER] 当前全屏元素:', document.fullscreenElement);

            // 更新全屏按钮图标
            this.updateFullscreenButton(isFullscreen);

            if (isFullscreen) {
                // 进入全屏状态
                document.body.classList.add('fullscreen-mode');
                console.log('[PLAYER] 添加fullscreen-mode类');

                // 确保右上角按钮在全屏时显示
                if (topRightControls) {
                    topRightControls.style.display = 'flex';
                    topRightControls.style.visibility = 'visible';
                    topRightControls.style.opacity = '1';
                    topRightControls.style.zIndex = '1001';
                    console.log('[PLAYER] 全屏时显示右上角按钮');
                }

                // 立即显示一次控制栏，让用户知道控制栏还在
                if (overlay) {
                    overlay.classList.add('show');
                    document.body.classList.add('mouse-active');
                    console.log('[PLAYER] 进入全屏，显示控制栏');

                    // 3秒后自动隐藏（如果鼠标不在控制栏上）
                    setTimeout(() => {
                        if (!overlay.matches(':hover')) {
                            overlay.classList.remove('show');
                            document.body.classList.remove('mouse-active');
                            console.log('[PLAYER] 自动隐藏控制栏和鼠标');
                        }
                    }, 3000);
                }
            } else {
                // 退出全屏状态
                document.body.classList.remove('fullscreen-mode');
                console.log('[PLAYER] 移除fullscreen-mode类');

                // 恢复右上角按钮的正常显示
                if (topRightControls) {
                    topRightControls.style.display = 'flex';
                    topRightControls.style.visibility = 'visible';
                    topRightControls.style.opacity = '1';
                    topRightControls.style.zIndex = '1000';
                    console.log('[PLAYER] 退出全屏，恢复右上角按钮');
                }

                // 退出全屏后立即显示鼠标和控制栏
                document.body.classList.add('mouse-active');
                if (overlay) {
                    overlay.classList.add('show');
                }
            }
        };        // 添加全屏状态变化监听器
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('mozfullscreenchange', handleFullscreenChange);
        document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    }

    // 切换选集面板显示状态
    toggleEpisodePanel() {
        const panel = document.getElementById('episode-panel');
        if (panel) {
            if (panel.classList.contains('show')) {
                this.hideEpisodePanel();
            } else {
                this.showEpisodePanel();
            }
        }
    }

    // 显示选集面板
    showEpisodePanel() {
        const panel = document.getElementById('episode-panel');
        if (panel) {
            panel.classList.add('show');

            // 检查是否是全屏状态，如果是则提升z-index
            const isFullscreen = document.fullscreenElement ||
                document.webkitFullscreenElement ||
                document.mozFullScreenElement ||
                document.msFullscreenElement ||
                document.body.classList.contains('fullscreen-mode');

            if (isFullscreen) {
                console.log('[PLAYER] 全屏状态下显示选集面板');
                panel.style.zIndex = '99999';
                panel.style.position = 'fixed';
            } else {
                panel.style.zIndex = '';
                panel.style.position = '';
            }

            console.log('[PLAYER] 选集面板已显示');
        } else {
            console.error('[PLAYER] 未找到选集面板元素');
        }
    }

    // 隐藏选集面板
    hideEpisodePanel() {
        const panel = document.getElementById('episode-panel');
        if (panel) {
            panel.classList.remove('show');
        }
    }

    // 切换弹幕面板显示状态
    toggleDanmakuPanel() {
        const panel = document.getElementById('danmaku-input-container');
        if (panel) {
            console.log('[PLAYER] 弹幕面板切换 - 当前状态:', {
                hasHiddenClass: panel.classList.contains('hidden'),
                classList: Array.from(panel.classList),
                computedDisplay: getComputedStyle(panel).display,
                visibility: getComputedStyle(panel).visibility
            });

            if (panel.classList.contains('hidden')) {
                console.log('[PLAYER] 显示弹幕面板');
                this.showDanmakuPanel();
            } else {
                console.log('[PLAYER] 隐藏弹幕面板');
                this.hideDanmakuPanel();
            }

            // 切换后再次检查状态
            setTimeout(() => {
                console.log('[PLAYER] 弹幕面板切换后状态:', {
                    hasHiddenClass: panel.classList.contains('hidden'),
                    classList: Array.from(panel.classList),
                    computedDisplay: getComputedStyle(panel).display,
                    visibility: getComputedStyle(panel).visibility
                });
            }, 100);
        } else {
            console.error('[PLAYER] 弹幕面板元素未找到');
        }
    }

    // 显示弹幕面板
    showDanmakuPanel() {
        const panel = document.getElementById('danmaku-input-container');
        if (panel) {
            console.log('[PLAYER] 执行显示弹幕面板 - 移除hidden类');
            panel.classList.remove('hidden');

            // 强制设置显示样式作为备用
            panel.style.display = 'block';

            // 更新按钮状态
            this.updateDanmakuButtonState(true);

            // 焦点到输入框
            const input = document.getElementById('danmaku-input');
            if (input) {
                setTimeout(() => input.focus(), 100);
            }
        } else {
            console.error('[PLAYER] showDanmakuPanel: 弹幕面板元素未找到');
        }
    }

    // 隐藏弹幕面板
    hideDanmakuPanel() {
        const panel = document.getElementById('danmaku-input-container');
        if (panel) {
            console.log('[PLAYER] 执行隐藏弹幕面板 - 添加hidden类');
            panel.classList.add('hidden');

            // 移除强制显示样式
            panel.style.display = '';

            // 更新按钮状态
            this.updateDanmakuButtonState(false);
        } else {
            console.error('[PLAYER] hideDanmakuPanel: 弹幕面板元素未找到');
        }
    }

    // 更新弹幕按钮状态
    updateDanmakuButtonState(isPanelVisible) {
        const btn = document.getElementById('toggle-danmaku');
        if (btn) {
            const icon = btn.querySelector('.icon');
            if (isPanelVisible) {
                // 面板显示时：显示关闭图标和相应提示
                icon.textContent = '❌';
                btn.title = '关闭弹幕设置面板';
                btn.classList.add('active');
            } else {
                // 面板隐藏时：显示设置图标和相应提示
                icon.textContent = '⚙️';
                btn.title = '显示弹幕设置面板';
                btn.classList.remove('active');
            }
        }
    }

    // 切换弹幕显示状态
    toggleDanmakuDisplay(enabled) {
        if (window.danmakuSystem) {
            if (enabled) {
                window.danmakuSystem.show();
                console.log('[PLAYER] 弹幕显示已启用');
            } else {
                window.danmakuSystem.hide();
                console.log('[PLAYER] 弹幕显示已禁用');
            }
        }
    }

    // 更改弹幕类型
    changeDanmakuType(type) {
        this.danmakuType = type;

        // 如果使用增强弹幕系统，同步更新其模式
        if (window.danmakuSystem && typeof window.danmakuSystem.danmakuMode !== 'undefined') {
            window.danmakuSystem.danmakuMode = type;
            console.log('[PLAYER] 增强弹幕系统模式已同步为:', type);

            // 如果有保存设置的方法，也调用它
            if (typeof window.danmakuSystem.saveDanmakuMode === 'function') {
                window.danmakuSystem.saveDanmakuMode();
            }
        }

        console.log('[PLAYER] 弹幕类型已切换为:', type === 'realtime' ? '实时弹幕' : '时间轴弹幕');
    }

    // 发送弹幕
    sendDanmaku() {
        const input = document.getElementById('danmaku-input');
        const colorSelect = document.getElementById('danmaku-color');
        const sizeSelect = document.getElementById('danmaku-size');
        const typeSelect = document.getElementById('danmaku-type');

        if (!input || !input.value.trim()) return;

        const danmakuData = {
            text: input.value.trim(),
            color: colorSelect?.value || '#ffffff',
            size: sizeSelect?.value || 'medium',
            type: typeSelect?.value || 'realtime',
            time: typeSelect?.value === 'timeline' ? this.video?.currentTime || 0 : Date.now()
        };

        if (window.danmakuSystem) {
            if (typeSelect?.value === 'timeline') {
                // 时间轴弹幕 - 绑定到当前播放时间
                window.danmakuSystem.addTimelineDanmaku({
                    ...danmakuData,
                    time: this.video?.currentTime || 0
                });
                console.log('[PLAYER] 发送时间轴弹幕:', danmakuData);
            } else {
                // 实时弹幕
                window.danmakuSystem.addDanmaku(danmakuData);
                console.log('[PLAYER] 发送实时弹幕:', danmakuData);
            }

            // 清空输入框
            input.value = '';

            // 发送弹幕后关闭面板
            this.hideDanmakuPanel();
            console.log('[PLAYER] 弹幕发送成功，已关闭设置面板');
        } else {
            console.warn('[PLAYER] 弹幕系统未初始化');
        }
    }

    // 清理资源
    cleanup() {
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        if (this.video) {
            this.video.src = '';
            this.video.load();
        }

        // 清理弹幕
        if (window.danmakuSystem) {
            window.danmakuSystem.clearDanmaku();
        }

        // 清理网页播放器
        this.cleanupWebPage();
    }

    // 投屏功能 - 切换投屏状态
    async toggleCasting() {
        try {
            if (this.isCasting) {
                // 当前正在投屏，停止投屏
                await this.stopCasting();
            } else {
                // 当前未投屏，开始投屏
                await this.startCasting();
            }
        } catch (error) {
            console.error('[PLAYER] 投屏操作失败:', error);
            this.showNotification('投屏操作失败: ' + error.message, 'error');
        }
    }

    // 开始投屏
    async startCasting() {
        console.log('[PLAYER] 显示投屏设备选择对话框...');

        try {
            // 显示设备选择对话框
            this.showCastDeviceModal();

        } catch (error) {
            console.error('[PLAYER] 显示投屏设备选择失败:', error);
            this.showNotification('投屏设备选择失败: ' + error.message, 'error');
        }
    }

    // 显示投屏设备选择对话框
    showCastDeviceModal() {
        const modal = document.getElementById('cast-device-modal');
        if (!modal) {
            console.error('[PLAYER] 找不到投屏设备选择对话框');
            return;
        }

        // 显示对话框
        modal.classList.add('show');

        // 重置状态
        this.resetCastModal();

        // 开始搜索设备
        this.startDeviceDiscovery();

        // 绑定事件监听器
        this.setupCastModalEvents();
    }

    // 重置投屏对话框状态
    resetCastModal() {
        const scanning = document.getElementById('cast-scanning');
        const deviceList = document.getElementById('cast-device-list');
        const noDevices = document.getElementById('cast-no-devices');

        if (scanning) scanning.style.display = 'block';
        if (deviceList) {
            deviceList.style.display = 'none';
            deviceList.innerHTML = '';
        }
        if (noDevices) noDevices.style.display = 'none';
    }

    // 设置投屏对话框事件监听器
    setupCastModalEvents() {
        const modal = document.getElementById('cast-device-modal');
        const closeBtn = document.getElementById('cast-modal-close');
        const cancelBtn = document.getElementById('cast-cancel-btn');
        const manualBtn = document.getElementById('btn-manual-cast');
        const refreshBtn = document.getElementById('btn-refresh-devices');
        const backdrop = modal?.querySelector('.cast-modal-backdrop');

        // 关闭按钮
        if (closeBtn) {
            closeBtn.onclick = () => this.hideCastDeviceModal();
        }

        // 取消按钮
        if (cancelBtn) {
            cancelBtn.onclick = () => this.hideCastDeviceModal();
        }

        // 背景点击关闭
        if (backdrop) {
            backdrop.onclick = () => this.hideCastDeviceModal();
        }

        // 手动投屏按钮
        if (manualBtn) {
            manualBtn.onclick = async () => {
                this.hideCastDeviceModal();
                await this.startManualCasting();
            };
        }

        // 刷新设备按钮
        if (refreshBtn) {
            refreshBtn.onclick = () => {
                this.resetCastModal();
                this.startDeviceDiscovery();
            };
        }

        // ESC 键关闭
        document.addEventListener('keydown', this.handleCastModalKeydown);
    }

    // 处理对话框键盘事件
    handleCastModalKeydown = (e) => {
        if (e.key === 'Escape') {
            this.hideCastDeviceModal();
        }
    }

    // 隐藏投屏设备选择对话框
    hideCastDeviceModal() {
        const modal = document.getElementById('cast-device-modal');
        if (modal) {
            modal.classList.remove('show');
        }

        // 移除键盘事件监听器
        document.removeEventListener('keydown', this.handleCastModalKeydown);
    }

    // 开始设备发现
    async startDeviceDiscovery() {
        console.log('[PLAYER] 开始搜索投屏设备...');

        const scanning = document.getElementById('cast-scanning');
        const deviceList = document.getElementById('cast-device-list');
        const noDevices = document.getElementById('cast-no-devices');
        const refreshBtn = document.getElementById('btn-refresh-devices');

        try {
            // 显示搜索中状态
            if (scanning) scanning.style.display = 'block';
            if (deviceList) deviceList.style.display = 'none';
            if (noDevices) noDevices.style.display = 'none';

            // 真实设备搜索
            const devices = await this.discoverCastDevices();

            if (scanning) scanning.style.display = 'none';

            if (devices && devices.length > 0) {
                console.log(`[PLAYER] 发现 ${devices.length} 个投屏设备`);
                // 显示设备列表
                this.displayCastDevices(devices);
                if (deviceList) deviceList.style.display = 'block';
                if (noDevices) noDevices.style.display = 'none';
            } else {
                console.log('[PLAYER] 未发现任何投屏设备');
                // 显示无设备状态
                if (deviceList) deviceList.style.display = 'none';
                if (noDevices) noDevices.style.display = 'block';

                // 绑定刷新按钮事件
                if (refreshBtn) {
                    refreshBtn.onclick = () => this.startDeviceDiscovery();
                }
            }

        } catch (error) {
            console.error('[PLAYER] 设备搜索失败:', error);
            if (scanning) scanning.style.display = 'none';
            if (deviceList) deviceList.style.display = 'none';
            if (noDevices) noDevices.style.display = 'block';

            // 绑定刷新按钮事件
            if (refreshBtn) {
                refreshBtn.onclick = () => this.startDeviceDiscovery();
            }
        }
    }

    // 发现投屏设备（真实实现）
    async discoverCastDevices() {
        console.log('[PLAYER] 开始真实DLNA设备发现...');
        const devices = [];

        try {
            // 1. 调用主进程的DLNA设备发现
            if (window.electron && window.electron.ipcRenderer) {
                console.log('[PLAYER] 调用主进程DLNA设备发现...');
                try {
                    const dlnaDevices = await window.electron.ipcRenderer.invoke('discover-cast-devices');
                    if (dlnaDevices && dlnaDevices.length > 0) {
                        console.log(`[PLAYER] 发现 ${dlnaDevices.length} 个DLNA设备:`, dlnaDevices);
                        devices.push(...dlnaDevices);
                    } else {
                        console.log('[PLAYER] 未发现DLNA设备');
                    }
                } catch (error) {
                    console.warn('[PLAYER] DLNA设备发现失败:', error);
                }
            }

            // 2. 如果没有发现DLNA设备，尝试浏览器 Presentation API
            if (devices.length === 0) {
                console.log('[PLAYER] 尝试浏览器 Presentation API...');
                if (navigator.presentation && navigator.presentation.getAvailability) {
                    try {
                        const presentationDevices = await this.discoverPresentationDevices();
                        devices.push(...presentationDevices);
                    } catch (error) {
                        console.warn('[PLAYER] Presentation API 失败:', error);
                    }
                }
            }

            // 3. 添加手动投屏选项
            if (devices.length === 0) {
                devices.push({
                    id: 'manual_cast',
                    name: '手动投屏 (系统默认)',
                    type: '系统投屏',
                    icon: '🖥️',
                    status: 'available',
                    protocol: 'system'
                });
            }

            console.log(`[PLAYER] 设备发现完成，找到 ${devices.length} 个设备:`, devices);
            return devices;

        } catch (error) {
            console.error('[PLAYER] 设备发现过程出错:', error);
            return devices; // 返回已发现的设备
        }
    }

    // 使用 Presentation API 发现设备
    async discoverPresentationDevices() {
        const devices = [];

        try {
            // 创建 Presentation Request 来触发设备发现
            const testUrl = 'data:text/html,<h1>Test Cast</h1>';
            const request = new PresentationRequest([testUrl]);

            // 监听设备可用性
            const availability = await request.getAvailability();

            if (availability.value) {
                // 有可用设备，但 Presentation API 不直接提供设备列表
                // 我们创建一个通用的 Chromecast 设备条目
                devices.push({
                    id: 'presentation_device',
                    name: 'Cast 设备 (Presentation API)',
                    type: 'Chromecast',
                    icon: '📺',
                    status: 'available',
                    protocol: 'presentation'
                });
            }

            // 监听设备可用性变化
            availability.addEventListener('change', () => {
                console.log('[PLAYER] Presentation 设备可用性变化:', availability.value);
            });

        } catch (error) {
            console.warn('[PLAYER] Presentation API 设备发现失败:', error);
        }

        return devices;
    }

    // 使用 WebRTC 发现本地网络设备
    async discoverWebRTCDevices() {
        const devices = [];

        try {
            // 使用 WebRTC 获取本地网络信息
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });

            // 创建数据通道来触发 ICE 收集
            pc.createDataChannel('test');

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            // 收集 ICE 候选者来获取本地网络信息
            const localIPs = new Set();

            return new Promise((resolve) => {
                let timeout;

                pc.onicecandidate = (event) => {
                    if (event.candidate) {
                        const candidate = event.candidate.candidate;
                        const ipMatch = candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
                        if (ipMatch && !ipMatch[1].startsWith('127.')) {
                            localIPs.add(ipMatch[1]);
                        }
                    }
                };

                pc.onicegatheringstatechange = () => {
                    if (pc.iceGatheringState === 'complete') {
                        clearTimeout(timeout);
                        pc.close();

                        // 基于发现的本地IP，推测可能的投屏设备
                        localIPs.forEach(ip => {
                            const subnet = ip.substring(0, ip.lastIndexOf('.'));
                            // 这里可以扫描常见的投屏设备端口
                            // 为简化实现，我们添加一个基于网络的通用设备
                            if (subnet) {
                                devices.push({
                                    id: `network_${subnet}`,
                                    name: `网络设备 (${subnet}.*)`,
                                    type: 'Network',
                                    icon: '🌐',
                                    status: 'available',
                                    protocol: 'network'
                                });
                            }
                        });

                        resolve(devices);
                    }
                };

                // 设置超时
                timeout = setTimeout(() => {
                    pc.close();
                    resolve(devices);
                }, 3000);
            });

        } catch (error) {
            console.warn('[PLAYER] WebRTC 设备发现失败:', error);
            return devices;
        }
    }

    // 发现 mDNS 网络服务
    async discoverMDNSDevices() {
        const devices = [];

        try {
            // 在浏览器环境中，我们无法直接使用 mDNS
            // 但可以通过一些已知的服务端点来检测
            const knownServices = [
                { host: '_googlecast._tcp.local', name: 'Chromecast', icon: '📺' },
                { host: '_airplay._tcp.local', name: 'AirPlay', icon: '🍎' },
                { host: '_miracast._tcp.local', name: 'Miracast', icon: '🖥️' }
            ];

            // 注意：在浏览器中无法直接进行 mDNS 查询
            // 这里我们只是预留接口，实际需要通过主进程来实现
            console.log('[PLAYER] mDNS 发现需要系统级支持，跳过浏览器端实现');

        } catch (error) {
            console.warn('[PLAYER] mDNS 设备发现失败:', error);
        }

        return devices;
    }

    // 去重设备列表
    deduplicateDevices(devices) {
        const seen = new Set();
        return devices.filter(device => {
            const key = `${device.name}-${device.type}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }    // 显示投屏设备列表
    displayCastDevices(devices) {
        const deviceList = document.getElementById('cast-device-list');
        if (!deviceList) return;

        deviceList.innerHTML = '';

        devices.forEach(device => {
            const deviceItem = document.createElement('div');
            deviceItem.className = 'cast-device-item';
            deviceItem.dataset.deviceId = device.id;
            deviceItem.dataset.protocol = device.protocol || 'unknown'; // 添加协议标识

            const statusClass = device.status === 'available' ? 'available' :
                device.status === 'busy' ? 'busy' : 'offline';
            const statusText = device.status === 'available' ? '可用' :
                device.status === 'busy' ? '使用中' : '离线';

            // 根据协议添加额外信息
            let protocolInfo = '';
            if (device.protocol === 'dlna') {
                protocolInfo = ' (DLNA)';
            } else if (device.protocol === 'presentation') {
                protocolInfo = ' (Cast)';
            } else if (device.protocol === 'system') {
                protocolInfo = ' (系统)';
            }

            deviceItem.innerHTML = `
                <div class="cast-device-icon">${device.icon}</div>
                <div class="cast-device-info">
                    <div class="cast-device-name">${device.name}</div>
                    <div class="cast-device-type">${device.type}${protocolInfo}</div>
                    ${device.address ? `<div style="font-size: 11px; color: #999; margin-top: 2px;">${device.address}</div>` : ''}
                </div>
                <div class="cast-device-status ${statusClass}">${statusText}</div>
            `;

            // 只允许点击可用设备
            if (device.status === 'available') {
                deviceItem.onclick = () => this.selectCastDevice(device);
            } else {
                deviceItem.style.opacity = '0.6';
                deviceItem.style.cursor = 'not-allowed';
            }

            deviceList.appendChild(deviceItem);
        });
    }

    // 选择投屏设备
    async selectCastDevice(device) {
        console.log('[PLAYER] 选择投屏设备:', device);

        // 更新UI选中状态
        const deviceItems = document.querySelectorAll('.cast-device-item');
        deviceItems.forEach(item => item.classList.remove('selected'));

        const selectedItem = document.querySelector(`[data-device-id="${device.id}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }

        // 添加连接按钮
        this.showConnectButton(device);

        // 或者直接开始连接
        // await this.connectToCastDevice(device);
    }

    // 显示连接按钮
    showConnectButton(device) {
        const footer = document.querySelector('.cast-modal-footer');
        if (!footer) return;

        // 移除现有的连接按钮
        const existingBtn = footer.querySelector('.btn-connect-device');
        if (existingBtn) {
            existingBtn.remove();
        }

        // 创建连接按钮
        const connectBtn = document.createElement('button');
        connectBtn.className = 'btn-connect-device';
        connectBtn.innerHTML = `连接到 ${device.name}`;
        connectBtn.onclick = async () => {
            await this.connectToCastDevice(device);
        };

        footer.appendChild(connectBtn);
    }

    // 连接到投屏设备
    async connectToCastDevice(device) {
        console.log('[PLAYER] 连接到投屏设备:', device);

        try {
            this.hideCastDeviceModal();
            this.showNotification(`正在连接到 ${device.name}...`, 'info');

            // 获取当前视频信息
            const currentUrl = this.video?.src || this.video?.currentSrc;
            if (!currentUrl) {
                throw new Error('没有正在播放的视频');
            }

            const currentTime = this.video?.currentTime || 0;

            // 准备元数据
            const metadata = {
                title: this.videoData?.vod_name || '七星追剧',
                artist: this.videoData?.siteName || '未知来源',
                album: '影视剧集'
            };

            // 根据设备协议使用不同的连接方式
            let success = false;

            if (device.protocol === 'dlna') {
                // 使用DLNA协议投屏
                success = await this.connectDLNADevice(device, currentUrl, metadata);
            } else if (device.protocol === 'presentation' && navigator.presentation) {
                // 使用Presentation API
                success = await this.connectChromecast(currentUrl, currentTime);
            } else if (device.protocol === 'system') {
                // 使用系统投屏
                success = await this.connectSystemCasting(currentUrl, currentTime, metadata);
            } else {
                // 通用设备连接
                success = await this.connectGenericDevice(currentUrl, currentTime);
            }

            if (success) {
                // 更新投屏状态
                this.isCasting = true;
                this.selectedCastDevice = device;

                const castBtn = document.getElementById('cast-video');
                if (castBtn) {
                    castBtn.classList.add('casting');
                    castBtn.title = `停止投屏 (${device.name})`;
                }

                // 暂停本地播放
                if (this.video && !this.video.paused) {
                    this.video.pause();
                }

                this.showNotification(`投屏到 ${device.name} 成功`, 'success');
                console.log(`[PLAYER] 成功投屏到: ${device.name}`);
            } else {
                throw new Error('连接失败');
            }

        } catch (error) {
            console.error('[PLAYER] 连接投屏设备失败:', error);
            this.showNotification(`连接 ${device.name} 失败: ${error.message}`, 'error');
        }
    }

    // 连接DLNA设备
    async connectDLNADevice(device, mediaUrl, metadata) {
        console.log('[PLAYER] 使用DLNA协议投屏...');

        try {
            if (!window.electron || !window.electron.ipcRenderer) {
                throw new Error('DLNA功能需要桌面版支持');
            }

            const result = await window.electron.ipcRenderer.invoke('cast-to-dlna-device', device.id, mediaUrl, metadata);

            if (result.success) {
                console.log('[PLAYER] DLNA投屏成功:', result.message);
                return true;
            } else {
                throw new Error(result.error || 'DLNA投屏失败');
            }

        } catch (error) {
            console.error('[PLAYER] DLNA投屏失败:', error);
            throw error;
        }
    }

    // 连接系统投屏
    async connectSystemCasting(mediaUrl, currentTime, metadata) {
        console.log('[PLAYER] 使用系统投屏...');

        try {
            if (!window.electron || !window.electron.ipcRenderer) {
                throw new Error('系统投屏功能需要桌面版支持');
            }

            const castInfo = {
                url: mediaUrl,
                title: metadata.title,
                currentTime: currentTime
            };

            const result = await window.electron.ipcRenderer.invoke('start-system-casting', castInfo);

            if (result.success) {
                console.log('[PLAYER] 系统投屏成功');
                return true;
            } else {
                throw new Error(result.error || '系统投屏失败');
            }

        } catch (error) {
            console.error('[PLAYER] 系统投屏失败:', error);
            throw error;
        }
    }

    // 连接 Chromecast
    async connectChromecast(videoUrl, startTime) {
        try {
            const castUrl = this.createCastPageUrl(videoUrl, startTime);
            this.presentationRequest = new PresentationRequest([castUrl]);

            const connection = await this.presentationRequest.start();
            this.setupCastingEvents(connection);

            return true;
        } catch (error) {
            console.error('[PLAYER] Chromecast 连接失败:', error);
            return false;
        }
    }

    // 连接 AirPlay
    async connectAirPlay(videoUrl, startTime) {
        try {
            // AirPlay 连接逻辑
            return await this.trySystemCasting();
        } catch (error) {
            console.error('[PLAYER] AirPlay 连接失败:', error);
            return false;
        }
    }

    // 连接通用设备
    async connectGenericDevice(videoUrl, startTime) {
        try {
            return await this.trySystemCasting();
        } catch (error) {
            console.error('[PLAYER] 通用设备连接失败:', error);
            return false;
        }
    }

    // 手动投屏（直接使用系统功能）
    async startManualCasting() {
        console.log('[PLAYER] 开始手动投屏...');

        try {
            const currentUrl = this.video?.src || this.video?.currentSrc;
            if (!currentUrl) {
                throw new Error('没有正在播放的视频');
            }

            const currentTime = this.video?.currentTime || 0;

            if (await this.trySystemCasting()) {
                this.isCasting = true;
                const castBtn = document.getElementById('cast-video');
                if (castBtn) {
                    castBtn.classList.add('casting');
                    castBtn.title = '停止投屏 (手动模式)';
                }

                // 暂停本地播放
                if (this.video && !this.video.paused) {
                    this.video.pause();
                }

                this.showNotification('手动投屏已开始', 'success');
            } else {
                throw new Error('手动投屏失败');
            }

        } catch (error) {
            console.error('[PLAYER] 手动投屏失败:', error);
            this.showNotification('手动投屏失败: ' + error.message, 'error');
        }
    }    // 停止投屏
    async stopCasting() {
        console.log('[PLAYER] 停止投屏...');

        try {
            // 根据当前投屏设备的协议停止投屏
            if (this.selectedCastDevice) {
                if (this.selectedCastDevice.protocol === 'dlna') {
                    // 停止DLNA投屏
                    if (window.electron && window.electron.ipcRenderer) {
                        await window.electron.ipcRenderer.invoke('stop-dlna-casting', this.selectedCastDevice.id);
                    }
                } else if (this.selectedCastDevice.protocol === 'presentation') {
                    // 停止Presentation投屏
                    if (this.presentationRequest) {
                        this.presentationRequest = null;
                    }
                } else {
                    // 停止系统投屏
                    if (window.electron && window.electron.ipcRenderer) {
                        await window.electron.ipcRenderer.invoke('stop-casting');
                    }
                }

                console.log(`[PLAYER] 已停止投屏到: ${this.selectedCastDevice.name}`);
            } else {
                // 通用停止方法
                if (this.presentationRequest) {
                    this.presentationRequest = null;
                }

                if (window.electron && window.electron.ipcRenderer) {
                    await window.electron.ipcRenderer.invoke('stop-casting');
                }
            }

        } catch (error) {
            console.warn('[PLAYER] 停止投屏时出现警告:', error);
        } finally {
            // 无论如何都要重置状态
            this.isCasting = false;
            this.selectedCastDevice = null;

            const castBtn = document.getElementById('cast-video');
            if (castBtn) {
                castBtn.classList.remove('casting');
                castBtn.title = '投屏到电视';
            }

            this.showNotification('投屏已停止', 'info');
        }
    }

    // 尝试使用系统原生投屏
    async trySystemCasting() {
        try {
            if (!window.electron || !window.electron.ipcRenderer) {
                return false;
            }

            const videoUrl = this.video?.src || this.video?.currentSrc;
            if (!videoUrl) {
                return false;
            }

            const castInfo = {
                url: videoUrl,
                title: this.videoData?.vod_name || '七星追剧',
                currentTime: this.video?.currentTime || 0,
                duration: this.video?.duration || 0
            };

            const result = await window.electron.ipcRenderer.invoke('start-system-casting', castInfo);
            return result && result.success;

        } catch (error) {
            console.error('[PLAYER] 系统投屏失败:', error);
            return false;
        }
    }

    // 创建投屏页面URL
    createCastPageUrl(videoUrl, startTime = 0) {
        // 创建一个简单的投屏页面URL
        const params = new URLSearchParams({
            video: encodeURIComponent(videoUrl),
            title: encodeURIComponent(this.videoData?.vod_name || '七星追剧'),
            start: startTime.toString()
        });

        // 这里应该是一个专门的投屏页面
        return `file://${__dirname}/cast-receiver.html?${params.toString()}`;
    }

    // 设置投屏连接事件监听
    setupCastingEvents(connection) {
        if (!connection) return;

        connection.addEventListener('connect', () => {
            console.log('[PLAYER] 投屏设备已连接');
        });

        connection.addEventListener('close', (event) => {
            console.log('[PLAYER] 投屏连接已关闭:', event.reason);
            this.stopCasting();
        });

        connection.addEventListener('terminate', () => {
            console.log('[PLAYER] 投屏会话已终止');
            this.stopCasting();
        });

        // 发送初始播放信息
        connection.addEventListener('connect', () => {
            const playInfo = {
                type: 'play',
                url: this.video?.src || this.video?.currentSrc,
                currentTime: this.video?.currentTime || 0,
                title: this.videoData?.vod_name || '七星追剧'
            };

            try {
                connection.send(JSON.stringify(playInfo));
            } catch (error) {
                console.error('[PLAYER] 发送播放信息失败:', error);
            }
        });
    }

    // ==================== 分享功能 ====================

    // 分享当前视频
    async shareCurrentVideo() {
        if (!this.videoData) {
            this.showNotification('无法获取当前视频信息', 'error');
            return;
        }

        try {
            console.log('[PLAYER] 开始分享当前视频，原始数据:', this.videoData);

            // 从视频数据中获取站点信息，兼容多种数据结构
            const siteName = this.videoData.siteName || this.videoData.site_name ||
                (this.videoData.routes && this.videoData.routes[this.currentRouteIndex]?.siteName) ||
                '当前站点';
            const siteUrl = this.videoData.siteUrl || this.videoData.site_url ||
                (this.videoData.routes && this.videoData.routes[this.currentRouteIndex]?.siteUrl) ||
                'unknown';

            console.log('[PLAYER] 获取到的站点信息:', {
                siteName,
                siteUrl,
                currentRouteIndex: this.currentRouteIndex,
                routes: this.videoData.routes,
                原始siteName: this.videoData.siteName,
                原始site_name: this.videoData.site_name,
                原始siteUrl: this.videoData.siteUrl,
                原始site_url: this.videoData.site_url
            });

            // 生成分享数据
            const shareData = {
                siteName: siteName,
                siteUrl: siteUrl,
                videoName: this.videoData.vod_name,
                videoId: this.videoData.vod_id,
                videoPic: this.videoData.vod_pic || '',
                videoRemarks: this.videoData.vod_remarks || '',
                videoContent: this.videoData.vod_content || '',
                timestamp: Date.now()
            };

            console.log('[PLAYER] 构建的分享数据:', shareData);            // 加密数据
            const encryptedData = this.encryptShareData(shareData);
            if (!encryptedData) {
                this.showNotification('分享码生成失败', 'error');
                return;
            }

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
                console.error('[PLAYER] 复制到剪切板失败:', error);
                this.showNotification('复制失败，请手动复制分享内容', 'error');
            }
        } catch (error) {
            console.error('[PLAYER] 生成分享内容失败:', error);
            this.showNotification('生成分享内容失败', 'error');
        }
    }

    // 加密分享数据
    encryptShareData(data) {
        try {
            console.log('[PLAYER] 开始加密分享数据:', data);

            // 精简数据，只保留必要字段
            const compactData = {
                s: data.siteName,        // 站点名称
                u: data.siteUrl.replace(/https:\/\//g, 'hs:').replace(/http:\/\//g, 'h:'), // 站点URL（简化协议）
                n: data.videoName,       // 视频名称
                i: data.videoId,         // 视频ID
                t: data.timestamp        // 时间戳
            };

            console.log('[PLAYER] 精简后的数据:', compactData);

            // 使用紧凑的JSON格式
            const jsonStr = JSON.stringify(compactData);
            console.log('[PLAYER] JSON字符串:', jsonStr);

            // Base64编码 - 正确处理中文字符
            const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
            console.log('[PLAYER] Base64编码:', base64);

            // 简单字符替换，减少长度
            const result = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
            console.log('[PLAYER] 最终加密结果:', result);

            return result;
        } catch (error) {
            console.error('[PLAYER] 加密失败:', error);
            return '';
        }
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
                description = description.substring(0, 80) + '...';
            }
        }

        const shareText = `🎬 【七星追剧】剧集分享 🎬

📺 剧名：${data.videoName}
🌐 来源：${data.siteName}
📝 状态：${data.videoRemarks}
${description ? `💡 简介：${description}` : ''}

✨ 这是一部不错的影视作品，推荐给你观看！
💡 复制此消息到"七星追剧"应用，即可直接跳转观看

🔐 分享码：${encryptedData}

📱 下载七星追剧：github.com/fjcq/qixing-zhuiju`;

        return shareText;
    }

    // 显示通知消息
    showNotification(message, type = 'info') {
        console.log(`[PLAYER] ${type.toUpperCase()}: ${message}`);

        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;

        // 添加样式
        Object.assign(notification.style, {
            position: 'fixed',
            top: '80px',
            right: '20px',
            background: type === 'error' ? 'rgba(220, 53, 69, 0.9)' :
                type === 'success' ? 'rgba(40, 167, 69, 0.9)' :
                    'rgba(23, 162, 184, 0.9)',
            color: '#fff',
            padding: '12px 20px',
            borderRadius: '8px',
            fontSize: '14px',
            zIndex: '10000',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            transform: 'translateX(100%)',
            transition: 'transform 0.3s ease'
        });

        document.body.appendChild(notification);

        // 动画显示
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 100);

        // 自动隐藏
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    // 销毁播放器
    destroy() {
        this.cleanup();

        // 销毁弹幕系统
        if (window.danmakuSystem) {
            window.danmakuSystem.destroy();
        }

        // 移除事件监听器
        document.removeEventListener('keydown', this.handleKeyboard);

        console.log('播放器已销毁');
    }
}

// 页面加载完成后初始化播放器
document.addEventListener('DOMContentLoaded', () => {
    console.log('播放器页面加载完成');

    const player = new VideoPlayer();
    player.initialize();

    // 全局播放器实例
    window.videoPlayer = player;

    // 添加全局调试方法
    window.showTopRightControls = () => {
        const topRightControls = document.querySelector('.top-right-controls');
        if (topRightControls) {
            topRightControls.style.opacity = '1';
            topRightControls.style.visibility = 'visible';
            topRightControls.style.pointerEvents = 'auto';
            console.log('手动显示右上角按钮');
            console.log('当前样式:', window.getComputedStyle(topRightControls));
        } else {
            console.log('未找到右上角按钮元素');
        }
    };

    window.hideTopRightControls = () => {
        const topRightControls = document.querySelector('.top-right-controls');
        if (topRightControls) {
            topRightControls.style.opacity = '0';
            topRightControls.style.visibility = 'hidden';
            topRightControls.style.pointerEvents = 'none';
            console.log('手动隐藏右上角按钮');
        }
    };

    // 额外的延迟检查，确保悬浮控制栏正常工作
    setTimeout(() => {
        console.log('[PLAYER] 页面完全加载，悬浮控制栏初始化完成');

        // 在确保控制栏正常后，隐藏其他顶部控制元素
        setTimeout(() => {
            if (player.hideTopControls) {
                player.hideTopControls();
            }
        }, 100);
    }, 500);

    // 移除原来的hideTopControls调用，避免重复执行
    // setTimeout(() => {
    //     if (player.hideTopControls) {
    //         player.hideTopControls();
    //     }
    // }, 100);

    // 窗口关闭时清理资源
    window.addEventListener('beforeunload', () => {
        player.destroy();
    });
});
