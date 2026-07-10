# 边下边播系统重构设计文档

- **日期**：2026-07-11
- **作者**：止水制造
- **状态**：待审核
- **关联模块**：`src/main/modules/streaming/`（新建）、`src/main/scripts/magnetHandler.mjs`（扩展）、`src/renderer/js/controllers/`（重写/增强）

## 0. 背景与目标

### 0.1 现状问题

现有项目存在以下问题，已不宜在原代码上修补：

- `DownloadManager.js` 同时承担 manifest 管理 + URL 下载 + 磁力登记，职责过重
- HTTP 下载无 Range 续传，异常退出后无法恢复
- 无下载队列、优先级、限速、完整性校验、空间管理
- 边下边播无预加载保证，启动延迟与缓冲中断无控制
- 错误提示笼统，缺乏用户行动指引

### 0.2 重构目标

按用户视角重新设计一套完整的边下边播系统，满足以下量化指标：

| 维度 | 指标 |
|------|------|
| 启动延迟 | 5 秒内开始播放（HTTP/本地）/ 15 秒内（磁力缓存命中） |
| 缓冲中断 | 平均每小时 ≤1 次 |
| 并发能力 | 3 个下载任务 + 1 个播放任务 |
| 内存占用 | ≤200MB |
| CPU 占用 | 峰值 ≤30% |
| 历史保留 | 30 天 TTL |
| 协议支持 | HTTP/HTTPS、磁力（BT）、本地（MP4/MKV/AVI/FLV/MOV/WMV/WebM/TS） |

### 0.3 范围决策

- **改造方式**：重构式重写（不做旧代码归档、不做数据迁移）
- **ABR 策略**：混合策略——HLS 走 hls.js 原生 ABR；MP4/MKV/磁力走"码率探测 + 自适应预加载"
- **UI 范围**：三页增强（外链页 / 下载页 / 历史页），播放器窗口加状态同步条

## 1. 系统架构

### 1.1 分层架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     渲染进程 (Renderer)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ PlayUrl 页面 │  │ Downloads 页面│  │ History 页面 │      │
│  │  (输入识别)  │  │  (任务队列)   │  │  (统一历史)  │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │ window.electron.streaming.* (preload 暴露)         │
└─────────┼─────────────────┼─────────────────┼───────────────┘
          │ IPC (streaming:* 命名空间)            │
┌─────────▼─────────────────▼─────────────────▼───────────────┐
│                       主进程 (Main)                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │            IPC Gateway (streaming:*)                  │   │
│  │  参数校验 → 路由到对应 Controller → 返回 Promise      │   │
│  └─────────────────────┬───────────────────────────────┘   │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐   │
│  │              业务层 (Business Layer)                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │   │
│  │  │ StreamEngine │  │ IntegrityChk │  │ Adaptive  │  │   │
│  │  │ (边下边播编排)│  │ (完整性校验) │  │ Controller│  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │   │
│  └─────────┼─────────────────┼────────────────┼────────┘   │
│            │                 │                │              │
│  ┌─────────▼─────────────────▼────────────────▼────────┐   │
│  │              调度层 (Scheduler Layer)                │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │   │
│  │  │DownloadQueue │  │ResumeManager │  │ Storage   │  │   │
│  │  │ (优先级队列) │  │ (Range 续传) │  │ Manager   │  │   │
│  │  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │   │
│  │         │  ┌──────────────┐                  │        │   │
│  │         └──┤ SpeedLimiter │◄─────────────────┘        │   │
│  │            │ (令牌桶限速) │                           │   │
│  │            └──────┬───────┘                            │   │
│  └───────────────────┼───────────────────────────────────┘   │
│                      │                                        │
│  ┌───────────────────▼───────────────────────────────────┐   │
│  │            传输层 (Transport Layer)                    │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐    │   │
│  │  │HttpTransport │  │MagnetTransport│ │LocalTrans │    │   │
│  │  │ (Range/续传) │  │ (子进程 IPC) │  │ (本地直读)│    │   │
│  │  └──────────────┘  └──────┬───────┘  └───────────┘    │   │
│  └───────────────────────────┼───────────────────────────┘   │
│                              │                                │
│  ┌───────────────────────────▼───────────────────────────┐   │
│  │           持久层 (Persistence Layer)                   │   │
│  │   ManifestStore (manifest.json, 原子写)               │   │
│  │   HistoryStore (play_history, 30 天 TTL)              │   │
│  │   ConfigStore (下载路径/限速/优先级配置)               │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼ (磁力链场景)
              ┌───────────────────────────────┐
              │   magnetHandler.mjs (子进程)   │
              │   webtorrent + HTTP 流服务器   │
              └───────────────────────────────┘
