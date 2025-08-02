# 七星追剧 - Qixing Zhuiju

基于 Electron 的 Windows 桌面影视播放应用，支持苹果CMS资源站的视频播放。

## 🚀 快速开始

### 开发环境

```bash
npm install          # 安装依赖
npm start           # 启动开发服务器
# 或者使用
dev.bat             # Windows 批处理启动
```

### 编译发布

```bash
npm run dist        # 标准编译
# 或者使用批处理工具
build.bat          # 完整编译（推荐）
quick-build.bat    # 快速编译
```

## 📁 项目结构

```text
七星追剧/
├── src/                    # 源代码目录
│   ├── renderer/          # 渲染进程
│   │   ├── index.html     # 主界面
│   │   ├── player.html    # 播放器界面
│   │   ├── css/          # 样式文件
│   │   └── js/           # JavaScript模块
│   └── preload.js        # 预加载脚本
├── assets/               # 资源文件
│   ├── icon.png         # 应用图标
│   └── logo.png         # 应用Logo
├── main.js              # 主进程
├── package.json         # 项目配置
├── build.bat           # 编译工具
├── dev.bat             # 开发启动
└── quick-build.bat     # 快速编译
```

## ⚡ 功能特性

- ✅ 多站点支持（苹果CMS API）
- ✅ 视频搜索和分类浏览  
- ✅ 在线播放（支持m3u8）
- ✅ 播放历史记录
- ✅ 自动播放下一集
- ✅ 响应式界面设计
- ✅ 无菜单栏简洁UI

## 🛠️ 技术栈

- **Electron** - 桌面应用框架
- **HLS.js** - 视频播放引擎
- **Axios** - HTTP请求库
- **原生Web技术** - HTML/CSS/JavaScript

## 📦 编译输出

编译完成后，可执行文件位于：

```text
dist/win-unpacked/七星追剧.exe
```

## 🎯 发布说明

1. 运行 `build.bat` 编译应用
2. 打包 `dist/win-unpacked/` 整个文件夹
3. 分发给用户，解压即用

## 🔧 开发工具

### 批处理脚本

- `build.bat` - 完整编译工具，包含环境检查和详细提示
- `quick-build.bat` - 快速编译，适合频繁测试
- `dev.bat` - 开发模式启动，等同于 npm start

### 系统要求

- Windows 10+
- Node.js 16+
- 至少 4GB 内存

---

**作者**: 止水  
**版本**: 1.0.0  
**协议**: MIT License
