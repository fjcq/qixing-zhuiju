# 磁力链播放阶段化进度反馈设计

**日期：** 2026-06-11
**项目：** 七星追剧 (Electron 桌面应用)
**范围：** 渲染进程外链页 + 主进程 IPC + 播放器窗口协同

---

## 1. 背景与目标

### 1.1 现状问题

用户在外链页选择磁力链文件 → 点击播放 → 视频实际开始播放之间存在 **3 段串行等待**,总耗时通常 5-60 秒不等:

| 阶段 | 内部操作 | 典型耗时 | 当前反馈 |
| ------ | ------ | ------ | ------ |
| A. 磁力准备 | webtorrent `c.add()` → 元数据就绪 → `startFileStream()` (HTTP server listen) | 5-30s | **进入时显示一次"正在准备: filename",之后完全无变化** |
| B. 打开播放器 | `qixingApp.createPlayerWindow()` → BrowserWindow 加载 → IPC 握手 | 1-5s | **完全无反馈** |
| C. 视频缓冲 | 播放器窗口 `<video>` 设置 src → 加载 streamUrl → `canplay` | 1-30s | **完全无反馈(发生在新窗口,主窗口无事件订阅)** |

子进程 `magnetHandler.mjs` 内部其实**已经在阶段 A 持续发送 `progress` 消息**(`status: 'connecting' | 'downloading' | 'completed'`),主进程也会把 `progress` 消息转发为 `magnet-download-progress` 事件到主窗口 —— **但主窗口的 `PlayUrlController` 没有订阅这个事件**,所以这些数据全部被丢弃。

### 1.2 目标

让用户**从点击播放到视频真正开始播放的每一秒都看得到有意义的变化**,消除"卡住没反应"的误判:

- 把当前 1 个静态文本 + 1 个静态 0% 进度条,扩展为 **5-6 个阶段化状态** + 真实下载百分比
- **不引入新依赖**,纯渲染层 + IPC 协同改动
- 改动不破坏现有 magnet 解析(parse)阶段的进度反馈(那个阶段已经有 `magnet-progress` 事件正常工作)

---

## 2. 范围

### 2.1 In Scope

- `src/renderer/js/controllers/PlayUrlController.js`:`_playMagnetFile` 内部增加阶段化 `_showProgress` 调用 + 订阅 `magnet-download-progress` 事件
- `src/renderer/js/controllers/magnetParserAdapter.js`:新增 `onDownloadProgress(callback)` / `removeDownloadProgressListener()`,对应 IPC 事件 `magnet-download-progress`(事件已存在,仅补前端订阅)
- `src/preload.js`:暴露 `onPlayerLoaded` / `onPlayerCanplay` / `removePlayerCanplayListener` 三个 IPC 桥(包装 `ipcRenderer.on/off`)
- `src/main/modules/ipcHandler.js`:
  - `createPlayerWindow` 后,在 `did-finish-load` 时给主窗口 send `player-loaded` 事件
  - 转发播放器窗口的 `player-canplay` 事件到主窗口
- `src/renderer/js/player.js`:在 `<video>` 触发 `canplay` 事件时,通过 `ipcRenderer.send('player-canplay')` 通知主进程
- `src/renderer/css/style.css`:进度条增加"阶段名"二级文字 + 不同阶段颜色变体

### 2.2 Out of Scope

- 不动 `magnetHandler.mjs` 子进程(它已经发够多消息了,前端订阅就行)
- 不动 `parse()` 阶段的进度反馈(已经工作正常)
- 不动普通 URL / 本地文件播放流程(它们没这么长的等待)
- 不重写 `_showProgress` 的核心逻辑,只扩展示例
- 不改 player.html / 播放器 UI 本身
- 不改 package.json / 构建脚本

---

## 3. 设计 §1 · 阶段定义

### 3.1 6 个阶段(从点击播放到视频开始播放)

| ID | 阶段名 | 触发点 | 阶段文本(二级) | 主进度条 |
| ------ | ------ | ------ | ------ | ------ |
| P1 | 准备播放资源 | `_playMagnetFile` 函数入口 | "① 准备播放资源" | 5% |
| P2 | 解析磁力元数据 | `_magnetParser.play()` 调用前 | "② 解析磁力元数据" | 10% |
| P2.1 | 连接 DHT/P2P | 子进程 `status: 'connecting'` | "② 连接 DHT/P2P 网络" | 10%(不变,等子进程有数据) |
| P2.2 | 下载中 | 子进程 `status: 'downloading'`,progress=X | "② 下载中: X% (M peers)" | **子进程 progress**(5-95%) |
| P3 | 启动流服务器 | `_magnetParser.play()` resolve | "③ 启动流服务器" | 30% |
| P4 | 打开播放器 | `_openPlayer()` 调用前 | "④ 打开播放器窗口" | 40% |
| P5 | 视频缓冲中 | 收到 `player-loaded` 事件 | "⑤ 视频缓冲中" | 50%(不变) |
| P6 | 播放就绪 | 收到 `player-canplay` 事件 | "⑥ 播放就绪" | 100% → 隐藏 |