```

### 1.2 数据流（HTTP 边下边播典型路径）

```
渲染端 streaming:start({ url, autoPlay: true })
   │
   ▼
IPC Gateway 校验参数
   │
   ▼
StreamEngine.start()
   ├─ 选择 HttpTransport
   ├─ ResumeManager 加载已下载 ranges（首次为空）
   ├─ DownloadQueue 排入任务（priority=high，因 autoPlay）
   ├─ AdaptiveBitrateController 初始化 prebufferTarget=5s
   └─ 启动首段下载（从 0 开始，~5s 视频量）
         │
         ├─ 响应头到达 → 提取 Content-Length/Accept-Ranges/Content-Type
         ├─ SpeedLimiter 介入限速
         └─ 数据写入 savePath（append 模式）+ 同步推送 stream:prebuffer
   │
   ▼
预缓冲达 5s → StreamEngine 返回 playUrl
   │
   ▼
渲染端打开播放器加载 playUrl
   │
   ▼
播放器 Range 请求 → 本地 HTTP 服务器 /stream/<taskId> 路由
   │
   ▼
StreamEngine 从 savePath 读取已下载部分 + 同时继续下载后续
   │
   ▼
播放开始 → AdaptiveBitrateController 调整 prebufferTarget 至 30s
```

## 2. 核心模块划分

### 2.1 传输层 — `src/main/modules/streaming/transports/`

统一接口 `ITransport`：

```js
class ITransport {
    /**
     * 探测源信息（不发下载）
     * @returns {Promise<{size, acceptRanges, bitrate?, contentType, fileName}>}
     */
    async probe(source) {}

    /**
     * 创建分段读取器
     * @param {object} opts - { start, end, priority, onProgress }
     * @returns {Promise<SegmentReader>}
     */
    createSegmentReader(opts) {}

    /**
     * 创建分段写入器
     * @param {object} opts - { savePath, append }
     * @returns {Promise<SegmentWriter>}
     */
    createSegmentWriter(opts) {}

    /**
     * 取消指定分段
     */
    cancel(segmentId) {}
}
```

- **HttpTransport**：基于 `http/https` + Range 请求；支持重定向、Content-Length、ETag/Last-Modified 校验；`probe` 走 HEAD 但**首段下载时合并探测**（取消独立 probe 调用，见 §7.1）
- **MagnetTransport**：通过 stdio JSON 与 `magnetHandler.mjs` 子进程通信；封装 `resolve/play/pause/resume/cancel/set-priority/set-speed-limit/verify-pieces` 协议
- **LocalTransport**：直接 `fs.createReadStream` + Range；走现有本地 HTTP 服务器（保留 `ipcHandler.js` 的 `startLocalFileServer`）

### 2.2 调度层 — `src/main/modules/streaming/scheduler/`

- **DownloadQueue**：
  - 优先级队列（HIGH/NORMAL/LOW 三档），同优先级 FIFO
  - 最多 3 个并发活动任务（信号量）
  - 播放任务（autoPlay=true）走单独通道，不占下载槽但占用带宽
  - **抢占策略**：高优先级任务到达时，若并发已满，立即暂停最低优先级的低优先级任务（见 §7.13）
- **ResumeManager**：
  - 维护每个任务的 `downloadedRanges`（数组的 Range 集合，自动合并相邻段）
  - HTTP 用 Range 续传；Magnet 用 webtorrent piece hash 校验
  - 异常退出后从 manifest 恢复，启动时把所有 `downloading` 状态归位为 `paused`
- **SpeedLimiter**：
  - 令牌桶算法，100ms 窗口分发令牌
  - 全局桶 + 单任务桶取小值
  - **播放优先**：播放任务启动时，其他下载任务的全局桶限额自动降到 50%（见 §7.2）
- **StorageManager**：
  - 自定义下载路径（设置页选择器）
  - 剩余空间检查（默认 5GB 阈值，低于阈值拒绝新任务）
  - 30 天 TTL 自动清理已完成任务
  - 路径迁移：用户切换路径时，提示"是否迁移现有文件"

### 2.3 业务层 — `src/main/modules/streaming/`

- **StreamEngine**：
  - 编排 `probe→start→prebuffer→play`
  - 输出可播放 HTTP URL：`http://127.0.0.1:PORT/stream/<taskId>`
  - HLS 走 hls.js 原生 ABR；其他源走分段预加载
  - 5s 预缓冲达成就触发 `canplay`，后续维持 30s 前瞻缓冲
