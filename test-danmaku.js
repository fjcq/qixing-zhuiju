// 弹幕功能测试脚本
// 在浏览器控制台中运行此脚本来测试弹幕功能

console.log('=== 七星追剧弹幕功能测试 ===');

// 测试函数
function testDanmakuSystem() {
    // 检查弹幕系统是否已初始化
    if (!window.danmakuSystem) {
        console.error('❌ 弹幕系统未初始化');
        return false;
    }

    console.log('✅ 弹幕系统已初始化');

    // 测试弹幕容器
    const container = document.getElementById('danmaku-container');
    if (!container) {
        console.error('❌ 弹幕容器未找到');
        return false;
    }

    console.log('✅ 弹幕容器已找到');

    // 测试弹幕输入
    const input = document.getElementById('danmaku-input');
    const sendBtn = document.getElementById('send-danmaku');

    if (!input || !sendBtn) {
        console.error('❌ 弹幕输入组件未找到');
        return false;
    }

    console.log('✅ 弹幕输入组件已找到');

    // 测试弹幕开关
    const toggleBtn = document.getElementById('toggle-danmaku');
    if (!toggleBtn) {
        console.error('❌ 弹幕开关按钮未找到');
        return false;
    }

    console.log('✅ 弹幕开关按钮已找到');

    // 测试显示弹幕
    testDisplayDanmaku();

    return true;
}

// 测试显示弹幕
function testDisplayDanmaku() {
    if (!window.danmakuSystem) return;

    console.log('🧪 测试弹幕显示...');

    // 模拟弹幕数据
    const testDanmakuList = [
        { text: '测试弹幕1', color: '#ffffff', size: 'medium' },
        { text: '测试弹幕2', color: '#ff0000', size: 'large' },
        { text: '测试弹幕3', color: '#00ff00', size: 'small' },
        { text: '测试弹幕4', color: '#0000ff', size: 'medium' },
        { text: '欢迎使用七星追剧！', color: '#ffff00', size: 'large' }
    ];

    // 每隔1秒显示一条测试弹幕
    testDanmakuList.forEach((danmaku, index) => {
        setTimeout(() => {
            window.danmakuSystem.displayDanmaku(danmaku);
            console.log(`✅ 显示测试弹幕${index + 1}: ${danmaku.text}`);
        }, (index + 1) * 1000);
    });
}

// 测试WebSocket连接
function testWebSocketConnection() {
    if (!window.danmakuSystem) {
        console.error('❌ 弹幕系统未初始化');
        return;
    }

    console.log('🔌 测试WebSocket连接...');

    // 设置测试视频
    window.danmakuSystem.setCurrentVideo('test_video_001');

    setTimeout(() => {
        if (window.danmakuSystem.websocket &&
            window.danmakuSystem.websocket.readyState === WebSocket.OPEN) {
            console.log('✅ WebSocket连接成功');
        } else {
            console.log('⚠️ WebSocket连接中或连接失败');
        }
    }, 3000);
}

// 测试弹幕输入和发送
function testDanmakuInput() {
    console.log('📝 测试弹幕输入...');

    // 显示弹幕输入框
    if (window.danmakuSystem) {
        window.danmakuSystem.showDanmakuInput();
        console.log('✅ 弹幕输入框已显示');

        // 自动填入测试内容
        const input = document.getElementById('danmaku-input');
        if (input) {
            input.value = '这是一条测试弹幕！';
            console.log('✅ 已填入测试弹幕内容');
        }
    }
}

// 测试弹幕开关
function testDanmakuToggle() {
    console.log('🔄 测试弹幕开关...');

    if (window.danmakuSystem) {
        const originalState = window.danmakuSystem.enabled;

        // 切换状态
        window.danmakuSystem.toggleDanmaku();
        console.log(`✅ 弹幕状态切换为: ${window.danmakuSystem.enabled ? '开启' : '关闭'}`);

        // 再次切换回原状态
        setTimeout(() => {
            window.danmakuSystem.toggleDanmaku();
            console.log(`✅ 弹幕状态恢复为: ${window.danmakuSystem.enabled ? '开启' : '关闭'}`);
        }, 2000);
    }
}

// 主测试函数
function runAllTests() {
    console.log('🚀 开始弹幕功能全面测试...');

    // 等待页面完全加载
    setTimeout(() => {
        if (testDanmakuSystem()) {
            console.log('✅ 基础功能测试通过');

            // 运行其他测试
            setTimeout(() => testWebSocketConnection(), 1000);
            setTimeout(() => testDanmakuInput(), 3000);
            setTimeout(() => testDanmakuToggle(), 5000);

            console.log('🎉 所有测试已启动，请观察控制台输出和界面效果');
        } else {
            console.error('❌ 基础功能测试失败');
        }
    }, 1000);
}

// 导出测试函数
window.testDanmaku = {
    runAllTests,
    testDanmakuSystem,
    testDisplayDanmaku,
    testWebSocketConnection,
    testDanmakuInput,
    testDanmakuToggle
};

console.log('📋 弹幕测试工具已加载');
console.log('运行 testDanmaku.runAllTests() 开始完整测试');
console.log('或运行单个测试函数，如 testDanmaku.testDisplayDanmaku()');