**进度条规则**(消除原文档的 P2.1/P2.2 重叠):

- **主进度条显示规则**:子进程 progress 字段**优先**(此时它反映真实下载量);无子进程数据时,使用阶段默认值(10% / 30% / 40% / 50% / 100%)
- **二级文本显示当前阶段名 + 子进程给的实时数据**(peer 数 / 下载速度 / ETA)
- 子进程 `progress` 在 P5 期间通常已接近 100%(webtorrent 必须有数据才能 stream),所以 P5 主进度条**不跟随子进程**,固定 50% → 100%(由 player-canplay 触发)
- 视觉:阶段切换时主进度条平滑过渡(`transition: width 200ms`)

### 3.2 进度条视觉

进度条维持现有结构(`#play-url-progress > .progress-fill` + 文本),新增**二级文本**(阶段名)显示在进度条上方:

```text
┌───────────────────────────────────────┐
│ 阶段: 下载中 (45%)                     │  ← 二级文本(小字,灰色)
│ ███████████░░░░░░░░░░░░░░░░░░░░  30%  │  ← 主进度条(原结构)
│ 解析磁力元数据: 找到 12 个 peer...     │  ← 详细状态文本(原文案)
└───────────────────────────────────────┘
```

颜色变体:

- info(默认,蓝色):P1-P5 全部阶段
- success(绿色):P6 完成
- error(红色):失败时
- warning(黄色):停滞 / no-peers(由 `magnet-download-progress` 携带 `status: 'no-peers-warning' | 'slow-warning'` 触发)

---

## 4. 设计 §2 · 数据流与时序

### 4.1 时序图

```text
用户点击 [播放]
   │
   ▼
PlayUrlController._playMagnetFile  (P1: _showProgress("准备播放: xxx", 5))
   │
   ├─ _magnetParser.play() ──────────► 主进程 invoke('play-magnet-file', ...)
   │                                       │
   │                                       ▼
   │                                  磁力子进程 c.add(...)
   │                                       │
   │                                       │ ── 持续发 progress ──►
   │                                       │   { status: 'connecting' }
   │                                       │   { status: 'downloading', progress: 5 }
   │                                       │   { status: 'downloading', progress: 30 }
   │                                       ▼
   │   ◄── magnet-download-progress (主窗口订阅)
   │   P2.1 / P2.2: _showProgress 实时更新
   │
   │   c.add 回调 + startFileStream 完成
   │   ◄── play() resolve({ streamUrl })
   │
   ▼ P3: _showProgress("启动流服务器...", 35)
   │
   ├─ _openPlayer() ──────────────────► 主进程 invoke('open-player', videoData)
   │                                       │
   │                                       ▼
   │                                  qixingApp.createPlayerWindow(videoData)
   │                                       │
   │                                       ├─ BrowserWindow did-finish-load
   │                                       │  ──► send 'player-loaded' ─────► 主窗口
   │                                       │  P4: _showProgress("打开播放器...", 40)
   │                                       │
   │                                       │  视频开始加载 streamUrl
   │                                       │  ...
   │                                       │  <video> 'canplay' event
   │                                       │  ──► ipc.send('player-canplay') ──► 主进程
   │                                       │                                    │
   │                                       │              send 'player-canplay' ──► 主窗口
   │                                       │              P6: _hideProgress()
   │                                       │
   │   ◄── _openPlayer resolve
   │   (这里 _hideProgress **不能** 立即调用,等 player-canplay)
   │
   ▼ (进度条继续显示 P5 → P6 状态)
```

### 4.2 关键事件表