- **AdaptiveBitrateController**：
  - 实时监测下载速度 vs 视频码率（从 moov atom 探测或首段下载耗时估算）
  - 速度 ≥ 码率 1.5× → 前瞻缓冲收敛到 30s
  - 速度 ∈ [码率, 码率×1.5) → 前瞻缓冲扩到 60s
  - 速度 < 码率 → 提示"网速不足以支撑边下边播，建议先下载再观看" + 提供"切换为仅下载"按钮
- **IntegrityChecker**：
  - HTTP：Content-Length 校验 + 可选 SHA256（响应头 `X-Checksum-Sha256`）
  - Magnet：webtorrent 自带 piece hash 自动校验 + 手动 `verify-pieces`
  - Local：仅文件存在性 + 大小校验
- **RetryController**（新增，见 §7.3）：
  - 网络中断自动重试，指数退避（5s/10s/20s/40s，最多 4 次）
  - UI 显示"网络中断，重试中 (2/4)"
  - 重试期间任务状态保持 `downloading`，不切换为 `error`
- **MagnetResolveCache**（新增，见 §7.4）：
  - 按 infoHash 缓存解析结果（文件列表 + 总大小），TTL 24h
  - 同链第二次解析秒开

### 2.4 IPC 网关 — `src/main/modules/streaming/ipcGateway.js`

所有 IPC 频道统一定义在 `streaming:` 命名空间下，参数严格校验（沿用 `securityValidator.js`）。

### 2.5 持久层 — `src/main/modules/streaming/persistence/`

- **ManifestStore**：原子写 manifest.json（先 .tmp 再 rename），记录所有下载任务（含活动+历史）
- **HistoryStore**：统一写入 `localStorage['play_history']`（保留现有约定），30 天 TTL 自动清理
- **ConfigStore**：下载路径、限速、并发数、TTL 配置

### 2.6 渲染端 — `src/renderer/js/controllers/`

- **PlayUrlController**（增强）：状态机扩展 `IDLE → EDITING → RECOGNIZED → PARSE_PROGRESS → FILES_READY → PREBUFFERING → PLAYING`，新增 PREBUFFERING 状态显示"预加载中 5s"
- **DownloadController**（重写）：任务队列 UI、优先级下拉、限速滑块（预设值）、剩余空间指示、错误行动按钮
- **HistoryController**（增强）：30 天 TTL 标签、统一三源（URL/Magnet/Local）展示

## 3. 关键技术选型

| 领域 | 选型 | 理由 |
|------|------|------|
| HTTP 客户端 | Node 原生 `http/https` + Range | 项目已用，避免引入 axios 干扰；Range 续传需要原生流控制 |
| 磁力下载 | webtorrent v2.x（独立子进程） | 现有架构合理，保留并扩展协议 |
| HLS 播放 | hls.js ^1.4.12 | 已集成，原生 ABR |
| 限速算法 | 令牌桶（token bucket） | 实现简单、突发友好、支持全局限速+单任务限速叠加 |
| 队列调度 | 优先级队列 + 信号量 | 3 并发槽 + 1 播放槽，纯 JS 实现，无依赖 |
| 完整性校验 | Content-Length + 可选 SHA256 / webtorrent piece hash | HTTP 走头部校验，磁力走 BT 协议内置校验 |
| 持久化 | JSON 文件 + 原子写（.tmp→rename） | 与现有方案一致，避免引入数据库 |
| IPC 校验 | 复用 `securityValidator.js` | 保持安全策略统一 |
| 本地播放 | 复用 `ipcHandler.js` 的本地 HTTP 服务器 | 已支持 Range + CORS，无需重写 |
| 系统通知 | Electron `Notification` API | 任务完成时桌面通知（见 §7.12） |

## 4. API 接口设计

### 4.1 主进程 IPC 频道（`streaming:` 命名空间）

