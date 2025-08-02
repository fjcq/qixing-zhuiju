# 七星追剧 - Copilot 指令

<!-- 为 Copilot 提供工作区特定的自定义指令 -->

## 项目概述

这是一个基于 Electron 的 Windows 桌面应用程序，名为"七星追剧"，用于播放苹果CMS资源站的影视节目。项目已完成清理优化，保持简洁的项目结构。

## 项目结构

```text
七星追剧/
├── src/                    # 源代码目录
│   ├── renderer/          # 渲染进程
│   │   ├── index.html     # 主窗口界面
│   │   ├── player.html    # 播放器窗口界面
│   │   ├── logo.png       # 界面Logo（162*58）
│   │   ├── css/          # 样式文件
│   │   │   ├── style.css      # 主样式
│   │   │   ├── components.css # 组件样式
│   │   │   └── routes.css     # 路由样式
│   │   └── js/           # JavaScript模块
│   │       ├── api.js         # API服务
│   │       ├── storage.js     # 本地存储
│   │       ├── components.js  # UI组件
│   │       ├── app.js         # 主应用逻辑
│   │       └── player.js      # 播放器逻辑
│   └── preload.js        # 预加载脚本
├── assets/               # 资源文件
│   ├── icon.png         # 应用图标（256*256）
│   └── logo.png         # 应用Logo（162*58）
├── main.js              # Electron主进程
├── package.json         # 项目配置
├── build.bat           # 完整编译工具
├── dev.bat             # 开发启动工具
├── quick-build.bat     # 快速编译工具
└── README.md           # 项目文档
```

## 技术栈

- **Electron 27.x** - 桌面应用框架，已禁用硬件加速解决GPU问题
- **Node.js** - 运行时环境
- **HLS.js** - 视频播放库，支持m3u8格式
- **Axios** - HTTP请求库
- **原生Web技术** - HTML/CSS/JavaScript

## 功能特性

1. **多站点支持** - 支持多个苹果CMS API站点
2. **视频搜索** - 按关键词和分类搜索影视内容
3. **视频播放** - 支持m3u8格式的在线播放
4. **播放历史** - 记录观看历史和播放进度
5. **自动播放** - 支持自动播放下一集
6. **响应式设计** - 适配不同屏幕尺寸
7. **无菜单栏UI** - 简洁现代的界面设计

## 开发规范

### 代码风格
- 使用ES6+语法
- 采用模块化设计
- 遵循语义化命名
- 添加适当的注释
- 优先使用const/let而非var

### 文件命名
- HTML文件使用kebab-case
- CSS类名使用kebab-case
- JavaScript变量使用camelCase
- 常量使用UPPER_SNAKE_CASE
- 批处理文件使用kebab-case

### 界面设计
- Logo尺寸：162*58像素，自适应显示
- 图标尺寸：256*256像素（编译要求）
- 深色主题设计
- 响应式布局
- 简洁无菜单栏界面

## 构建和部署

### 开发环境
```bash
npm install     # 安装依赖
npm start      # 启动开发服务器
dev.bat        # Windows批处理启动
```

### 编译发布
```bash
npm run dist        # 标准编译
build.bat          # 完整编译（推荐）
quick-build.bat    # 快速编译
```

### 输出文件
- 编译输出：`dist/win-unpacked/七星追剧.exe`
- 发布方式：打包整个 `win-unpacked` 文件夹

## 技术特点

### Electron配置
- 已禁用硬件加速（解决GPU崩溃）
- 隐藏菜单栏（autoHideMenuBar + setMenuBarVisibility）
- 配置代码签名跳过
- 支持多窗口（主窗口 + 播放器窗口）

### API集成
- 所有API请求通过ApiService类处理
- 支持JSON和XML格式的苹果CMS API
- 实现错误处理和重试机制

### 数据存储
- 使用localStorage存储用户数据
- 播放历史、观看进度、用户设置等数据持久化

### 播放器功能
- 基于HLS.j实现m3u8视频播放
- 支持播放进度保存和恢复
- 实现自动播放下一集功能

## 注意事项

1. **GPU兼容性** - 已禁用硬件加速，避免GPU进程崩溃
2. **图标要求** - 编译需要256*256图标，界面Logo为162*58
3. **代码签名** - 已配置跳过签名避免权限问题
4. **界面优化** - 无菜单栏设计，Logo自适应显示
5. **项目清理** - 已删除所有测试文件和多余批处理文件
6. **路径处理** - 注意渲染进程中的资源路径引用
