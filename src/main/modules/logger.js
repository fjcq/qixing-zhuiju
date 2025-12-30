const fs = require('fs');
const path = require('path');
const os = require('os');

// 检查是否为开发模式
const isDev = process.argv.includes('--dev');

// 创建日志文件记录错误
function logToFile(message) {
    try {
        const logPath = path.join(os.tmpdir(), 'qixing-zhuiju.log');
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(logPath, logMessage, 'utf8');
    } catch (err) {
        // 如果无法写入日志文件，静默忽略
    }
}

// 重写console.log和console.error以便在生产环境中也能记录和控制日志级别
function setupLogger() {
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;

    console.log = function (...args) {
        const message = args.join(' ');
        // 生产环境下只打印[MAIN]开头的重要日志
        if (isDev || message.startsWith('[MAIN]')) {
            originalConsoleLog(...args);
        }
        logToFile(`LOG: ${message}`);
    };

    console.error = function (...args) {
        const message = args.join(' ');
        originalConsoleError(...args);
        logToFile(`ERROR: ${message}`);
    };
}

module.exports = {
    setupLogger,
    logToFile,
    isDev
};