| 频道 | 方向 | 入参 | 出参 | 说明 |
|------|------|------|------|------|
| `streaming:start` | invoke | `{ source, savePath?, priority?, speedLimit?, autoPlay, mode? }` | `{ success, taskId, playUrl? }` | 启动任务；mode=`'stream'`（默认）或 `'download'`（仅下载） |
| `streaming:pause` | invoke | `{ taskId }` | `{ success }` | 暂停任务 |
| `streaming:resume` | invoke | `{ taskId }` | `{ success }` | 续传任务 |
| `streaming:cancel` | invoke | `{ taskId, removeFiles }` | `{ success }` | 取消任务，可选删除文件 |
| `streaming:setPriority` | invoke | `{ taskId, priority }` | `{ success }` | 调整优先级（high/normal/low） |
| `streaming:setSpeedLimit` | invoke | `{ taskId?, bytesPerSec }` | `{ success }` | taskId 为空时设置全局限速 |
| `streaming:listTasks` | invoke | `{ status?, sourceType? }` | `{ success, tasks[] }` | 列出任务 |
| `streaming:getTask` | invoke | `{ taskId }` | `{ success, task }` | 单任务详情 |
| `streaming:verify` | invoke | `{ taskId }` | `{ success, integrity }` | 手动触发完整性校验 |
| `streaming:setStoragePath` | invoke | `{ path, migrate? }` | `{ success, migrated }` | 修改下载根目录，可选迁移现有文件 |
| `streaming:getStorageInfo` | invoke | — | `{ success, total, free, used, downloadPath }` | 查询磁盘空间 |
| `streaming:cleanup` | invoke | `{ beforeDays }` | `{ success, removed }` | 清理 N 天前已完成任务 |
| `streaming:retry` | invoke | `{ taskId }` | `{ success }` | 手动重试失败任务 |

> 注：原 `streaming:probe` 已取消，元数据在首段下载时合并获取（见 §7.1）。

### 4.2 主进程 → 渲染进程事件推送

| 事件 | Payload | 说明 |
|------|---------|------|
| `streaming:progress` | `{ taskId, downloadedBytes, totalBytes, speed, eta, status }` | 200ms 节流 |
| `streaming:state-change` | `{ taskId, from, to, reason? }` | 状态机切换 |
| `streaming:prebuffer` | `{ taskId, bufferedSeconds, target, ready }` | 边下边播预加载进度 |
| `streaming:integrity` | `{ taskId, result, expectedHash?, actualHash? }` | 完整性校验结果 |
| `streaming:error` | `{ taskId, errorType, message, recoverable, actions[] }` | 错误推送，actions 含建议操作（见 §7.9） |
| `streaming:queue-changed` | `{ active, queued, paused }` | 队列结构变化 |
| `streaming:retry` | `{ taskId, attempt, maxAttempts, nextRetryIn }` | 重试进度（见 §7.3） |
| `streaming:completed` | `{ taskId, name, size }` | 任务完成，触发系统通知（见 §7.12） |

### 4.3 渲染端 API（preload.js 暴露到 `window.electron.streaming`）

```js
window.electron.streaming = {
    start(opts)                      → Promise<{ taskId, playUrl? }>
    pause(taskId)                    → Promise<Result>
    resume(taskId)                   → Promise<Result>
    cancel(taskId, removeFiles)      → Promise<Result>
    setPriority(taskId, priority)    → Promise<Result>
    setSpeedLimit(taskId, bps)       → Promise<Result>
    listTasks(filter)                → Promise<Task[]>
    getTask(taskId)                  → Promise<Task>
    verify(taskId)                   → Promise<VerifyResult>
    setStoragePath(path, migrate)    → Promise<Result>
    getStorageInfo()                 → Promise<StorageInfo>
    cleanup(beforeDays)              → Promise<Result>
    retry(taskId)                    → Promise<Result>
    onProgress(cb)                   → unsubscribe fn
    onStateChange(cb)                → unsubscribe fn
    onPrebuffer(cb)                  → unsubscribe fn
    onError(cb)                      → unsubscribe fn
    onQueueChanged(cb)               → unsubscribe fn
    onRetry(cb)                      → unsubscribe fn
    onCompleted(cb)                  → unsubscribe fn
}
```

### 4.4 磁力子进程协议扩展（`magnetHandler.mjs`）

新增消息类型（向后兼容现有 `resolve/play/magnet-status`）：

