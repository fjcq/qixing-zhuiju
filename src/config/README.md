# 版本管理系统

本项目采用自动化版本管理系统，简化版本更新流程。

## 📁 文件结构

```
src/config/
├── version.js          # 版本号全局配置
├── changelog.js        # 更新日志配置
└── sync-version.js     # 版本同步脚本
```

## 🚀 更新版本流程

### 1. 更新版本号

```bash
# 方法1：使用npm version命令（推荐）
npm version patch    # 修复版本 1.2.4 -> 1.2.5
npm version minor    # 功能版本 1.2.4 -> 1.3.0
npm version major    # 主要版本 1.2.4 -> 2.0.0

# 方法2：手动修改package.json后同步
npm run sync-version
```

### 2. 更新更新日志

编辑 `src/config/changelog.js`，在 `CHANGELOG_DATA` 数组开头添加新版本：

```javascript
const CHANGELOG_DATA = [
    {
        version: 'v1.2.5',  // 新版本
        date: '2025-08-06',
        items: [
            '🆕 新功能描述',
            '🔧 修复的问题',
            '✨ 优化的体验'
        ]
    },
    // ... 其他版本
];
```

### 3. 自动同步

版本号会自动同步到以下位置：

- ✅ 侧边栏版本显示
- ✅ 关于页面版本显示
- ✅ JavaScript默认版本号
- ✅ 更新日志会自动生成

## 🔧 配置文件说明

### version.js

- 存储全局版本号和版本信息
- 支持Node.js和浏览器环境
- 提供统一的版本号访问接口

### changelog.js

- 存储结构化的更新日志数据
- 提供HTML生成函数
- 支持自定义显示版本数量

### sync-version.js

- 从package.json读取版本号
- 自动更新version.js文件
- 生成带有发布日期的版本信息

## 📝 使用示例

### 在JavaScript中获取版本号

```javascript
// 浏览器环境
const version = window.APP_VERSION;           // "v1.2.4"
const versionNumber = window.APP_VERSION_NUMBER;  // "1.2.4"
const versionInfo = window.VERSION_INFO;      // 完整版本信息对象

// Node.js环境
const { APP_VERSION, VERSION_INFO } = require('./src/config/version.js');
```

### 在HTML中显示版本号

```html
<!-- 引入版本配置 -->
<script src="../config/version.js"></script>

<!-- 使用JavaScript设置版本号 -->
<script>
document.getElementById('version').textContent = window.APP_VERSION;
</script>
```

### 生成更新日志

```javascript
// 引入更新日志配置
<script src="../config/changelog.js"></script>

// 生成HTML
const changelogHTML = window.generateChangelogHTML(6); // 显示最近6个版本
document.getElementById('changelog-container').innerHTML = changelogHTML;
```

## 🎯 优势

1. **统一管理**: 所有版本信息集中管理，避免遗漏
2. **自动同步**: 一处修改，多处自动更新
3. **结构化数据**: 更新日志采用结构化存储，便于维护
4. **开发友好**: 提供npm脚本，简化操作流程
5. **减少错误**: 避免手动更新多个文件时的遗漏和错误

## 📋 版本发布检查清单

- [ ] 运行 `npm version [patch|minor|major]`
- [ ] 更新 `src/config/changelog.js` 中的更新内容
- [ ] 更新主要的 `CHANGELOG.md` 文件
- [ ] 测试应用，确保版本号正确显示
- [ ] 提交所有更改: `git commit -m "chore: release v1.2.5"`
- [ ] 创建发布包: `npm run pack`
- [ ] 推送到远程仓库: `git push`

## 🔄 迁移说明

如果您是从旧的手动版本管理迁移：

1. 运行 `npm run sync-version` 初始化版本配置
2. 将现有的更新日志内容迁移到 `changelog.js`
3. 删除HTML中硬编码的版本号和更新日志
4. 测试新系统是否正常工作

这个系统让版本管理变得简单而可靠！