| 事件 | 主进程 → 主窗口 | 主进程 → 播放器窗口 | 触发时机 | 载荷 |
| ------ | ------ | ------ | ------ | ------ |
| `magnet-download-progress` | ✅(已存在) | ✅(已存在) | 子进程 `progress` 消息 | `{fileName, progress, downloaded, total, wires, downloadSpeed, numPeers, eta, status}` |
| `magnet-progress` | ✅(已存在) | ❌ | 子进程 `log` 消息 / 解析阶段 | `{status, progress: 0, source: 'log'}` |
| `player-loaded`(**新增**) | ✅(新增) | ❌ | playerWindow `did-finish-load` | `{}` |
| `player-canplay`(**新增**) | ✅(转发) | ❌ | 播放器窗口 `video.canplay` | `{}` |

### 4.3 状态机扩展

复用现有 PlayUrlController 状态机:

- `PARSE_PROGRESS`(已存在):resolve 阶段(用户输入磁力链 → 文件列表)
- `FILES_READY`(已存在):文件列表已展示
- `PLAYING`(已存在):**点击播放后**,但当前此状态在 `_openPlayer` resolve 后立即 _hideProgress

**改造**:PLAYING 状态期间持续 _showProgress 阶段信息,直到收到 `player-canplay` 才 _hideProgress (而非 `_openPlayer resolve`)。

---

## 5. 设计 §3 · 改动清单

### 5.1 PlayUrlController.js

新增/修改:

- `_playMagnetFile(magnetUri, file)` 重构:
  - 第 500 行附近 `this._showProgress('准备播放: ${file.name}', 0)` → 改为 `('准备播放资源...', 5)`
  - 调 `_magnetParser.play()` 前:`_showProgress('解析磁力元数据...', 10)` + 启动 download-progress 监听
  - 调 `_openPlayer()` 前:`_showProgress('打开播放器...', 40)`
  - **不**在 `_openPlayer` resolve 之后调 `_hideProgress`,而是订阅 `player-canplay` 事件
- 新增 `_handleMagnetDownloadProgress(data)`:处理 `magnet-download-progress` 事件,把子进程的 `status` + `progress` 映射到 P2.1 / P2.2 / P5 状态
- 新增 `_handlePlayerLoaded()`:收到 `player-loaded` → `_showProgress('视频缓冲中...', 50)`
- 新增 `_handlePlayerCanplay()`:收到 `player-canplay` → `_hideProgress()`(允许约 200ms 渐隐动画)
- 新增 `_showStageProgress(stageId, statusText, pct, variant)`:统一封装,自动加上"阶段: X"二级文本
- 订阅/反订阅:`_playMagnetFile` 开始订阅,`_hideProgress` 或错误时反订阅(避免内存泄露)
- 状态机:`PLAYING` 状态在 player-canplay 才退出(之前在 _openPlayer resolve 就退)

### 5.2 magnetParserAdapter.js

新增:

- `onDownloadProgress(callback)`:订阅 `magnet-download-progress` 事件
- `removeDownloadProgressListener()`:解绑

事件已存在,只补前端订阅层。命名与 `onProgress`/`removeProgressListener` 对齐(后者订阅 `magnet-progress`)。

### 5.3 preload.js

新增:

- `onPlayerLoaded(callback)` → `ipcRenderer.on('player-loaded', ...)`
- `onPlayerCanplay(callback)` → `ipcRenderer.on('player-canplay', ...)`
- `removePlayerLoadedListener()` / `removePlayerCanplayListener()` → `removeAllListeners`

### 5.4 ipcHandler.js

新增:

- `qixingApp.createPlayerWindow` 包装处(`createPlayerWindow` 函数体):
  - 监听 `playerWindow.webContents.on('did-finish-load', () => { mainWindow.webContents.send('player-loaded') })`
- 监听 `ipcMain.on('player-canplay', ...)`(来自播放器窗口的 send),转发 `mainWindow.webContents.send('player-canplay', {})`

### 5.5 player.js

新增:

- 在 `<video>` 元素 `addEventListener('canplay', () => { window.electron.ipcRenderer.send('player-canplay') })` 一处
- 写在 player 初始化或首次 setupVideoEvents 时,只注册一次

### 5.6 style.css

新增/调整:

- `.play-url-progress` 内增加 `.progress-stage` 二级文本样式(12px,色值用 `var(--text-secondary)`,与主文本对比)
- `.play-url-progress.is-warning .progress-fill` 黄色变体(配合 `status: 'no-peers-warning' | 'slow-warning'`)
- `.play-url-progress.is-success .progress-fill` 绿色变体(配合 P6 完成)
- 进度条 fill 过渡:已有 `--duration-fast`,无需调整

---

## 6. 设计 §4 · 错误处理

### 6.1 子进程启动失败

