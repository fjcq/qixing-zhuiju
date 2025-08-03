// 测试单实例功能的简单脚本
const { app } = require('electron');

console.log('测试进程 PID:', process.pid);

// 请求单实例锁
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    console.log('应用已在运行，退出当前实例');
    app.quit();
    process.exit(0);
} else {
    console.log('获得单实例锁，这是第一个实例');

    // 监听第二个实例启动
    app.on('second-instance', () => {
        console.log('检测到第二个实例启动！');
    });

    // 保持进程运行
    app.whenReady().then(() => {
        console.log('应用准备就绪，按 Ctrl+C 退出');

        // 保持进程运行
        setInterval(() => {
            console.log('第一个实例仍在运行...');
        }, 5000);
    });
}

// 处理退出信号
process.on('SIGINT', () => {
    console.log('收到退出信号，正在退出...');
    app.quit();
});
