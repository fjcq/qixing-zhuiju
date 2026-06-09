# 外链页面重构设计

**日期：** 2026-06-09
**项目：** 七星追剧 (Electron 桌面应用)
**范围：** 仅限渲染进程 #play-url-page 页面 + 周边 JS / CSS

---

## 1. 背景与目标

### 1.1 现状问题

当前 [index.html:215-287](file:///e:/止水制造/项目/七星追剧/src/renderer/index.html#L215-L287) 的"外链"页面将 4 类功能（网络链接、本地文件、磁力链、播放历史）**全部垂直堆叠**在同一个滚动页里，存在以下问题：

- **信息密度过大**：URL 输入区 + 本地文件区 + 磁力进度区 + 历史区同时可见，认知负担高
- **视觉无主次**：4 个 h3 + 段落说明 + type-tag 标签堆叠，缺乏视觉焦点
- **入口歧义**：用户拿到一个链接不知道该往哪个 section 填
- **重复操作**：URL 和磁力链都要手填且走不同 section，无法"粘贴即识别"

### 1.2 重构目标

以"**快速播放**"为核心场景，把 4 类入口统一为一个**智能识别**的巨输入框 + 底部「选择本地文件 / 查看历史」按钮组的极简结构，让用户：

- 粘贴任意内容 → 自动判断类型 → 点播放即可
- 点按钮进入辅助场景（手动选文件 / 历史再播）

---

## 2. 范围

### 2.1 In Scope

- `src/renderer/index.html` 中 `#play-url-page` 整个 section 替换
- 新增 `src/renderer/css/play-url.css`（外链页专用样式）
- 改造 `src/renderer/js/controllers/PlayUrlController.js`
- 新增 `src/renderer/js/controllers/inputRecognizer.js`
- 新增 `src/renderer/js/controllers/fileListRenderer.js`
- 复用现有 `src/main/scripts/magnetHandler.mjs`（不动）
- 复用现有 IPC 通道 `handle-magnet-link` 和事件 `onMagnetProgress`（不动）
- 复用 `src/renderer/js/storage.js` 的 play history API（按规范改造）

### 2.2 Out of Scope

- 不动 `player.html` / 播放器本身
- 不动主进程 `magnetHandler.mjs` 和 IPC 协议
- 不动"首页 / 搜索 / 详情 / 历史 Tab / 设置 / 关于"任何其他页面
- 不引入新依赖（WebTorrent 已经在 `magnet-runtime/` 中）
- 不改 package.json / 构建脚本

---

## 3. 设计 §1 · 整体页面架构

### 3.1 页面结构（自上而下）

```
┌─────────────────────────────────────────────┐
│ 顶部 Header：左"外链"标题，右侧"清空"图标   │
├─────────────────────────────────────────────┤
│                                             │
│        ┌─────────────────────────────┐      │
│        │   巨输入框（多行 ~50% 高）  │      │
│        │  输入视频链接 / 磁力链 /    │      │
│        │  本地路径 / Info Hash       │      │
│        └─────────────────────────────┘      │
│           识别徽章 [🌐 URL]（右上角）        │
│        ┌─────────────────────────────┐      │
│        │   ▶  立即播放（全宽按钮）   │      │
│        └─────────────────────────────┘      │
│                                             │
│   [磁力链解析进度区 · 默认隐藏]              │
│   [磁力链文件列表 · 解析后展开]              │
│                                             │
│   [📁 选择本地文件]  [🕘 查看历史]           │
│   ← 按钮组（无 Tab Bar）                    │
└─────────────────────────────────────────────┘
```

### 3.2 关键变化（相对现状）

- **移除** 4 个分散 section + type-tag 标签堆
- **移除** Tab Bar — 一个智能识别巨输入框覆盖 URL / 磁力 / 本地路径
- **保留** 磁力链文件列表渲染功能（迁入新结构）
- **新增** 智能识别徽章（实时显示识别结果）
- **新增** 两个文字/图标按钮：「选择本地文件」和「查看历史」

### 3.3 辅助入口

| 按钮 | 行为 |
| --- | --- |
| **选择本地文件** | 弹出系统文件选择器（通过 IPC 调主进程 dialog.showOpenDialog），选中后回填巨输入框并触发识别 |
| **查看历史** | 展开一个内联抽屉/折叠区，列出 `playHistory`，点击项直接走"立即播放"对应分支 |

---

## 4. 设计 §2 · 核心交互流程（智能识别）

### 4.1 主操作路径

#### 路径 A · 粘贴/输入字符串 → 点播放

1. 输入框字符变化 → 防抖 200ms → 调用 `detectInputType(input)`
2. 输入框右上角实时显示识别结果徽章：`🌐 URL` / `📁 本地` / `🧲 磁力` / `❓ 未知` / `空`
3. 用户点"立即播放"按钮 → 走对应分支：
   - **URL 命中** → 直接进入播放器
   - **本地路径命中** → 直接进入播放器（用 `file://` 协议）
   - **磁力链命中** → 进入磁力链解析流程（§5）
   - **未知** → 按钮置灰 + tooltip 提示

#### 路径 B · 拖拽文件到输入框

- 拖入时整个巨输入区高亮描边（紫蓝渐变）
- 拖入文件若是本地路径 → 等价于路径 A 的本地分支
- 拖入文本（magnet:/http 链接）→ 等价于路径 A 的粘贴

#### 路径 C · 辅助入口

- 点「选择本地文件」→ IPC 调主进程 `dialog.showOpenDialog` → 选中后回填巨输入框 → 触发识别
- 点「查看历史」→ 展开/折叠历史抽屉 → 列表项点击再播；右侧悬浮操作：删除 / 复制
- 历史抽屉展开时巨输入框和主操作按钮仍在原位（不切换视图）

#### 路径 D · 历史一键再播

- 点历史项 → 直接走"立即播放"对应分支（保留原 type 标记）
- 右侧悬浮操作：删除 + 复制链接

### 4.2 自动识别规则（纯前端，零网络调用）

| 输入模式 | 识别类型 | 触发播放的动作 |
| --- | --- | --- |
| `magnet:?xt=urn:btih:[a-fA-F0-9]{40}` | `magnet` | 走 §5 解析 |
| `[a-fA-F0-9]{40}` 单独 40 位 hex | `magnet` | 走 §5 解析（自动补 `magnet:?xt=urn:btih:` 前缀） |
| `[A-Z2-7]{32}` 单独 32 位 base32 | `magnet` | 走 §5 解析（自动补前缀） |
| `^https?://` 且后缀是 `.m3u8`/`.mp4`/`.mkv`/`.webm`/`.avi`/`.flv` | `url` | 直接播放 |
| `^https?://` 其它 | `url` | 直接播放（播放器内做 Content-Type 探测） |
| `^file://` 开头 | `local` | 直接播放（`file://` 协议） |
| Windows 盘符 `^[A-Za-z]:[\\/]` | `local` | 校验文件存在后直接播放（用 `file://` 协议） |
| UNC 路径 `^\\\\` | `local` | 同上 |
| POSIX 绝对路径 `^/` 且文件存在 | `local` | 直接播放 |
| 其它非空 | `unknown` | 按钮置灰 + tooltip"无法识别链接类型" |
| 空字符串 | `empty` | 按钮置灰 |

> 规则与现有 `PlayUrlController.isMagnetLink()` / `isNetworkUrl()` 完全兼容；新增规则（base32、file://、本地路径）作为补充。

---

## 5. 设计 §3 · 磁力链解析流程（方案 A · 原位展开）

### 5.1 阶段 1 · 进度区展开

- 巨输入区下方就地出现一个进度条 + 状态文本
- 替换"立即播放"按钮位置为"取消"按钮
- 文案动态：
  - 解析中：`🧲 正在解析磁力链...` + 进度条（百分比）
  - 下载中：`🧲 正在下载... 45% · 8.2 MB/s · 剩余 1分30秒` + 进度条
- 进度通过现有 `window.electron.onMagnetProgress` 事件接收
- **复用现有 `PlayUrlController.handleMagnetLink` 中的进度展示逻辑**（迁入新结构即可）

### 5.2 阶段 2 · 文件列表展开（**A 方案：原位展开**）

- 解析/下载完成 → 进度区收起 → 文件列表就地展开在巨输入区下方
- 列表项卡片结构：

```
┌──────────────────────────────────────────┐
│ 🎬 movie.mp4              1.2 GB · 1080p  │
│ 02:14:30                                  │
│                                    [播放] │
└──────────────────────────────────────────┘
```

- 每行：图标（视频/字幕/其他）+ 文件名 + 大小 + 分辨率/时长（从元数据读）+ 右侧"播放"按钮
- **智能识别"主视频文件"**：体积最大的 .mp4/.mkv/.webm/.avi 文件默认标记"⭐ 推荐"，可点其他文件切换
- 多文件时仅显示视频文件（自动过滤 .txt/.nfo/.jpg 等），可通过"显示全部"开关展开原始清单
- **复用现有 `showMagnetFilesList` 中的过滤和渲染逻辑**（迁入 `fileListRenderer.js`）

### 5.3 阶段 3 · 选中并播放

- 用户点某个文件 → 调用现有 IPC `handle-magnet-link` 的 `play` action（带 `fileName` 参数）
- 进入 `player.html` 加载播放
- 播放器内显示"磁力下载中..."的浮层直到缓存足够开始播放（流式边下边播 — 现有实现已支持）
- 历史 Tab 记录整条磁力链（不展开到文件），点历史项会重新进入文件选择步骤

### 5.4 错误处理

- 解析失败：进度区变红 + 文案 `❌ 解析失败：xxx` + "重试"按钮
- 0 个视频文件：列表区显示"该资源不含可播放视频文件" + "显示全部"开关
- 网络断开：进度区变橙 + 文案 `⚠ 网络断开，已暂停下载` + 恢复后自动续传
- 用户主动取消：进度区收起 + 输入框内容保留

---

## 6. 设计 §4 · 数据流与状态管理

### 6.1 状态机

```
[IDLE 空]
   ↓ 用户键入
[EDITING 编辑中]
   ↓ 防抖 200ms
[RECOGNIZED 已识别 type=X]
   ↓ 点立即播放
[PLAYING_DIRECT URL/本地命中 → 跳播放器]
   或 ↓
[PARSE_PROGRESS 磁力命中]
   ↓ 解析完成
[FILES_READY 文件列表展示]
   ↓ 用户选文件
[PLAYING_MAGNET 跳播放器]
   任意态点取消 → 回 [IDLE]
```

### 6.2 模块拆分

```
src/renderer/
├── index.html                              # 修改：替换 #play-url-page 整个内容
├── css/
│   ├── style.css                           # 调整：移除旧 play-url 相关样式
│   ├── routes.css                          # 微调（如有冲突）
│   └── play-url.css                        # 新增：外链页专用样式
└── js/controllers/
    ├── PlayUrlController.js                # 改造：拆分逻辑到子模块
    │   ├── inputRecognizer.js              # 新增：纯函数 detectInputType
    │   ├── fileListRenderer.js             # 新增：文件列表渲染（卡片、推荐标记）
    │   ├── magnetParserAdapter.js          # 新增：包装现有 IPC 调用
    │   ├── historyDrawer.js                # 新增：历史抽屉展开/折叠/再播/删除
    │   └── urlHistoryManager.js            # 新增：历史增删查（基于 storage.js）
└── (无 PlayUrlTabRouter.js)                  # 不再有 Tab Bar
```

**单一职责边界：**

| 模块 | 职责 | 副作用 | 可单测 |
|---|---|---|---|
| `inputRecognizer.js` | 纯函数 `detectInputType(str) → {type, payload}` | 无 | ✅ |
| `magnetParserAdapter.js` | 包装 IPC `handle-magnet-link` + 进度事件 | IPC 调用 | ❌（需 mock） |
| `fileListRenderer.js` | 接收 `files: ParsedFile[]` 渲染 DOM | DOM 操作 | ❌ |
| `urlHistoryManager.js` | 包装 `storage.js` 的 play history API | localStorage | 部分 |
| `PlayUrlController.js` | 协调上述子模块，持有当前状态机 | DOM + IPC | ❌ |

### 6.3 通信协议（与主进程）

**完全复用现有实现，不新增任何 IPC 通道：**

| 通道 / 事件 | 方向 | 现状 | 本次改动 |
|---|---|---|---|
| `handle-magnet-link` | renderer→main | 已存在，action: `resolve` / `play` | 不动 |
| `magnet-progress` | main→renderer | 已存在，订阅 `onMagnetProgress` | 不动 |
| `handle-magnet-link-cancel` | renderer→main | 实施前 grep 确认是否存在；不存在则新增 | 视结果而定 |
| localStorage | 渲染进程 | 已有 `play_history` key | 复用现有 storage.js 方法 |

### 6.4 localStorage 数据结构

**完全复用现有 `play_history` 结构，不新增字段：**

```js
// key: "play_history"（与 storage.js 一致）
// 现有结构（保留 vod_id 等所有字段以保证向后兼容）：
{
  vod_id: "magnet:?xt=urn:btih:abc123..."  // 三类来源都用 vod_id：
             | "https://example.com/a.mp4"  // 磁力链、URL、file:// 都用
             | "file:///C:/movies/a.mp4",    // 不同前缀区分类型
  vod_name: "movie name 或文件名",
  vod_pic: "",
  type_name: "外链" | "本地" | "磁力",       // 用 type_name 区分类型
  current_episode: 1,
  episode_name: "正片",
  watch_time: 1700000000,
  site_name: "...",
  site_url: "",
  progress: 0,
  play_duration: 0
}
```

**类型识别从 `vod_id` 前缀和 `type_name` 字段双重判断：**

- `vod_id.startsWith('magnet:')` 或 `vod_id.match(/^[a-fA-F0-9]{40}$/)` → `magnet`
- `vod_id.startsWith('https://')` / `http://` / 含视频后缀 → `url`
- `vod_id.startsWith('file://')` / 含盘符/UNC/POSIX 路径 → `local`

**严格遵循 project memory 规范：**

- 所有 `getPlayHistory` / `addPlayHistory` / `removePlayHistory` / `saveWatchProgress` / `updateHistoryProgress` 调用必须 `try/catch`
- 正常路径**不输出** `[STORAGE]` 日志
- 异常路径用 `console.error` 记录
- `getPlayHistory` 失败时返回空数组
- 写入失败时静默失败
- **调用 `storage.js` 现有方法，不自己读写 localStorage**（保持单一数据源）

---

## 7. 设计 §5 · 错误处理 & 测试

### 7.1 错误处理总表

| 场景 | 用户感知 | 行为 |
|---|---|---|
| 巨输入为空 + 点播放 | 按钮置灰，无反应 | disabled 状态控制 |
| 识别为"未知" | 右侧徽章 `❓ 未知` + 按钮置灰 + tooltip | 引导用户检查 |
| URL 加载失败（404/CORS） | 播放器内显示错误页 + "返回外链"按钮 | 不弹原生 alert |
| 本地文件不存在 | 提示"文件不存在或已被移动" + "重新选择"按钮 | 调用 `fs.access` 校验（通过 IPC） |
| 磁力链解析失败 | 进度区变红 + `解析失败：xxx` + "重试"按钮 | 区分 timeout / tracker 失败 / hash 非法 |
| 磁力链 0 视频文件 | 文件列表区显示"该资源不含可播放视频文件" | 允许展开"显示全部"看到原始清单 |
| 磁力链下载中网络断 | 进度区变橙 + `网络断开，已暂停` | 恢复后自动续传 |
| 磁力链文件选择后无法播放 | 播放器内显示错误 + "选其他文件"按钮 | 返回文件列表步骤 |
| localStorage 写入失败（quota） | 历史抽屉静默缺失新项 | console.error，按规范不打扰用户 |
| 拖拽非视频文件 | 输入区抖动 + 提示"仅支持视频文件" | 不入历史、不报错弹窗 |

**核心原则**：所有错误均**不弹原生** `alert()` / `confirm()`，全部走应用内 UI（遵循"状态在 UI 显示而非 console"的项目规则）。

### 7.2 关键测试用例

**1. `inputRecognizer.detectInputType`（纯函数，独立单测）**

```
"https://x.com/a.m3u8"        → {type:'url',    subtype:'m3u8'}
"https://x.com/a.mp4"         → {type:'url',    subtype:'mp4'}
"magnet:?xt=urn:btih:abc..."  → {type:'magnet', hash:'abc...'}
"abc123..."（40 位 hex）        → {type:'magnet', hash:'abc...'}（自动补前缀）
"ABCDEFGH..."（32 位 base32）  → {type:'magnet', hash:'...'}（自动补前缀）
"file:///C:/movies/a.mp4"     → {type:'local',  path:'C:\\movies\\a.mp4'}
"C:\\movies\\a.mp4"           → {type:'local',  path:'C:\\movies\\a.mp4'}
"\\\\server\\share\\a.mp4"    → {type:'local',  path:'\\\\server\\share\\a.mp4'}
"/home/user/a.mp4"            → {type:'local',  path:'/home/user/a.mp4'}
"hello world"                 → {type:'unknown'}
""                            → {type:'empty'}
```

**2. `PlayUrlController` 状态机**

- IDLE → EDITING → RECOGNIZED → PLAYING_DIRECT
- IDLE → EDITING → RECOGNIZED → PARSE_PROGRESS → FILES_READY → PLAYING_MAGNET
- 任意态 → 取消 → IDLE

**3. `magnetParserAdapter`（mock IPC）**

- 解析成功 → 文件列表渲染正确
- 解析失败 → 进度区变红
- 0 视频文件 → 友好提示
- 下载中取消 → 资源释放

**4. `urlHistoryManager`**

- 写入/读取/删除正常路径
- localStorage 抛错（quota / corrupt）→ console.error + 静默失败

### 7.3 端到端验证

按 `project_rules.md`：`npm run dev` 启动后人工验证：

- [ ] 粘贴 URL → 自动识别 `🌐 URL` → 点播放 → 进入播放器
- [ ] 拖拽本地文件 → 识别 `📁 本地` → 播放
- [ ] 粘贴磁力链 → 解析进度 → 文件列表（推荐项高亮）→ 选文件 → 播放
- [ ] 点「选择本地文件」→ 系统对话框 → 选中回填 → 播放
- [ ] 点「查看历史」→ 抽屉展开 → 点历史项 → 再次进入播放器
- [ ] 错误场景：未知输入 / 解析失败 / 文件不存在 / 拖拽非视频

---

## 8. 命名与代码规范（必须遵守）

按 `project_rules.md` 与 `user_rules`：

- 类名 PascalCase，控制器以 `Controller` 结尾，渲染器以 `Renderer` 结尾
- 方法 PascalCase，动词开头
- 私有字段下划线前缀（`_currentMagnetInfoHash`）
- 常量 UPPER_SNAKE_CASE
- 4 空格缩进，大括号单独占行
- 单文件不超过 500 行
- 函数级中文注释
- 局部变量和参数 camelCase

---

## 9. 实施风险与注意

1. **HTML 结构调整需小心**：旧 `#play-url-page` 内的所有 id（`video-url-input` / `play-url-btn` / `magnet-progress-section` / `magnet-files-list` / `url-history-list` / `clear-url-history-btn` / `select-file-btn` / `selected-file-path`）如果其他地方有引用，需同步更新。**实施前先 grep 全项目**。

2. **CSS 样式冲突**：旧 `.play-url-content` / `.url-input-section` / `.local-file-section` 等 class 在 `style.css` 中定义，本次需清理避免冗余。新样式集中在 `play-url.css`。

3. **现有 IPC 协议不变**：仅复用，不破坏向后兼容。`handle-magnet-link` 的入参和出参结构不修改。

4. **历史数据兼容**：旧 `playHistory` 数据结构可能没有 `type` 字段，读入时需做兼容性处理（默认 `url`）。

5. **拖拽需要禁用浏览器默认行为**：拖拽文件到输入框时必须 `e.preventDefault()`，避免浏览器打开文件。

---

## 10. 验收标准

- ✅ 巨输入框视觉焦点清晰，无其他竞争视觉
- ✅ 4 类输入（URL / file:// / 本地路径 / 磁力链）粘贴后 200ms 内显示识别徽章
- ✅ 立即播放按钮根据识别结果正确启用/置灰
- ✅ 磁力链解析流程正常（复用现有 IPC）
- ✅ 「选择本地文件」按钮弹系统对话框，选中后回填输入框
- ✅ 「查看历史」按钮展开/折叠抽屉，列表项点击再播
- ✅ 所有错误走应用内 UI，不弹原生 alert
- ✅ `npm run dev` 启动后所有功能可用
- ✅ 旧 `playHistory` 数据正常读取和显示
