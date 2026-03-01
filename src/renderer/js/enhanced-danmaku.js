// 增强版弹幕系统 - 支持实时和时间轴模式
class EnhancedDanmakuSystem extends DanmakuSystem {
    constructor() {
        super();

        // 弹幕模式配置
        this.danmakuMode = 'realtime'; // 'realtime' 或 'timeline'
        this.timelineDanmaku = new Map(); // 存储时间轴弹幕
        this.currentVideoTime = 0; // 当前视频播放时间
        this.videoElement = null; // 视频元素引用
        this.timeUpdateHandler = null; // 时间更新处理器
        this.danmakuTimeRange = 3; // 弹幕时间误差范围（秒）

        console.log('[ENHANCED-DANMAKU] 增强版弹幕系统已初始化');
    }

    // 重写初始化方法
    init() {
        super.init();

        // 获取视频元素引用
        this.videoElement = document.getElementById('video-player');
        if (this.videoElement) {
            this.setupVideoTimeTracking();
        }

        // 添加模式切换UI
        this.addModeToggleUI();

        // 加载弹幕模式设置
        this.loadDanmakuMode();

        // 同步弹幕类型选择控件
        this.syncDanmakuTypeSelect();

        console.log(`[ENHANCED-DANMAKU] 当前弹幕模式: ${this.danmakuMode}`);
    }

    // 设置视频时间跟踪
    setupVideoTimeTracking() {
        if (!this.videoElement) return;

        this.timeUpdateHandler = () => {
            this.currentVideoTime = this.videoElement.currentTime;

            // 如果是时间轴模式，检查是否有需要显示的弹幕
            if (this.danmakuMode === 'timeline') {
                this.checkTimelineDanmaku();
            }
        };

        this.videoElement.addEventListener('timeupdate', this.timeUpdateHandler);
        console.log('[ENHANCED-DANMAKU] 视频时间跟踪已启用');
    }

    // 检查时间轴弹幕
    checkTimelineDanmaku() {
        const currentTime = Math.floor(this.currentVideoTime);

        // 检查当前时间点前后范围内的弹幕
        for (let i = -this.danmakuTimeRange; i <= this.danmakuTimeRange; i++) {
            const checkTime = currentTime + i;
            const danmakuList = this.timelineDanmaku.get(checkTime);

            if (danmakuList && danmakuList.length > 0) {
                danmakuList.forEach(danmaku => {
                    // 检查弹幕是否已显示过
                    if (!danmaku.displayed) {
                        this.displayDanmaku(danmaku);
                        danmaku.displayed = true;
                    }
                });
            }
        }
    }

    // 添加模式切换UI
    addModeToggleUI() {
        const controlsContainer = document.querySelector('.overlay-controls');
        if (!controlsContainer) return;

        // 创建模式切换按钮
        const modeToggleBtn = document.createElement('button');
        modeToggleBtn.id = 'toggle-danmaku-mode';
        modeToggleBtn.className = 'btn-control';
        modeToggleBtn.title = '切换弹幕模式';
        modeToggleBtn.innerHTML = '<span class="icon">⏰</span>';

        // 插入到弹幕开关按钮后面
        const danmakuToggleBtn = document.getElementById('toggle-danmaku');
        if (danmakuToggleBtn) {
            danmakuToggleBtn.insertAdjacentElement('afterend', modeToggleBtn);
        }

        // 添加点击事件
        modeToggleBtn.addEventListener('click', () => {
            this.toggleDanmakuMode();
        });

        this.updateModeToggleUI();
        console.log('[ENHANCED-DANMAKU] 模式切换UI已添加');
    }

    // 切换弹幕模式
    toggleDanmakuMode() {
        this.danmakuMode = this.danmakuMode === 'realtime' ? 'timeline' : 'realtime';
        this.saveDanmakuMode();
        this.updateModeToggleUI();

        console.log(`[ENHANCED-DANMAKU] 弹幕模式已切换为: ${this.danmakuMode}`);

        // 清空现有弹幕
        this.clearDanmaku();

        // 显示模式切换提示
        this.showModeChangeNotification();
    }

    // 更新模式切换UI
    updateModeToggleUI() {
        const modeToggleBtn = document.getElementById('toggle-danmaku-mode');
        if (!modeToggleBtn) return;

        const icon = modeToggleBtn.querySelector('.icon');
        if (this.danmakuMode === 'realtime') {
            icon.textContent = '💬'; // 实时模式
            modeToggleBtn.title = '当前：实时弹幕模式，点击切换到时间轴模式';
            modeToggleBtn.classList.remove('timeline-mode');
        } else {
            icon.textContent = '⏰'; // 时间轴模式
            modeToggleBtn.title = '当前：时间轴弹幕模式，点击切换到实时模式';
            modeToggleBtn.classList.add('timeline-mode');
        }
    }

