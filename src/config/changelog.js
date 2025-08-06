// 更新日志配置文件 - 统一管理应用更新日志
// 修改这里的内容会自动同步到关于界面

const CHANGELOG_DATA = [
    {
        version: 'v1.2.5',
        date: '2025-08-06',
        items: [
            '🔧 修复播放器置顶按钮重复触发的问题，确保每次点击只触发一次',
            '🎯 优化事件绑定机制，避免重复绑定导致的功能异常',
            '💬 改进置顶状态提示，移除冗余提示只保留最终结果',
            '🐛 修复T键快捷键与置顶按钮状态不同步的问题',
            '🧹 清理项目多余的测试文件，保持项目结构简洁',
            '⚡ 增强播放器稳定性和用户体验'
        ]
    },
    {
        version: 'v1.2.4',
        date: '2025-08-05',
        items: [
            '📤 新增播放器分享按钮，播放时可随时分享当前剧集',
            '🎯 优化详情页分享按钮布局，移至标题行右上角节省空间',
            '📋 简化剪切板检测逻辑，按Ctrl+V时智能判断分享内容',
            '🎨 改进分享按钮样式，采用紧凑型设计和统一主题色',
            '⚡ 完善分享功能兼容性，播放器和详情页使用相同算法',
            '🔧 优化事件处理机制，增强用户交互体验'
        ]
    },
    {
        version: 'v1.2.3',
        date: '2025-08-04',
        items: [
            '🎯 新增播放器窗口置顶功能，保持播放器始终在最顶层',
            '📱 新增投屏功能，支持将视频投屏到电视等大屏设备',
            '🎮 播放器界面新增置顶和投屏按钮，操作简单便捷',
            '🔍 投屏功能支持自动发现多种设备类型和协议',
            '⌨️ 支持按T键快速切换置顶状态',
            '🧹 移除冗余的功能说明文档，保持项目简洁'
        ]
    },
    {
        version: 'v1.2.2',
        date: '2025-08-04',
        items: [
            '🔧 修复编译图标问题，使用正确的.ico格式图标文件',
            '🛠️ 优化编译工具，推荐使用electron-packager避免代码签名问题',
            '📦 更新编译脚本，新增npm run pack命令',
            '🔄 同步更新批处理文件和文档说明',
            '📝 完善版本信息同步，更新所有相关文件',
            '🎯 改进编译输出路径和操作指南'
        ]
    },
    {
        version: 'v1.2.1',
        date: '2025-08-03',
        items: [
            '🎨 新增WIN11风格圆角窗口设计',
            '🆕 新增关于页面，展示软件详细信息',
            '🔗 新增GitHub仓库链接，支持外部浏览器打开',
            '🔧 优化自定义标题栏和窗口控制功能',
            '✨ 增强亚克力透明效果和视觉层次',
            '🛡️ 改进外部链接安全处理机制'
        ]
    },
    {
        version: 'v1.2.0',
        date: '2025-08-03',
        items: [
            '🆕 新增弹幕功能，支持实时弹幕和时间轴弹幕双模式',
            '🆕 新增悬停式弹幕输入，鼠标悬停播放器自动显示输入框',
            '🆕 新增多彩弹幕样式，支持7种颜色和3种大小',
            '🆕 新增智能弹幕房间，基于视频内容自动分配',
            '🔧 优化弹幕输入交互，解决与播放器操作的冲突',
            '🐛 修复播放历史存储问题，确保数据持久化保存'
        ]
    },
    {
        version: 'v1.1.0',
        date: '2025-08-03',
        items: [
            '🆕 新增线路别名功能，支持自定义线路显示名称',
            '🆕 新增线路屏蔽功能，可屏蔽指定播放线路',
            '🆕 新增配置导入导出功能，支持数据备份和迁移',
            '🔧 优化站点管理界面，美化UI交互体验',
            '🐛 修复屏蔽线路过滤逻辑，提高播放稳定性'
        ]
    }
];

// 生成更新日志HTML的函数
function generateChangelogHTML(maxVersions = 6) {
    const versions = CHANGELOG_DATA.slice(0, maxVersions);
    return versions.map(version => `
                                    <div class="changelog-item">
                                        <div class="version-tag">${version.version}</div>
                                        <div class="changelog-content">
                                            <h4>${version.date}</h4>
                                            <ul>
                                                ${version.items.map(item => `<li>${item}</li>`).join('')}
                                            </ul>
                                        </div>
                                    </div>`).join('');
}

// 导出配置
if (typeof module !== 'undefined' && module.exports) {
    // Node.js 环境
    module.exports = {
        CHANGELOG_DATA,
        generateChangelogHTML
    };
} else {
    // 浏览器环境
    window.CHANGELOG_DATA = CHANGELOG_DATA;
    window.generateChangelogHTML = generateChangelogHTML;
}
