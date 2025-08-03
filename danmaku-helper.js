// 弹幕功能快速测试和演示
// 在播放器页面的开发者工具控制台中运行

console.log('🎬 七星追剧弹幕功能测试');
console.log('=============================');

// 检查弹幕系统状态
function checkDanmakuStatus() {
    console.log('📊 检查弹幕系统状态...');

    if (!window.danmakuSystem) {
        console.error('❌ 弹幕系统未初始化');
        return false;
    }

    console.log('✅ 弹幕系统已初始化');
    console.log(`   状态: ${window.danmakuSystem.enabled ? '开启' : '关闭'}`);

    // 检查UI元素
    const elements = {
        'danmaku-container': '弹幕显示容器',
        'danmaku-input-container': '弹幕输入容器',
        'danmaku-input': '弹幕输入框',
        'toggle-danmaku': '弹幕开关按钮',
        'send-danmaku': '发送按钮'
    };

    for (const [id, name] of Object.entries(elements)) {
        const element = document.getElementById(id);
        if (element) {
            console.log(`✅ ${name} - 已找到`);
        } else {
            console.error(`❌ ${name} - 未找到`);
        }
    }

    return true;
}

// 显示弹幕输入框
function showDanmakuInput() {
    console.log('📝 显示弹幕输入框...');

    if (window.danmakuSystem) {
        window.danmakuSystem.showDanmakuInput();
        console.log('✅ 弹幕输入框已显示');
        console.log('💡 现在您可以在输入框中输入弹幕内容');
    } else {
        console.error('❌ 弹幕系统未就绪');
    }
}

// 发送测试弹幕
function sendTestDanmaku(text = '这是一条测试弹幕！') {
    console.log(`💬 发送测试弹幕: ${text}`);

    if (!window.danmakuSystem) {
        console.error('❌ 弹幕系统未就绪');
        return;
    }

    // 模拟弹幕数据
    const testDanmaku = {
        text: text,
        color: '#ffffff',
        size: 'medium',
        user: 'test_user',
        time: Date.now(),
        local: true
    };

    window.danmakuSystem.displayDanmaku(testDanmaku);
    console.log('✅ 测试弹幕已发送');
}

// 发送彩色测试弹幕
function sendColorfulDanmaku() {
    console.log('🌈 发送彩色测试弹幕...');

    const colors = ['#ffffff', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff'];
    const messages = ['白色弹幕', '红色弹幕', '黄色弹幕', '绿色弹幕', '青色弹幕', '蓝色弹幕', '紫色弹幕'];

    colors.forEach((color, index) => {
        setTimeout(() => {
            const danmaku = {
                text: messages[index],
                color: color,
                size: 'medium',
                user: 'test_user',
                time: Date.now(),
                local: true
            };

            if (window.danmakuSystem) {
                window.danmakuSystem.displayDanmaku(danmaku);
                console.log(`✅ 发送${messages[index]}`);
            }
        }, index * 1000);
    });
}

// 启用弹幕功能
function enableDanmaku() {
    console.log('🔄 启用弹幕功能...');

    if (window.danmakuSystem) {
        if (!window.danmakuSystem.enabled) {
            window.danmakuSystem.toggleDanmaku();
        }
        console.log('✅ 弹幕功能已启用');
    }
}

// 快速测试所有功能
function quickTest() {
    console.log('🚀 开始快速测试...');

    if (!checkDanmakuStatus()) {
        console.error('❌ 弹幕系统检查失败，请确保播放器页面已正确加载');
        return;
    }

    // 启用弹幕
    enableDanmaku();

    // 3秒后显示输入框
    setTimeout(() => {
        showDanmakuInput();
    }, 1000);

    // 5秒后发送测试弹幕
    setTimeout(() => {
        sendTestDanmaku('欢迎使用七星追剧弹幕功能！');
    }, 3000);

    // 8秒后发送彩色弹幕
    setTimeout(() => {
        sendColorfulDanmaku();
    }, 5000);

    console.log('⏰ 测试进行中，请观察播放器界面...');
}

// 导出测试函数
window.danmakuTest = {
    checkStatus: checkDanmakuStatus,
    showInput: showDanmakuInput,
    sendTest: sendTestDanmaku,
    sendColorful: sendColorfulDanmaku,
    enable: enableDanmaku,
    quickTest: quickTest
};

console.log('🎉 弹幕测试工具已加载！');
console.log('');
console.log('📋 可用命令：');
console.log('  danmakuTest.quickTest()     - 快速完整测试');
console.log('  danmakuTest.checkStatus()   - 检查弹幕系统状态');
console.log('  danmakuTest.showInput()     - 显示弹幕输入框');
console.log('  danmakuTest.sendTest()      - 发送测试弹幕');
console.log('  danmakuTest.sendColorful()  - 发送彩色弹幕');
console.log('  danmakuTest.enable()        - 启用弹幕功能');
console.log('');
console.log('💡 建议先运行: danmakuTest.quickTest()');
console.log('');
console.log('⌨️ 快捷键操作：');
console.log('  回车键 - 打开弹幕输入框');
console.log('  ESC键  - 关闭弹幕输入框');
console.log('  回车键（输入框内）- 发送弹幕');
