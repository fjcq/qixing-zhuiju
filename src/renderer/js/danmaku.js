// 弹幕系统
class DanmakuSystem {
    constructor() {
        this.enabled = true;
        this.container = null;
        this.websocket = null;
        this.currentVideoId = null;
        this.danmakuQueue = [];
        this.maxDanmaku = 50; // 同时显示的最大弹幕数
        this.danmakuSpeed = 8; // 弹幕移动速度(秒)
        this.tracks = []; // 弹幕轨道
        this.trackHeight = 40; // 每个轨道的高度
        this.maxTracks = 10; // 最大轨道数
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectInterval = 3000;

        // 弹幕服务器配置 - 使用公共弹幕服务
        this.danmakuServers = [
            'wss://echo.websocket.org', // WebSocket测试服务器
            'wss://ws.postman-echo.com/raw', // Postman WebSocket测试
            'wss://websocket-echo-server.herokuapp.com' // Heroku WebSocket测试
        ];
        this.currentServerIndex = 0;

        this.init();
    }

    init() {
        console.log('[DANMAKU] 初始化弹幕系统...');
        this.container = document.getElementById('danmaku-container');
        if (!this.container) {
            console.error('[DANMAKU] 弹幕容器未找到');
            return;
        }

        this.initTracks();
        this.setupEventListeners();
        this.loadSettings();
        console.log('[DANMAKU] 弹幕系统初始化完成');
    }

    // 初始化弹幕轨道
    initTracks() {
        this.tracks = [];
        for (let i = 0; i < this.maxTracks; i++) {
            this.tracks.push({
                occupied: false,
                lastTime: 0
            });
        }
    }