    // 显示模式切换通知
    showModeChangeNotification() {
        const notification = document.createElement('div');
        notification.className = 'danmaku-mode-notification';
        notification.innerHTML = `
            <div class="notification-content">
                <span class="notification-icon">${this.danmakuMode === 'realtime' ? '💬' : '⏰'}</span>
                <span class="notification-text">
                    已切换到${this.danmakuMode === 'realtime' ? '实时' : '时间轴'}弹幕模式
                </span>
            </div>
        `;

        document.body.appendChild(notification);

        // 3秒后自动移除
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }

    // 重写发送弹幕方法
    sendDanmaku() {
        const input = document.getElementById('danmaku-input');
        const colorSelect = document.getElementById('danmaku-color');
        const sizeSelect = document.getElementById('danmaku-size');

        if (!input || !input.value.trim()) {
            return;
        }

        const text = input.value.trim();
        const color = colorSelect ? colorSelect.value : '#ffffff';
        const size = sizeSelect ? sizeSelect.value : 'medium';

        // 弹幕数据
        const danmakuData = {
            type: 'danmaku',
            room: this.generateRoomId(this.currentVideoId || ''),
            user: this.generateUserId(),
            text,
            color,
            size,
            time: Date.now(),
            videoTime: this.currentVideoTime, // 添加视频时间
            mode: this.danmakuMode
        };

        // 发送到WebSocket服务器
        this.sendWebSocketMessage(danmakuData);

        // 根据模式处理弹幕
        if (this.danmakuMode === 'realtime') {
            // 实时模式：立即显示
            this.displayDanmaku({
                ...danmakuData,
                local: true
            });
        } else {
            // 时间轴模式：保存到时间轴并立即显示一次（给发送者看到）
            this.saveTimelineDanmaku(danmakuData);
            this.displayDanmaku({
                ...danmakuData,
                local: true
            });
        }

        // 清空输入框
        input.value = '';
        this.hideDanmakuInput();
    }

    // 添加弹幕方法（供外部调用）
    addDanmaku(danmakuData) {
        // 兼容外部调用的弹幕数据格式
        const formattedData = {
            type: 'danmaku',
            room: this.generateRoomId(this.currentVideoId || ''),
            user: this.generateUserId(),
            text: danmakuData.text,
            color: danmakuData.color || '#ffffff',
            size: danmakuData.size || 'medium',
            time: Date.now(),
            videoTime: this.currentVideoTime,
            mode: danmakuData.type || 'realtime', // 使用传入的type作为mode
            local: true
        };

        // 发送到WebSocket服务器
        this.sendWebSocketMessage(formattedData);

        // 根据模式处理弹幕
        if (formattedData.mode === 'realtime') {
            // 实时模式：立即显示
            this.displayDanmaku(formattedData);
        } else if (formattedData.mode === 'timeline') {
            // 时间轴模式：保存到时间轴并立即显示一次（给发送者看到）
            this.saveTimelineDanmaku(formattedData);
            this.displayDanmaku(formattedData);
        }

        console.log(`[ENHANCED-DANMAKU] 添加弹幕: ${formattedData.mode} - ${formattedData.text}`);
    }

    // 保存时间轴弹幕
    saveTimelineDanmaku(danmakuData) {
        const videoTime = Math.floor(danmakuData.videoTime || this.currentVideoTime);

        if (!this.timelineDanmaku.has(videoTime)) {
            this.timelineDanmaku.set(videoTime, []);
        }

        this.timelineDanmaku.get(videoTime).push({
            ...danmakuData,
            displayed: false
        });

        console.log(`[ENHANCED-DANMAKU] 时间轴弹幕已保存: ${videoTime}s - ${danmakuData.text}`);
    }

    // 添加时间轴弹幕（公共API）
    addTimelineDanmaku(danmakuData) {
        const time = Math.floor(danmakuData.time || this.currentVideoTime);

        const timelineDanmaku = {
            ...danmakuData,
            videoTime: time,
            mode: 'timeline',
            displayed: false
        };

        this.saveTimelineDanmaku(timelineDanmaku);

        // 如果当前就是这个时间点，立即显示
        if (Math.abs(this.currentVideoTime - time) <= 1) {
            this.displayDanmaku({ ...timelineDanmaku, local: true });
            timelineDanmaku.displayed = true;
        }

        console.log(`[ENHANCED-DANMAKU] 添加时间轴弹幕: ${time}s - ${danmakuData.text}`);
    }