- 子进程 `error` 事件 → 主进程转发为 `magnet-progress` 事件
- PlayUrlController `_handleMagnetProgress` 已支持 `error` variant,自动 _showProgress('播放失败: ...', 0, 'error')
- 进度条变红 + 阶段名 "播放失败"
- 用户可重新点击播放按钮

### 6.2 playerWindow 加载超时(罕见,>30s)

- 进度条会一直停留在 P5 "视频缓冲中",但 download-progress 还在持续更新百分比
- 30s 无 canplay 不强制超时(用户可能有大文件需要缓冲)
- 用户可手动点 "取消" 按钮(若有)或关掉外链页

### 6.3 重复订阅防护

- 关键:每个 `_playMagnetFile` 调用前 `_magnetParser.removeDownloadProgressListener()` + `removePlayerLoadedListener()` + `removePlayerCanplayListener()`,避免重复订阅造成回调多次触发
- 防御性清理符合项目 `magnetParserAdapter.js` 已有模式(第 56 行 `this.removeProgressListener()`)

### 6.4 取消场景

- 用户点 "取消" → `_handleParseCancel` 已处理 resolve 阶段
- 播放阶段暂未提供取消 UI(后续可加),失败 / 成功路径都清理监听器

---

## 7. 设计 §5 · 验证方案

### 7.1 单元测试(Jest)

- `PlayUrlController._playMagnetFile` 阶段切换:
  - mock `_magnetParser.play` 模拟不同 `magnet-download-progress` payload,断言 `_showProgress` 接收的 stage/text/pct 序列
  - 验证 `_openPlayer` 之后**不**调用 `_hideProgress`
  - 验证收到 `player-canplay` 事件后才调 `_hideProgress`
- `_handleMagnetDownloadProgress`:
  - `status: 'connecting'` → 阶段 P2.1,文本含 "连接"
  - `status: 'downloading', progress: 30` → 阶段 P2.2,文本含 "30%"
  - `status: 'no-peers-warning'` → variant = 'warning'
  - `status: 'slow-warning'` → variant = 'warning'

### 7.2 手动 e2e 验证

- 启动应用 → 粘贴磁力链 → 点解析 → 文件列表 → 点播放
- 观察外链页进度条:
  - 5% "准备播放资源..."
  - 10% "解析磁力元数据..."
  - 15% "连接 DHT 网络..."(子进程 connecting)
  - 15-30% "下载中: X% (M peers)"(子进程 downloading)
  - 35% "启动流服务器..."
  - 40% "打开播放器..."
  - 50% "视频缓冲中..."(收到 player-loaded)
  - 50-95% "视频缓冲中: X%..."
  - 100% / 隐藏(收到 player-canplay,视频开始播放)
- 视觉检查:进度条平滑,无跳变,二级阶段名清楚

### 7.3 全量回归

- `npx jest` 全量 5 套件 101 测试必须仍通过
- ESLint 0 错误 0 警告(对所有改动文件)
- `node --check` 语法检查所有 JS 文件

---

## 8. 设计 §6 · 风险与回退

| 风险 | 缓解 |
| ------ | ------ |
| `did-finish-load` 触发过早(视频还没开始缓冲) | 进度条停留在 P4 短暂,player-loaded 之后立刻 P5;用户感知不到 |
| 子进程 `progress` 消息延迟 / 丢失 | 进度条数字会卡住,但状态文字 "下载中" / "连接 DHT" 仍能反映;最坏情况卡 5-30s 但有文字变化 |
| `canplay` 事件不触发(罕见,某些流格式) | 进度条停在 P5,但播放器窗口内 video 元素有 fallback 加载提示 |
| IPC 事件重复订阅导致回调多次 | `onDownloadProgress` / `onPlayerLoaded` 内部防御性 `removeListener` |
| 改动影响现有 parse 阶段进度 | parse 阶段用 `magnet-progress` 事件,本次不改;回归测试覆盖 |

回退方案:如全链路方案 B 出问题,可临时在 `_openPlayer` resolve 之后立即 `_hideProgress`,降级为方案 A(只覆盖 P1-P4)。

---

## 9. 不在范围但可后续迭代

- 进度条增加预估剩余时间(子进程 `eta` 字段已发,前端可显示"还剩 X 分钟")
- 进度条增加取消按钮
- 跨页面保持进度(主窗口 + 播放器窗口同步显示"缓冲中"状态)
- 复用方案 B 的 IPC 事件给普通 URL 播放(普通 URL 也有缓冲等待,目前同样无反馈)
