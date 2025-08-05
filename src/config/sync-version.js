#!/usr/bin/env node

/**
 * 版本同步脚本
 * 自动将package.json中的版本号同步到所有相关文件
 */

const fs = require('fs');
const path = require('path');

// 读取package.json获取当前版本
function getCurrentVersion() {
    const packagePath = path.join(__dirname, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return packageJson.version;
}

// 更新版本配置文件
function updateVersionConfig(version) {
    const versionPath = path.join(__dirname, 'version.js');
    const versionWithV = `v${version}`;

    const content = `// 版本配置文件 - 统一管理应用版本号
// 修改这里的版本号会自动同步到所有使用的地方

const APP_VERSION = '${versionWithV}';
const APP_VERSION_NUMBER = '${version}'; // 不带v前缀的版本号

// 版本信息对象
const VERSION_INFO = {
    version: APP_VERSION,
    versionNumber: APP_VERSION_NUMBER,
    releaseDate: '${new Date().toISOString().split('T')[0]}',
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
}`;

    fs.writeFileSync(versionPath, content, 'utf8');
    console.log(`✅ 版本配置文件已更新: ${versionWithV}`);
}

// 主函数
function main() {
    try {
        const version = getCurrentVersion();
        console.log(`📦 当前版本: ${version}`);

        updateVersionConfig(version);

        console.log('🎉 版本同步完成！');
        console.log('📝 请记得：');
        console.log('   1. 更新 CHANGELOG.md 中的版本信息');
        console.log('   2. 更新 src/config/changelog.js 中的更新内容');
        console.log('   3. 提交所有更改到Git');

    } catch (error) {
        console.error('❌ 版本同步失败:', error.message);
        process.exit(1);
    }
}

// 如果是直接运行这个脚本
if (require.main === module) {
    main();
}

module.exports = { getCurrentVersion, updateVersionConfig };