```js
// 主进程 → 子进程
{ action: 'set-priority', infoHash, priority }
{ action: 'set-speed-limit', infoHash, bytesPerSec }   // 0 = 不限
{ action: 'verify-pieces', infoHash, fileName }

// 子进程 → 主进程
{ type: 'verify-result', infoHash, fileName, missing: [0, 12, 34], total: 1024 }
{ type: 'speed-applied', infoHash, actualBps }
```

限速实现：在 `magnetHandler.mjs` 的 `file.createReadStream` 外层包一层 `Throttle` 流（基于 `stream.Transform`）。

## 5. 数据结构

### 5.1 任务对象（运行时 + 持久化）

```js
{
    id: string,                                    // 12 位稳定 ID
    source: {
        type: 'url' | 'magnet' | 'local',
        value: string,                             // URL / magnet URI / 本地路径
        infoHash?: string                          // 仅磁力
    },
    name: string,                                  // 显示名
    savePath: string,                              // 磁盘绝对路径
    totalBytes: number,
    downloadedBytes: number,
    downloadedRanges: [{ start, end }],            // HTTP 续传关键
    status: 'queued' | 'downloading' | 'paused' | 'completed' | 'error',
    priority: 'high' | 'normal' | 'low',
    speedLimit: number,                            // 0 = 不限
    bitrate?: number,                              // 探测得到，用于 ABR
    prebufferTarget: 30,                           // 动态调整 5–60s
    mode: 'stream' | 'download',                   // 边下边播 / 仅下载
    integrity: {
        algorithm?: 'sha256' | 'piece-hash',
        expected?: string,
        actual?: string,
        verifiedAt?: number
    },
    retry: {                                       // 重试状态
        attempt: 0,
        maxAttempts: 4,
        nextRetryAt?: number
    },
    addedAt: number,
    completedAt?: number,
    error?: {
        type: 'network' | 'disk-full' | 'http-4xx' | 'http-5xx' | 'magnet-no-peers' | 'unknown',
        message: string,
        recoverable: boolean,
        actions: ['retry', 'check-network', 'cleanup-space']  // 用户可执行操作
    }
}
```

### 5.2 错误类型与行动按钮映射

| 错误类型 | 触发场景 | actions |
|----------|----------|---------|
| `network` | 网络断开/超时 | `['retry', 'check-network']` |
| `disk-full` | 磁盘空间不足 | `['cleanup-space', 'set-storage-path']` |
| `http-4xx` | 403/404 等 | `['check-url', 'retry']` |
| `http-5xx` | 服务器错误 | `['retry', 'report']` |
| `magnet-no-peers` | 磁力 0 节点 | `['retry', 'check-magnet']` |
| `unknown` | 未分类 | `['retry', 'report']` |

## 6. 详细实施步骤

### 阶段 1：传输层与调度层骨架（核心基础）

1. 新建 `src/main/modules/streaming/transports/ITransport.js` — 定义统一接口与类型
2. 新建 `HttpTransport.js` — 实现 `probe()` (HEAD 请求)、`createSegmentReader()` (Range GET)、`createSegmentWriter()` (append 写)
3. 新建 `MagnetTransport.js` — 包装现有 magnetHandler.mjs 通信，扩展 set-priority/set-speed-limit/verify-pieces
4. 新建 `LocalTransport.js` — 包装本地文件读取（基于 `fs.createReadStream`）
5. 新建 `scheduler/DownloadQueue.js` — 优先级队列 + 3 并发槽信号量 + 抢占策略
6. 新建 `scheduler/SpeedLimiter.js` — 令牌桶，全局桶 + 每任务桶取小值 + 播放优先降速
7. 新建 `scheduler/ResumeManager.js` — `downloadedRanges` 数组管理 + 持久化
8. 新建 `scheduler/StorageManager.js` — 路径校验 + 剩余空间检查 + TTL 清理 + 路径迁移

### 阶段 2：业务层与边下边播编排

9. 新建 `StreamEngine.js` — 编排 probe→start→prebuffer→play，输出 `http://127.0.0.1:PORT/stream/<taskId>`
10. 扩展 `ipcHandler.js` 的本地 HTTP 服务器：新增 `/stream/<taskId>` 路由，从 StreamEngine 拿分段流，支持 Range
11. 新建 `AdaptiveBitrateController.js` — 监听 progress 事件，动态调整前瞻缓冲目标
12. 新建 `IntegrityChecker.js` — HTTP 用 Content-Length + 可选 SHA256；Magnet 走 verify-pieces
13. 新建 `RetryController.js` — 指数退避重试，推送 `streaming:retry` 事件
14. 新建 `MagnetResolveCache.js` — infoHash→files 缓存，24h TTL
15. 新建 `persistence/ManifestStore.js` — 原子写 manifest，含 downloadedRanges/retry/mode 字段
16. 新建 `persistence/ConfigStore.js` — 下载路径、限速、并发数、TTL 配置