    // 设置事件监听器
    setupEventListeners() {
        // 弹幕开关按钮
        const toggleBtn = document.getElementById('toggle-danmaku');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.toggleDanmaku();
            });
        }

        // 弹幕输入
        const input = document.getElementById('danmaku-input');
        const sendBtn = document.getElementById('send-danmaku');

        if (input && sendBtn) {
            // 输入框内回车发送弹幕
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendDanmaku();
                }
            });

            // 点击发送
            sendBtn.addEventListener('click', () => {
                this.sendDanmaku();
            });
        }

        // 全局回车键打开弹幕输入框
        document.addEventListener('keydown', (e) => {
            // 只有在没有其他输入框聚焦且弹幕输入框未显示时才响应回车键
            const inputContainer = document.getElementById('danmaku-input-container');
            const isInputContainerVisible = inputContainer && inputContainer.style.display !== 'none';

            if (e.key === 'Enter' && !e.target.matches('input, textarea, select') &&
                !isInputContainerVisible && this.enabled) {
                e.preventDefault();
                this.showDanmakuInput();
            }
        });

        // 按ESC键隐藏弹幕输入框
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideDanmakuInput();
            }
        });

        // 点击空白处隐藏弹幕输入框
        document.addEventListener('click', (e) => {
            const inputContainer = document.getElementById('danmaku-input-container');

            if (inputContainer && !inputContainer.contains(e.target) &&
                !e.target.closest('.danmaku-container') &&
                !e.target.closest('#toggle-danmaku')) {
                this.hideDanmakuInput();
            }
        });
    }

    // 连接弹幕服务器
    connectWebSocket(videoId) {
        if (this.websocket) {
            this.disconnectWebSocket();
        }

        this.currentVideoId = videoId;
        const serverUrl = this.danmakuServers[this.currentServerIndex];

        console.log(`[DANMAKU] 连接弹幕服务器: ${serverUrl}`);

        try {
            this.websocket = new WebSocket(serverUrl);

            this.websocket.onopen = () => {
                console.log('[DANMAKU] WebSocket连接成功');
                this.reconnectAttempts = 0;

                // 加入房间
                this.sendWebSocketMessage({
                    type: 'join',
                    room: this.generateRoomId(videoId),
                    user: this.generateUserId()
                });
            };

            this.websocket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleWebSocketMessage(data);
                } catch (e) {
                    console.error('[DANMAKU] 解析消息失败:', e);
                }
            };

            this.websocket.onclose = () => {
                console.log('[DANMAKU] WebSocket连接关闭');
                this.attemptReconnect();
            };

            this.websocket.onerror = (error) => {
                console.error('[DANMAKU] WebSocket连接错误:', error);
                this.tryNextServer();
            };

        } catch (error) {
            console.error('[DANMAKU] 创建WebSocket连接失败:', error);
            this.tryNextServer();
        }
    }

    // 尝试下一个服务器
    tryNextServer() {
        this.currentServerIndex = (this.currentServerIndex + 1) % this.danmakuServers.length;
        console.log(`[DANMAKU] 尝试下一个服务器: ${this.danmakuServers[this.currentServerIndex]}`);

        setTimeout(() => {
            if (this.currentVideoId) {
                this.connectWebSocket(this.currentVideoId);
            }
        }, 1000);
    }

    // 重连机制
    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[DANMAKU] 尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

            setTimeout(() => {
                if (this.currentVideoId) {
                    this.connectWebSocket(this.currentVideoId);
                }
            }, this.reconnectInterval);
        } else {
            console.log('[DANMAKU] 重连次数已用尽，停止重连');
        }
    }

    // 断开WebSocket连接
    disconnectWebSocket() {
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
    }

    // 发送WebSocket消息
    sendWebSocketMessage(message) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify(message));
        }
    }

    // 处理WebSocket消息
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'danmaku':
                this.displayDanmaku(data);
                break;
            case 'user_count':
                this.updateUserCount(data.count);
                break;
            case 'error':
                console.error('[DANMAKU] 服务器错误:', data.message);
                break;
        }
    }

    // 生成房间ID（基于视频URL）
    generateRoomId(videoId) {
        // 使用简单的哈希算法生成房间ID
        let hash = 0;
        for (let i = 0; i < videoId.length; i++) {
            const char = videoId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return Math.abs(hash).toString();
    }

    // 生成用户ID
    generateUserId() {
        // 从localStorage获取或生成用户ID
        let userId = localStorage.getItem('danmaku_user_id');
        if (!userId) {
            userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('danmaku_user_id', userId);
        }
        return userId;
    }

    // 发送弹幕
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

        // 发送到WebSocket服务器
        this.sendWebSocketMessage({
            type: 'danmaku',
            room: this.generateRoomId(this.currentVideoId || ''),
            user: this.generateUserId(),
            text: text,
            color: color,
            size: size,
            time: Date.now()
        });

        // 立即在本地显示
        this.displayDanmaku({
            text: text,
            color: color,
            size: size,
            user: this.generateUserId(),
            time: Date.now(),
            local: true
        });

        // 清空输入框
        input.value = '';
        this.hideDanmakuInput();
    }

    // 显示弹幕
    displayDanmaku(danmakuData) {
        if (!this.enabled || !this.container) {
            return;
        }

        // 检查弹幕数量限制
        const existingDanmaku = this.container.querySelectorAll('.danmaku-item');
        if (existingDanmaku.length >= this.maxDanmaku) {
            // 移除最老的弹幕
            existingDanmaku[0].remove();
        }

        // 创建弹幕元素
        const danmakuElement = document.createElement('div');
        danmakuElement.className = 'danmaku-item';
        danmakuElement.textContent = danmakuData.text;

        // 设置样式
        this.setDanmakuStyle(danmakuElement, danmakuData);

        // 查找可用轨道
        const track = this.findAvailableTrack();
        danmakuElement.style.top = `${track * this.trackHeight + 50}px`; // 50px为顶部留白

        // 添加到容器
        this.container.appendChild(danmakuElement);

        // 启动动画
        this.animateDanmaku(danmakuElement, track);
    }

    // 设置弹幕样式
    setDanmakuStyle(element, data) {
        element.style.color = data.color || '#ffffff';
        element.style.position = 'absolute';
        element.style.whiteSpace = 'nowrap';
        element.style.pointerEvents = 'none';
        element.style.zIndex = '1000';
        element.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)';
        element.style.fontWeight = 'bold';
        element.style.right = '-200px'; // 从右侧开始

        // 设置字体大小
        switch (data.size) {
            case 'small':
                element.style.fontSize = '16px';
                break;
            case 'large':
                element.style.fontSize = '24px';
                break;
            default:
                element.style.fontSize = '20px';
        }

        // 本地发送的弹幕添加特殊标识
        if (data.local) {
            element.style.borderLeft = '3px solid #00ff00';
            element.style.paddingLeft = '5px';
        }
    }

    // 查找可用轨道
    findAvailableTrack() {
        const currentTime = Date.now();

        for (let i = 0; i < this.tracks.length; i++) {
            if (!this.tracks[i].occupied ||
                (currentTime - this.tracks[i].lastTime) > 3000) { // 3秒后轨道可复用
                this.tracks[i].occupied = true;
                this.tracks[i].lastTime = currentTime;
                return i;
            }
        }

        // 如果没有可用轨道，随机选择一个
        const randomTrack = Math.floor(Math.random() * this.tracks.length);
        this.tracks[randomTrack].occupied = true;
        this.tracks[randomTrack].lastTime = currentTime;
        return randomTrack;
    }

    // 弹幕动画
    animateDanmaku(element, trackIndex) {
        const containerWidth = this.container.offsetWidth;
        const elementWidth = element.offsetWidth;
        const totalDistance = containerWidth + elementWidth + 200;

        // 使用CSS动画
        element.style.animation = `danmaku-move ${this.danmakuSpeed}s linear`;
        element.style.animationFillMode = 'forwards';

        // 动画结束后清理
        setTimeout(() => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
            this.tracks[trackIndex].occupied = false;
        }, this.danmakuSpeed * 1000);
    }

    // 切换弹幕显示
    toggleDanmaku() {
        this.enabled = !this.enabled;
        const toggleBtn = document.getElementById('toggle-danmaku');

        if (toggleBtn) {
            const icon = toggleBtn.querySelector('.icon');
            if (icon) {
                icon.textContent = this.enabled ? '💬' : '🚫';
            }
            toggleBtn.title = this.enabled ? '关闭弹幕' : '开启弹幕';
        }

        // 隐藏或显示现有弹幕
        if (this.container) {
            this.container.style.display = this.enabled ? 'block' : 'none';
        }

        // 保存设置
        this.saveSettings();
        console.log(`[DANMAKU] 弹幕${this.enabled ? '已开启' : '已关闭'}`);
    }

    // 显示弹幕输入框
    showDanmakuInput() {
        const inputContainer = document.getElementById('danmaku-input-container');
        const input = document.getElementById('danmaku-input');

        if (inputContainer && input) {
            inputContainer.style.display = 'block';
            input.focus();
        }
    }

    // 隐藏弹幕输入框
    hideDanmakuInput() {
        const inputContainer = document.getElementById('danmaku-input-container');
        if (inputContainer) {
            inputContainer.style.display = 'none';
        }
    }

    // 更新在线用户数
    updateUserCount(count) {
        console.log(`[DANMAKU] 在线用户数: ${count}`);
        // 可以在界面上显示用户数
    }

    // 加载设置
    loadSettings() {
        const enabled = localStorage.getItem('danmaku_enabled');
        if (enabled !== null) {
            this.enabled = enabled === 'true';
        }

        // 更新UI状态
        const toggleBtn = document.getElementById('toggle-danmaku');
        if (toggleBtn) {
            const icon = toggleBtn.querySelector('.icon');
            if (icon) {
                icon.textContent = this.enabled ? '💬' : '🚫';
            }
            toggleBtn.title = this.enabled ? '关闭弹幕' : '开启弹幕';
        }

        if (this.container) {
            this.container.style.display = this.enabled ? 'block' : 'none';
        }
    }

    // 保存设置
    saveSettings() {
        localStorage.setItem('danmaku_enabled', this.enabled.toString());
    }

    // 设置当前视频
    setCurrentVideo(videoId) {
        console.log(`[DANMAKU] 设置当前视频: ${videoId}`);

        // 清空现有弹幕
        this.clearDanmaku();

        // 连接新的弹幕房间
        if (videoId && this.enabled) {
            this.connectWebSocket(videoId);
        }
    }

    // 清空弹幕
    clearDanmaku() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        this.initTracks();
    }

    // 销毁弹幕系统
    destroy() {
        console.log('[DANMAKU] 销毁弹幕系统');
        this.disconnectWebSocket();
        this.clearDanmaku();
    }
}

// 创建全局弹幕系统实例
window.danmakuSystem = null;

// 初始化弹幕系统
document.addEventListener('DOMContentLoaded', () => {
    if (!window.danmakuSystem) {
        window.danmakuSystem = new DanmakuSystem();
    }
});