    // 重写WebSocket消息处理
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'danmaku':
                if (data.mode === 'realtime' && this.danmakuMode === 'realtime') {
                    // 实时模式：立即显示
                    this.displayDanmaku(data);
                } else if (data.mode === 'timeline' && this.danmakuMode === 'timeline') {
                    // 时间轴模式：保存到时间轴
                    this.saveTimelineDanmaku(data);
                }
                break;
            case 'user_count':
                this.updateUserCount(data.count);
                break;
            case 'error':
                console.error('[ENHANCED-DANMAKU] 服务器错误:', data.message);
                break;
        }
    }

    // 设置当前视频（重写）
    setCurrentVideo(videoId) {
        console.log(`[ENHANCED-DANMAKU] 设置当前视频: ${videoId}`);

        // 清空现有弹幕和时间轴数据
        this.clearDanmaku();
        this.timelineDanmaku.clear();

        // 重置视频时间
        this.currentVideoTime = 0;

        // 连接新的弹幕房间
        if (videoId && this.enabled) {
            this.connectWebSocket(videoId);

            // 如果是时间轴模式，尝试加载历史弹幕
            if (this.danmakuMode === 'timeline') {
                this.loadHistoryDanmaku(videoId);
            }
        }
    }

    // 加载历史弹幕（时间轴模式）
    loadHistoryDanmaku(videoId) {
        // 这里可以实现从服务器加载历史弹幕的逻辑
        // 目前使用本地存储作为示例
        const historyKey = `danmaku_history_${videoId}`;
        const historyData = localStorage.getItem(historyKey);

        if (historyData) {
            try {
                const history = JSON.parse(historyData);
                history.forEach(danmaku => {
                    this.saveTimelineDanmaku(danmaku);
                });
                console.log(`[ENHANCED-DANMAKU] 已加载${history.length}条历史弹幕`);
            } catch (e) {
                console.error('[ENHANCED-DANMAKU] 加载历史弹幕失败:', e);
            }
        }
    }

    // 保存弹幕模式设置
    saveDanmakuMode() {
        localStorage.setItem('danmaku_mode', this.danmakuMode);
    }

    // 加载弹幕模式设置
    loadDanmakuMode() {
        const savedMode = localStorage.getItem('danmaku_mode');
        if (savedMode && ['realtime', 'timeline'].includes(savedMode)) {
            this.danmakuMode = savedMode;
        }
        this.updateModeToggleUI();
    }

    // 同步弹幕类型选择控件
    syncDanmakuTypeSelect() {
        const typeSelect = document.getElementById('danmaku-type');
        if (typeSelect) {
            typeSelect.value = this.danmakuMode;
            console.log(`[ENHANCED-DANMAKU] 弹幕类型选择控件已同步为: ${this.danmakuMode}`);
        }
    }

    // 重写销毁方法
    destroy() {
        super.destroy();

        // 移除视频时间监听
        if (this.videoElement && this.timeUpdateHandler) {
            this.videoElement.removeEventListener('timeupdate', this.timeUpdateHandler);
        }

        // 清空时间轴数据
        this.timelineDanmaku.clear();

        console.log('[ENHANCED-DANMAKU] 增强版弹幕系统已销毁');
    }

    // 获取弹幕模式说明
    getModeDescription() {
        return {
            'realtime': {
                name: '实时弹幕模式',
                description: '弹幕发送后立即显示，类似直播聊天室',
                icon: '💬'
            },
            'timeline': {
                name: '时间轴弹幕模式',
                description: '弹幕与视频时间绑定，在特定时间点显示',
                icon: '⏰'
            }
        };
    }
}

// 扩展CSS样式
const enhancedDanmakuCSS = `
/* 弹幕模式切换按钮 */
#toggle-danmaku-mode.timeline-mode {
    background: linear-gradient(135deg, #ff6b6b, #ee5a24);
    border-color: #ff6b6b;
}

#toggle-danmaku-mode.timeline-mode:hover {
    background: linear-gradient(135deg, #ff5252, #dd4124);
}

/* 模式切换通知 */
.danmaku-mode-notification {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 10000;
    background: rgba(0, 0, 0, 0.9);
    color: #ffffff;
    padding: 20px 30px;
    border-radius: 10px;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    animation: danmaku-notification-show 0.3s ease-out;
}

.notification-content {
    display: flex;
    align-items: center;
    gap: 10px;
}

.notification-icon {
    font-size: 24px;
}

.notification-text {
    font-size: 16px;
    font-weight: 500;
}

@keyframes danmaku-notification-show {
    from {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.8);
    }
    to {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
    }
}

/* 时间轴弹幕特殊样式 */
.danmaku-item.timeline-danmaku::before {
    content: '⏰';
    margin-right: 5px;
    opacity: 0.7;
}
`;

// 注入CSS样式
if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = enhancedDanmakuCSS;
    document.head.appendChild(style);
}

// 导出增强版弹幕系统
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnhancedDanmakuSystem;
}
