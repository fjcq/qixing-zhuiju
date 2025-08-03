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
        this.setupVideoEvents();
        this.setupControlEvents();

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

    // 加载视频数据
    loadVideoData(data) {
        console.log('[PLAYER] 加载视频数据:', data);

        this.videoData = data.videoData || data;
        // currentEpisode是数组索引（从0开始），需要转换为从1开始的显示索引
        this.currentEpisodeIndex = (data.videoData?.currentEpisode ?? -1) + 1; // 将数组索引转换为显示索引

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
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName.toLowerCase() !== 'input') {
                this.handleKeyboard(e);
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
        // 上一集按钮
        const prevBtn = document.getElementById('prev-episode');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                this.playPrevEpisode();
            });
        }

        // 下一集按钮
        const nextBtn = document.getElementById('next-episode');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.playNextEpisode();
            });
        }

        // 重试按钮
        const retryBtn = document.getElementById('retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                this.retryCurrentEpisode();
            });
        }

        // 显示/隐藏选集面板按钮
        const toggleEpisodesBtn = document.getElementById('toggle-episodes');
        if (toggleEpisodesBtn) {
            toggleEpisodesBtn.addEventListener('click', () => {
                this.toggleEpisodePanel();
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

        // 鼠标移动显示悬浮控制栏
        this.setupOverlayControls();
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
    handleKeyboard(e) {
        if (!this.video) return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                if (this.video.paused) {
                    this.video.play();
                } else {
                    this.video.pause();
                }
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
            case 'Escape':
                e.preventDefault();
                this.hideEpisodePanel();
                break;
        }
    }

    // 切换全屏
    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            this.video.requestFullscreen();
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

            if (progress && progress.currentTime > 10 && progress.percentage < 90) {
                this.video.currentTime = progress.currentTime;
                console.log(`恢复播放进度: ${progress.currentTime}s (${progress.percentage}%)`);
            }
        } catch (error) {
            console.warn('恢复播放进度失败:', error);
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

    // 设置悬浮控制栏
    setupOverlayControls() {
        const playerContainer = document.querySelector('.player-container');
        const overlay = document.getElementById('player-overlay');

        if (!playerContainer || !overlay) return;

        let hideTimer = null;

        const showOverlay = () => {
            overlay.classList.add('show');
            if (hideTimer) {
                clearTimeout(hideTimer);
            }
            hideTimer = setTimeout(() => {
                if (!overlay.matches(':hover')) {
                    overlay.classList.remove('show');
                }
            }, 3000);
        };

        const hideOverlay = () => {
            if (hideTimer) {
                clearTimeout(hideTimer);
            }
            overlay.classList.remove('show');
        };

        playerContainer.addEventListener('mousemove', showOverlay);
        playerContainer.addEventListener('mouseleave', hideOverlay);
        overlay.addEventListener('mouseenter', () => {
            if (hideTimer) {
                clearTimeout(hideTimer);
            }
        });
        overlay.addEventListener('mouseleave', hideOverlay);
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
        }
    }

    // 隐藏选集面板
    hideEpisodePanel() {
        const panel = document.getElementById('episode-panel');
        if (panel) {
            panel.classList.remove('show');
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

    // 窗口关闭时清理资源
    window.addEventListener('beforeunload', () => {
        player.destroy();
    });
});
