// 版本配置文件 - 统一管理应用版本号
// 修改这里的版本号会自动同步到所有使用的地方

const APP_VERSION = 'v1.2.5';
const APP_VERSION_NUMBER = '1.2.5'; // 不带v前缀的版本号

// 版本信息对象
const VERSION_INFO = {
    version: APP_VERSION,
    versionNumber: APP_VERSION_NUMBER,
    releaseDate: '2025-08-06',
    codeName: '最新版本'
};

// 导出版本信息
if (typeof module !== 'undefined' && module.exports) {
    // Node.js 环境
    module.exports = {
        APP_VERSION,
        APP_VERSION_NUMBER,
        VERSION_INFO
    };
} else {
    // 浏览器环境
    window.APP_VERSION = APP_VERSION;
    window.APP_VERSION_NUMBER = APP_VERSION_NUMBER;
    window.VERSION_INFO = VERSION_INFO;
}