### 阶段 3：IPC 网关与渲染端

17. 新建 `streaming/ipcGateway.js` — 注册所有 `streaming:*` 频道，参数校验
18. 修改 `preload.js` — 暴露 `window.electron.streaming` API
19. 修改 `main.js` — 启动时初始化 StreamEngine + DownloadQueue + StorageManager + RetryController
20. 修改 `magnetHandler.mjs` — 实现限速流包装 + verify-pieces + set-priority
21. 修改 `ipcHandler.js` — `/stream/<taskId>` 路由集成 StreamEngine

### 阶段 4：渲染端 UI 增强

22. 重写 `DownloadController.js`：
    - 任务队列卡片（进度、速度、ETA、剩余空间）
    - 优先级下拉（高/中/低）
    - 限速滑块（不限/10MB/s/5MB/s/1MB/s 预设）
    - 剩余空间顶部进度条（<5GB 变红）
    - 取消任务确认对话框（进度 >50% 触发）
    - 错误行动按钮（重试/检查网络/清理空间）
    - 任务完成系统通知
    - 空状态引导（首次打开）
23. 增强 `PlayUrlController.js`：
    - 新增 PREBUFFERING 状态，5s 预加载进度条
    - 磁力文件列表按大小降序，默认高亮最大视频文件
    - 未完成磁力续播提示"正在重连节点，约 10-30s"
    - 边下边播 / 仅下载模式切换按钮
24. 增强 `HistoryController.js`：
    - 30 天 TTL 标签
    - 统一三源展示
    - 点击继续按 type 分流
25. 修改 `player.js` — 监听 `streaming:prebuffer` 事件，缓冲低于 10s 时显示"缓冲中"提示
26. 修改 `downloads.css` — 任务卡片样式、限速控件、剩余空间指示器
27. 修改 `play-url.css` — PREBUFFERING 状态样式
28. 修改 `index.html` — 新增 DOM 节点（队列面板、限速控件、剩余空间指示、空状态）

### 阶段 5：测试与调优

29. 新增 `__tests__/streaming/HttpTransport.test.ts` — Range 请求/重定向/Content-Length 校验/合并 probe
30. 新增 `__tests__/streaming/DownloadQueue.test.ts` — 优先级调度、并发控制、抢占策略
31. 新增 `__tests__/streaming/SpeedLimiter.test.ts` — 令牌桶正确性、播放优先降速
32. 新增 `__tests__/streaming/ResumeManager.test.ts` — downloadedRanges 合并/恢复
33. 新增 `__tests__/streaming/IntegrityChecker.test.ts` — SHA256/piece hash 校验
34. 新增 `__tests__/streaming/RetryController.test.ts` — 指数退避、最大次数
35. 新增 `__tests__/streaming/MagnetResolveCache.test.ts` — 缓存命中、TTL 过期
36. 性能验证：内存 ≤200MB、CPU ≤30%、5s 启动、3 并发 + 1 播放
37. 端到端验证：HTTP/Magnet/Local 三协议 × 边下边播/仅下载 两场景

### 阶段 6：清理与文档

38. 删除旧 `DownloadManager.js`（用户确认无需归档）
39. 删除旧 `DownloadController.js` 中已废弃的代码路径
40. 更新 `.trae/rules/project_rules.md` — 新增 streaming 模块架构说明
41. 更新 `CHANGELOG.md`

## 7. 用户视角补充设计（13 项缺口落地）

### 7.1 probe 与首段下载合并

- **取消独立 `streaming:probe` 频道**
- `StreamEngine.start()` 直接发起首段 Range GET（`Range: bytes=0-5242879`，约 5MB）
- 从响应头提取 `Content-Length`、`Accept-Ranges`、`Content-Type`、`X-Checksum-Sha256`
- 估算码率：`bitrate = 5MB / (下载耗时秒数) × 8`（粗略，后续按 moov atom 精修）
- 节省 ~200ms 启动时间

### 7.2 播放时其他下载让带宽

- `StreamEngine` 启动播放任务时，调用 `SpeedLimiter.setPlaybackActive(true)`
- `SpeedLimiter` 内部把全局桶容量降到原值的 50%
- 播放任务结束（暂停/完成/取消）时，`setPlaybackActive(false)` 恢复
- UI 在播放期间显示"播放优先模式：其他下载已限速 50%"

### 7.3 网络断开自动重试

- `RetryController` 监听 `streaming:error` 事件中 `errorType === 'network'` 的错误
- 指数退避：5s → 10s → 20s → 40s，最多 4 次
- 重试期间任务状态保持 `downloading`，不切换为 `error`
- 每次重试推送 `streaming:retry` 事件，UI 显示"网络中断，重试中 (2/4)"
- 4 次失败后切换为 `error` 状态，提供"手动重试"按钮

### 7.4 磁力解析结果缓存

- `MagnetResolveCache` 按 infoHash 缓存 `{ files, totalSize, cachedAt }`
- TTL 24h，LRU 淘汰（最多 100 条）
- 同链第二次解析秒开
- 缓存命中时跳过 `resolve` 阶段，直接进入 `FILES_READY` 状态

### 7.5 磁力文件列表默认排序

- `PlayUrlController` 渲染文件列表时按 `length`（大小）降序
- 默认高亮最大的视频文件（自动选中单选框）
- 用户可手动改选其他文件
- 文件名含"正片/全集/Complete"等关键词时优先排序

### 7.6 限速改预设滑块

- 下载页全局限速：滑块四档（不限/10MB/s/5MB/s/1MB/s）
- 单任务限速：同四档 + "自定义"输入框
- 滑块改变即时生效，无需"保存"按钮
- 设置持久化到 `ConfigStore`

### 7.7 取消任务确认

- `DownloadController` 取消按钮点击时检查 `progress > 50%`
- 满足条件弹出确认对话框："已下载 X%，确认取消？取消后已下载部分将删除"
- 不满足直接取消
- 对话框提供"取消任务"和"保留已下载部分"两个选项

### 7.8 剩余空间顶部展示

- 下载页顶部固定显示进度条：`已用 12GB / 剩余 88GB`
- 剩余 <5GB 时进度条变红 + 显示警告"磁盘空间不足，请清理或更换存储路径"
- 剩余 <1GB 时拒绝新任务，下载按钮置灰
- 实时更新（每 30s 或任务状态变化时）

### 7.9 错误提示带行动按钮

- `streaming:error` 事件的 `actions` 字段提供用户可执行操作
- UI 渲染错误卡片时根据 `actions` 显示按钮：
  - `retry` → "重试"按钮，调用 `streaming:retry`
  - `check-network` → "检查网络"按钮，打开系统网络设置
  - `cleanup-space` → "清理空间"按钮，跳转存储管理
  - `set-storage-path` → "更换存储路径"按钮，打开路径选择器
  - `check-url` → "检查链接"按钮，复制 URL 到剪贴板
  - `report` → "反馈问题"按钮，打开 GitHub Issues

### 7.10 未完成磁力续播提示

- `HistoryController` 点击"继续"播放未完成磁力时
- 显示全局浮动提示："正在重连节点，约 10-30s"
- 同时显示进度条（基于 `magnet-progress` 事件）
- 30s 未连接成功则提示"节点连接失败，建议稍后重试"

### 7.11 边下边播 vs 仅下载选项

- 任务卡片提供两个按钮：
  - "边下边播"（默认）→ `mode: 'stream'`，启动预缓冲 + 播放器
  - "仅下载" → `mode: 'download'`，不启动播放器，纯后台下载
- 设置页提供默认模式选择
- 边下边播过程中可切换为"仅下载"（关闭播放器，保留下载）

### 7.12 任务完成系统通知

- 任务状态变为 `completed` 时推送 `streaming:completed` 事件
- 渲染端监听后调用 `Notification` API 显示桌面通知
- 通知内容：`"《庆余年 第1集》下载完成"` + "打开"按钮
- 用户点击通知跳转到下载页
- 设置页可关闭通知（默认开启）
- 仅在主窗口失焦或最小化时显示（避免打扰）

### 7.13 优先级抢占策略

- `DownloadQueue.setPriority(taskId, 'high')` 时：
  - 若并发槽已满（3 个），找出最低优先级的活动任务
  - 若该任务优先级 < high，自动暂停它（状态变为 `paused`，原因 `preempted`）
  - 高优先级任务立即占用空出的槽位
  - 推送 `streaming:queue-changed` 事件，UI 显示"任务 A 已被高优先级任务 B 抢占"
- 被抢占的任务在队列中保留，高优先级任务完成后自动恢复

## 8. 性能与稳定性验证

### 8.1 启动延迟验证

| 场景 | 目标 | 验证方法 |
|------|------|----------|
| HTTP 直链 | ≤5s | 10Mbps 网速下从点击播放到画面出现 |
| HLS | ≤3s | hls.js 原生 ABR |
| 本地文件 | ≤1s | 直接 LocalTransport |
| 磁力缓存命中 | ≤15s | 跳过 resolve，直接 FILES_READY |
| 磁力首次解析 | 15-75s | 取决于 peers 数量 |

### 8.2 缓冲中断验证

- 目标：平均每小时 ≤1 次缓冲中断
- 验证方法：播放 1 小时视频，记录 `waiting` 事件次数
- 关键因素：
  - 预缓冲达 5s 才开始播放
  - AdaptiveBitrateController 维持 30s 前瞻缓冲
  - 网速 <码率时提示用户切换为"仅下载"

### 8.3 资源占用验证

- 内存：`process.memoryUsage().heapUsed` ≤200MB
- CPU：`process.cpuUsage()` 峰值 ≤30%
- 验证场景：3 个下载任务 + 1 个播放任务同时运行 10 分钟

### 8.4 并发能力验证

- 3 个 HTTP 下载任务 + 1 个 HTTP 播放任务
- 1 个磁力下载 + 2 个 HTTP 下载 + 1 个磁力播放
- 验证队列调度正确，无死锁

## 9. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| webtorrent v2.x 兼容性问题 | 中 | 高 | 保留现有 patches/fix-webtorrent-import-attributes.cjs |
| 令牌桶限速精度不足 | 低 | 中 | 100ms 窗口，可调整 |
| 磁力解析 60s 超时 | 高 | 中 | MagnetResolveCache + 用户预期管理 |
| Range 请求被服务器拒绝 | 低 | 中 | 检测 `Accept-Ranges: none`，降级为完整下载 |
| 磁盘 IO 瓶颈 | 低 | 高 | SSD 推荐，HDD 限制并发为 2 |

## 10. 文件清单

### 10.1 新建文件

```
src/main/modules/streaming/
├── ipcGateway.js
├── StreamEngine.js
├── AdaptiveBitrateController.js
├── IntegrityChecker.js
├── RetryController.js
├── MagnetResolveCache.js
├── transports/
│   ├── ITransport.js
│   ├── HttpTransport.js
│   ├── MagnetTransport.js
│   └── LocalTransport.js
├── scheduler/
│   ├── DownloadQueue.js
│   ├── SpeedLimiter.js
│   ├── ResumeManager.js
│   └── StorageManager.js
└── persistence/
    ├── ManifestStore.js
    ├── HistoryStore.js
    └── ConfigStore.js

src/__tests__/streaming/
├── HttpTransport.test.ts
├── DownloadQueue.test.ts
├── SpeedLimiter.test.ts
├── ResumeManager.test.ts
├── IntegrityChecker.test.ts
├── RetryController.test.ts
└── MagnetResolveCache.test.ts
```

### 10.2 修改文件

- `main.js` — 初始化新模块
- `src/preload.js` — 暴露 streaming API
- `src/main/modules/ipcHandler.js` — 集成 `/stream/<taskId>` 路由
- `src/main/scripts/magnetHandler.mjs` — 扩展协议
- `src/renderer/js/controllers/PlayUrlController.js` — 状态机扩展
- `src/renderer/js/controllers/DownloadController.js` — 重写
- `src/renderer/js/controllers/HistoryController.js` — 增强
- `src/renderer/js/player.js` — 监听 prebuffer 事件
- `src/renderer/css/downloads.css` — 新样式
- `src/renderer/css/play-url.css` — PREBUFFERING 样式
- `src/renderer/index.html` — 新 DOM 节点

### 10.3 删除文件

- `src/main/modules/DownloadManager.js`（功能被新模块取代）

## 11. 不在本次范围

- 视频转码（ffmpeg 集成）
- DLNA 投屏增强（保持现有 dlnaManager 不变）
- 弹幕功能（保持现有 danmaku.js 不变）
- 资源站 CMS 接口（保持现有 SearchController 不变）
- 自动更新（保持现有 updateManager 不变）
