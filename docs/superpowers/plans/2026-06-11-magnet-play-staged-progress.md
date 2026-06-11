# 磁力链播放阶段化进度反馈 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为磁力链点击播放 → 视频实际播放的整条链路提供 6 个阶段的连续进度反馈,消除"卡住没反应"的误判。

**Architecture:** 在渲染层 PlayUrlController 中,基于现有 `_showProgress` 机制,按时序调用 6 个阶段的进度展示;订阅主进程已存在但被丢弃的 `magnet-download-progress` 事件;新增 2 个 IPC 事件(`player-loaded`、`player-canplay`)打通主进程 ↔ 播放器窗口 ↔ 主窗口的协同。映射逻辑抽出到独立纯函数模块以便测试。

**Tech Stack:** Electron 27 · Node.js (主进程/子进程) · Vanilla ESM (渲染层) · Jest + ts-jest (测试)

---

## 文件结构

| 角色 | 文件 | 改动 |
|------|------|------|
| 新建 - 纯逻辑(可测试) | `src/renderer/js/utils/magnetDownloadProgressMapper.js` | 把 `magnet-download-progress` payload 映射到阶段对象 |
| 修改 - 渲染控制器 | `src/renderer/js/controllers/PlayUrlController.js` | 6 阶段进度切换 + 订阅新事件 |
| 修改 - 适配层 | `src/renderer/js/controllers/magnetParserAdapter.js` | 新增 `onDownloadProgress` 订阅 API |
| 修改 - preload | `src/preload.js` | 暴露 `onPlayerLoaded` / `onPlayerCanplay` 桥 |
| 修改 - 主进程 | `src/main/modules/ipcHandler.js` | playerWindow `did-finish-load` 发 `player-loaded`;转发 `player-canplay` |
| 修改 - 播放器 | `src/renderer/js/player.js` | `canplay` 事件触发 `ipcRenderer.send('player-canplay')` |
| 修改 - 样式 | `src/renderer/css/style.css` | 二级阶段文本 + warning/success 变体 |
| 新建 - 单元测试 | `src/__tests__/magnetDownloadProgressMapper.test.ts` | 纯函数映射测试 |

---

## Task 1: 编写 magnetDownloadProgressMapper 纯函数 + 测试

**Files:**
- Create: `src/renderer/js/utils/magnetDownloadProgressMapper.js`
- Create: `src/__tests__/magnetDownloadProgressMapper.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// src/__tests__/magnetDownloadProgressMapper.test.ts
import { mapMagnetDownloadProgress } from '../renderer/js/utils/magnetDownloadProgressMapper.js';

describe('mapMagnetDownloadProgress', () => {
    test('connecting 状态映射到 P2.1 阶段', () => {
        const result = mapMagnetDownloadProgress({
            status: 'connecting',
            progress: 0,
            numPeers: 0
        });
        expect(result.stageId).toBe('P2.1');
        expect(result.stageText).toContain('连接');
        expect(result.progress).toBe(10);
        expect(result.variant).toBe('info');
    });

    test('downloading 状态映射到 P2.2 阶段,progress 透传', () => {
        const result = mapMagnetDownloadProgress({
            status: 'downloading',
            progress: 45,
            numPeers: 12,
            downloadSpeed: 1024000
        });
        expect(result.stageId).toBe('P2.2');
        expect(result.stageText).toContain('45%');
        expect(result.stageText).toContain('12');
        expect(result.progress).toBe(45);
        expect(result.variant).toBe('info');
    });

    test('no-peers-warning 状态映射到 warning variant', () => {
        const result = mapMagnetDownloadProgress({
            status: 'no-peers-warning',
            progress: 0,
            numPeers: 0
        });
        expect(result.variant).toBe('warning');
        expect(result.stageText).toContain('peer');
    });

    test('slow-warning 状态映射到 warning variant', () => {
        const result = mapMagnetDownloadProgress({
            status: 'slow-warning',
            progress: 5
        });
        expect(result.variant).toBe('warning');
    });

    test('completed 状态映射到 P6 success variant', () => {
        const result = mapMagnetDownloadProgress({
            status: 'completed',
            progress: 100
        });
        expect(result.stageId).toBe('P6');
        expect(result.variant).toBe('success');
    });

    test('未知 status 退回到 info variant 但保留原始状态文本', () => {
        const result = mapMagnetDownloadProgress({
            status: 'some-future-status',
            progress: 50
        });
        expect(result.variant).toBe('info');
        expect(result.progress).toBe(50);
    });

    test('progress 缺省时使用 0,不抛错', () => {
        const result = mapMagnetDownloadProgress({ status: 'connecting' });
        expect(result.progress).toBe(0);
    });

    test('progress 异常值(NaN/负数)被钳制到 0-100', () => {
        expect(mapMagnetDownloadProgress({ status: 'downloading', progress: NaN }).progress).toBe(0);
        expect(mapMagnetDownloadProgress({ status: 'downloading', progress: -10 }).progress).toBe(0);
        expect(mapMagnetDownloadProgress({ status: 'downloading', progress: 150 }).progress).toBe(100);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/__tests__/magnetDownloadProgressMapper.test.ts 2>&1 | tail -20`
Expected: FAIL "Cannot find module"

- [ ] **Step 3: 实现 magnetDownloadProgressMapper.js**

```javascript
// src/renderer/js/utils/magnetDownloadProgressMapper.js
/**
 * 磁力下载进度事件 → 阶段对象映射器
 *
 * 输入: 子进程 magnetHandler.mjs 发送的 progress 消息
 *       (主进程转发为 magnet-download-progress IPC 事件)
 * 输出: { stageId, stageText, progress, variant }
 *       - stageId: 'P1' | 'P2' | 'P2.1' | 'P2.2' | 'P3' | 'P4' | 'P5' | 'P6'
 *       - stageText: 显示给用户的二级阶段文本
 *       - progress: 主进度条百分比(0-100)
 *       - variant: 'info' | 'warning' | 'success' | 'error'
 *
 * 关键: 进度数字必须经 isFinite 钳制,挡掉 NaN / 负数 / 越界值,
 *       防止 style="width: NaN%" 注入或显示异常
 */

/**
 * 钳制数值到 [min, max] 范围,过滤 NaN/Infinity
 * @param {number} value 待处理数值
 * @param {number} min 最小值
 * @param {number} max 最大值
 * @param {number} fallback 兜底值
 * @returns {number} 安全数值
 */
function clampPercent(value, min = 0, max = 100, fallback = 0) {
    if (value == null || !isFinite(value)) return fallback;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/**
 * 把子进程 download progress 消息映射到阶段对象
 * @param {Object} payload magnet-download-progress 事件 payload
 * @param {string} [payload.status] 子进程状态: connecting | downloading | completed | no-peers-warning | slow-warning | ...
 * @param {number} [payload.progress] 下载百分比 0-100
 * @param {number} [payload.numPeers] 当前 peer 数
 * @param {number} [payload.downloadSpeed] 下载速度(bytes/s)
 * @returns {{stageId: string, stageText: string, progress: number, variant: string}}
 */
function mapMagnetDownloadProgress(payload) {
    const status = (payload && payload.status) || 'unknown';
    const rawProgress = payload && payload.progress;
    const numPeers = (payload && payload.numPeers) || 0;

    // 进度优先用子进程给的真实值,缺省时按阶段用兜底
    const progress = clampPercent(rawProgress, 0, 100, 0);

    switch (status) {
        case 'connecting':
            return {
                stageId: 'P2.1',
                stageText: '② 连接 DHT/P2P 网络',
                progress: progress > 0 ? progress : 10,
                variant: 'info'
            };
        case 'downloading': {
            const peerText = numPeers > 0 ? ` (${numPeers} peers)` : '';
            return {
                stageId: 'P2.2',
                stageText: `② 下载中: ${progress}%${peerText}`,
                progress: progress,
                variant: 'info'
            };
        }
        case 'no-peers-warning':
            return {
                stageId: 'P2.1',
                stageText: '⚠ 暂未找到 peer,等待连接中...',
                progress: progress,
                variant: 'warning'
            };
        case 'slow-warning':
            return {
                stageId: 'P2.2',
                stageText: '⚠ 下载速度较慢,请耐心等待',
                progress: progress,
                variant: 'warning'
            };
        case 'completed':
            return {
                stageId: 'P6',
                stageText: '⑥ 播放就绪',
                progress: 100,
                variant: 'success'
            };
        default:
            // 未知状态:透传数据,兜底 info variant
            return {
                stageId: 'P2',
                stageText: `② ${status} (${progress}%)`,
                progress: progress,
                variant: 'info'
            };
    }
}

// 双暴露:Electron renderer 走 window 全局,Jest 走 module.exports
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mapMagnetDownloadProgress, clampPercent };
} else {
    // eslint-disable-next-line no-undef
    window.MagnetDownloadProgressMapper = { mapMagnetDownloadProgress, clampPercent };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/__tests__/magnetDownloadProgressMapper.test.ts 2>&1 | tail -10`
Expected: PASS 8 tests

- [ ] **Step 5: 提交**

```bash
git add src/renderer/js/utils/magnetDownloadProgressMapper.js src/__tests__/magnetDownloadProgressMapper.test.ts
git commit -m "feat: 添加磁力下载进度到阶段的映射纯函数"
```

---

## Task 2: magnetParserAdapter 暴露 onDownloadProgress 订阅 API

**Files:**
- Modify: `src/renderer/js/controllers/magnetParserAdapter.js`

- [ ] **Step 1: 在 magnetParserAdapter.js 末尾添加 onDownloadProgress / removeDownloadProgressListener 方法**

定位文件,在第 100 行附近(原有 `removeProgressListener` 旁边)添加:

```javascript
// 新增:订阅 magnet-download-progress 事件(子进程 progress 消息,主进程已转发)
// 区别于现有 onProgress()(后者订阅 magnet-progress 事件,即子进程 log 消息)
onDownloadProgress(callback) {
    if (!window.electron || !window.electron.ipcRenderer) {
        console.warn('[MagnetParserAdapter] electron API 不可用,无法订阅 download-progress');
        return;
    }
    if (typeof callback !== 'function') return;
    if (this._downloadProgressHandler) {
        // 防止重复订阅
        this.removeDownloadProgressListener();
    }
    this._downloadProgressHandler = (_event, data) => {
        try {
            callback(data);
        } catch (err) {
            console.error('[MagnetParserAdapter] download-progress 回调异常:', err);
        }
    };
    window.electron.ipcRenderer.on('magnet-download-progress', this._downloadProgressHandler);
}

removeDownloadProgressListener() {
    if (!window.electron || !window.electron.ipcRenderer) return;
    if (this._downloadProgressHandler) {
        window.electron.ipcRenderer.removeListener('magnet-download-progress', this._downloadProgressHandler);
        this._downloadProgressHandler = null;
    }
}
```

- [ ] **Step 2: 跑全量测试确认未破坏**

Run: `npx jest 2>&1 | tail -5`
Expected: PASS 5 套件,102 测试(原 101 + 新 8 = 109;但部分可能仍为 109)

- [ ] **Step 3: ESLint 检查**

Run: `npx eslint src/renderer/js/controllers/magnetParserAdapter.js 2>&1 | tail -5`
Expected: 0 errors, 0 warnings

- [ ] **Step 4: 提交**

```bash
git add src/renderer/js/controllers/magnetParserAdapter.js
git commit -m "feat(magnetAdapter): 暴露 onDownloadProgress 订阅 API"
```

---

## Task 3: preload.js 暴露 playerLoaded / playerCanplay 桥

**Files:**
- Modify: `src/preload.js`

- [ ] **Step 1: 在 preload.js 中添加 4 个新方法**

定位 `contextBridge.exposeInMainWorld` 块(通常在文件末尾),添加:

```javascript
onPlayerLoaded: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('player-loaded', (_event, data) => {
        try { callback(data); } catch (err) { console.error('player-loaded 回调异常:', err); }
    });
},
onPlayerCanplay: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('player-canplay', (_event, data) => {
        try { callback(data); } catch (err) { console.error('player-canplay 回调异常:', err); }
    });
},
removePlayerLoadedListener: () => {
    ipcRenderer.removeAllListeners('player-loaded');
},
removePlayerCanplayListener: () => {
    ipcRenderer.removeAllListeners('player-canplay');
},
```

- [ ] **Step 2: 语法检查**

Run: `node --check src/preload.js && echo "OK"`

- [ ] **Step 3: 提交**

```bash
git add src/preload.js
git commit -m "feat(preload): 暴露 playerLoaded/playerCanplay IPC 桥"
```

---

## Task 4: 主进程 ipcHandler 转发 player-loaded / player-canplay

**Files:**
- Modify: `src/main/modules/ipcHandler.js` (在 openPlayer handler 内)

- [ ] **Step 1: 修改 openPlayer IPC handler,在 createPlayerWindow 后订阅 did-finish-load**

定位 `ipcHandler.js:54` 附近的 `qixingApp.createPlayerWindow(safeData);`,替换为:

```javascript
const playerWindow = qixingApp.createPlayerWindow(safeData);
// 关键:窗口 webContents 完成加载后,通知主窗口进入"视频缓冲中"阶段
if (playerWindow && playerWindow.webContents) {
    playerWindow.webContents.once('did-finish-load', () => {
        if (qixingApp.mainWindow && !qixingApp.mainWindow.isDestroyed()) {
            qixingApp.mainWindow.webContents.send('player-loaded', {});
        }
    });
}
return { success: true, message: '播放器已打开' };
```

注意: `createPlayerWindow` 当前可能没返回值,需在 Task 4 子步骤 0 先看 [app.js] / [qixingApp] 实现确认,如有需要补一行 `return playerWindow;` (这超出本任务范围,留到 Task 4.5 处理)

- [ ] **Step 2: 新增 ipcMain.on('player-canplay') 处理器,放在 ipcMain.handle('openPlayer', ...) 之后**

```javascript
// 播放器窗口 video.canplay 时通过 ipcRenderer.send 发来,转发给主窗口
ipcMain.on('player-canplay', (event) => {
    // 安全验证:只接受来自播放器窗口的消息
    const sender = event && event.sender;
    if (sender === qixingApp.mainWindow && qixingApp.mainWindow.webContents) {
        // 是主窗口自己发的(罕见,可能为调试),不转发回去
        return;
    }
    if (qixingApp.mainWindow && !qixingApp.mainWindow.isDestroyed()) {
        qixingApp.mainWindow.webContents.send('player-canplay', {});
    }
});
```

- [ ] **Step 3: 语法检查**

Run: `node --check src/main/modules/ipcHandler.js && echo "OK"`

- [ ] **Step 4: 提交**

```bash
git add src/main/modules/ipcHandler.js
git commit -m "feat(ipc): 转发 player-loaded/player-canplay 事件到主窗口"
```

---

## Task 5: 播放器 player.js 在 canplay 时通知主进程

**Files:**
- Modify: `src/renderer/js/player.js`

- [ ] **Step 1: 在 player.js 的 setupVideoEvents 内,canplay listener 旁添加 IPC 通知**

定位 `src/renderer/js/player.js:1805` 附近:
```javascript
this.video.addEventListener('canplay', () => {
    this.hideLoading();
});
```

修改为:
```javascript
this.video.addEventListener('canplay', () => {
    this.hideLoading();
    // 关键:通知主进程视频已可播放,主进程会转发给主窗口以关闭进度条
    if (window.electron && window.electron.ipcRenderer) {
        try {
            window.electron.ipcRenderer.send('player-canplay', {});
        } catch (err) {
            console.warn('[PLAYER] player-canplay 通知失败:', err);
        }
    }
});
```

注意: **第 1925 行已有另一个 canplay listener**(磁力缓冲相关),无需改;事件多个 listener 都会触发,只在新加的这个里 send IPC 即可。

- [ ] **Step 2: 语法检查**

Run: `node --check src/renderer/js/player.js && echo "OK"`

- [ ] **Step 3: 提交**

```bash
git add src/renderer/js/player.js
git commit -m "feat(player): canplay 事件触发 player-canplay IPC 通知"
```

---

## Task 6: PlayUrlController 接入 6 阶段进度

**Files:**
- Modify: `src/renderer/js/controllers/PlayUrlController.js`

- [ ] **Step 1: 修改 `_playMagnetFile` 函数,加入 6 阶段调用**

定位 `_playMagnetFile` 函数(约 488-580 行),**重写为如下结构**(保留所有原有逻辑,只在合适位置插入 `_showProgress` 和订阅):

```javascript
async _playMagnetFile(magnetUri, file) {
    // 清理之前的订阅(防御性:防止重复订阅导致回调多次触发)
    this._magnetParser.removeDownloadProgressListener();
    if (window.electron && window.electron.removePlayerLoadedListener) {
        window.electron.removePlayerLoadedListener();
        window.electron.removePlayerCanplayListener();
    }

    this._setState(STATE.PLAYING);

    // 阶段 P1: 准备播放资源
    this._showProgress(`① 准备播放: ${file.name}`, 5, 'info');

    try {
        // 阶段 P2: 解析磁力元数据(订阅 download-progress 后,子进程会持续发进度)
        this._showProgress('② 解析磁力元数据...', 10, 'info');
        if (window.electron && window.electron.onPlayerLoaded) {
            window.electron.onPlayerLoaded(() => this._handlePlayerLoaded());
        }
        if (window.electron && window.electron.onPlayerCanplay) {
            window.electron.onPlayerCanplay(() => this._handlePlayerCanplay());
        }
        this._magnetParser.onDownloadProgress((data) => this._handleMagnetDownloadProgress(data));

        const playResult = await this._magnetParser.play(
            magnetUri,
            file.name,
            this._currentInfoHash
        );

        if (!playResult || !playResult.streamUrl) {
            throw new Error('播放准备失败:未获取到流地址');
        }

        // 阶段 P3: 启动流服务器(play 已 resolve,streamUrl 拿到)
        this._showProgress('③ 启动流服务器...', 30, 'info');

        const videoData = {
            url: playResult.streamUrl,
            type: 'magnet',
            title: file.name,
            magnetUri: magnetUri,
            infoHash: this._currentInfoHash,
            fileName: file.name,
            fileSize: file.length || file.size || 0
        };

        // 阶段 P4: 打开播放器(进入后,主进程会发 player-loaded → 阶段 P5;视频 canplay → 阶段 P6)
        // 关键:不立即 _hideProgress,等 player-canplay 事件
        this._showProgress('④ 打开播放器窗口...', 40, 'info');
        await this._openPlayer(videoData);
    } catch (err) {
        this._showProgress(`✗ 播放失败: ${(err && err.message) || err}`, 0, 'error');
        this._magnetParser.removeDownloadProgressListener();
        if (window.electron && window.electron.removePlayerLoadedListener) {
            window.electron.removePlayerLoadedListener();
            window.electron.removePlayerCanplayListener();
        }
        // 让 STATE 从 PLAYING 退出(回 IDLE 或保持),由调用方决定
        throw err;
    }
}
```

- [ ] **Step 2: 添加新方法 `_handleMagnetDownloadProgress`**

在 `_playMagnetFile` 之后添加:

```javascript
/**
 * 处理磁力子进程 download-progress 事件
 * 把子进程 payload 映射到阶段对象并显示
 */
_handleMagnetDownloadProgress(data) {
    if (!data || !window.MagnetDownloadProgressMapper) return;
    const mapped = window.MagnetDownloadProgressMapper.mapMagnetDownloadProgress(data);
    this._showProgress(mapped.stageText, mapped.progress, mapped.variant);
}

/**
 * 处理主进程 player-loaded 事件
 * 进入 P5 视频缓冲中阶段
 */
_handlePlayerLoaded() {
    this._showProgress('⑤ 视频缓冲中...', 50, 'info');
}

/**
 * 处理主进程 player-canplay 事件
 * 关闭进度条,允许 200ms 渐隐动画
 */
_handlePlayerCanplay() {
    // 解绑订阅,避免内存泄露
    this._magnetParser.removeDownloadProgressListener();
    if (window.electron && window.electron.removePlayerLoadedListener) {
        window.electron.removePlayerLoadedListener();
        window.electron.removePlayerCanplayListener();
    }
    this._hideProgress();
}
```

- [ ] **Step 3: 语法检查**

Run: `node --check src/renderer/js/controllers/PlayUrlController.js && echo "OK"`

- [ ] **Step 4: 跑全量测试确认未破坏**

Run: `npx jest 2>&1 | tail -5`
Expected: PASS 5 套件,109 测试

- [ ] **Step 5: 提交**

```bash
git add src/renderer/js/controllers/PlayUrlController.js
git commit -m "feat(playUrl): 6 阶段进度反馈 + 订阅 player-loaded/canplay 事件"
```

---

## Task 7: style.css 添加二级阶段文本 + 变体

**Files:**
- Modify: `src/renderer/css/style.css`

- [ ] **Step 1: 在 style.css 中添加新样式(定位到末尾)**

```css
/* 阶段化进度反馈样式 */
.play-url-progress .progress-stage {
    font-size: var(--text-sm, 12px);
    color: var(--text-secondary, #888);
    margin-bottom: var(--space-1, 4px);
    font-weight: 500;
    line-height: 1.4;
    min-height: 1.4em;
}

.play-url-progress.is-warning .progress-fill {
    background: linear-gradient(90deg, var(--color-warning, #f59e0b) 0%, #d97706 100%);
}

.play-url-progress.is-warning .progress-stage {
    color: var(--color-warning, #f59e0b);
}

.play-url-progress.is-success .progress-fill {
    background: linear-gradient(90deg, var(--color-success, #10b981) 0%, #059669 100%);
}

.play-url-progress.is-success .progress-stage {
    color: var(--color-success, #10b981);
}

.play-url-progress.is-error .progress-fill {
    background: linear-gradient(90deg, var(--color-error, #ef4444) 0%, #dc2626 100%);
}

.play-url-progress.is-error .progress-stage {
    color: var(--color-error, #ef4444);
}

/* 进度条 fill 过渡更平滑,阶段切换时不闪烁 */
.play-url-progress .progress-fill {
    transition: width 200ms ease, background 200ms ease;
}
```

- [ ] **Step 2: 检查 index.html 是否有 progress-stage 容器**

Run: `grep -n "progress-stage\|progress-fill" src/renderer/index.html | head -10`

如果 progress-stage 容器在 HTML 中不存在,需手动添加到进度条上方。典型位置:`<div class="progress-stage"></div>` 插在 `<div class="progress-fill"></div>` 上方。

(具体位置根据 index.html 实际结构调整;本任务不强制要求新建容器,因为 JavaScript 可以动态创建元素;但若有现成容器,优先使用)

- [ ] **Step 3: 提交**

```bash
git add src/renderer/css/style.css
git commit -m "feat(css): 进度条二级阶段文本 + warning/success/error 变体"
```

---

## Task 8: PlayUrlController._showProgress 支持 stage 文本

**Files:**
- Modify: `src/renderer/js/controllers/PlayUrlController.js` (同 Task 6 文件,但独立任务)

- [ ] **Step 1: 修改 `_showProgress` 方法,自动加上二级 stage 文本**

定位 `_showProgress(text, percent, variant)`(约 612 行),修改为:

```javascript
_showProgress(text, percent, variant) {
    if (!this.progressEl) return;
    this.progressEl.classList.remove('is-warning', 'is-success', 'is-error');
    if (variant && variant !== 'info') {
        this.progressEl.classList.add(`is-${variant}`);
    }
    this.progressEl.style.display = 'block';
    if (this.progressFillEl) {
        const safePct = isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
        this.progressFillEl.style.width = safePct + '%';
    }
    if (this.progressStatusEl) {
        this.progressStatusEl.textContent = text || '';
    }
    // 二级阶段文本:写入独立 .progress-stage 元素,如不存在则动态创建
    let stageEl = this.progressEl.querySelector('.progress-stage');
    if (!stageEl) {
        stageEl = document.createElement('div');
        stageEl.className = 'progress-stage';
        // 插到 progressFill 上方
        const fillEl = this.progressEl.querySelector('.progress-fill');
        if (fillEl) {
            this.progressEl.insertBefore(stageEl, fillEl);
        } else {
            this.progressEl.appendChild(stageEl);
        }
    }
    stageEl.textContent = text || '';
}
```

- [ ] **Step 2: 同步 _hideProgress 移除 stage 元素**

定位 `_hideProgress` 方法,修改为:

```javascript
_hideProgress() {
    if (!this.progressEl) return;
    this.progressEl.style.display = 'none';
    this.progressEl.classList.remove('is-warning', 'is-success', 'is-error');
    if (this.progressFillEl) {
        this.progressFillEl.style.width = '0%';
    }
    if (this.progressStatusEl) {
        this.progressStatusEl.textContent = '';
    }
    const stageEl = this.progressEl.querySelector('.progress-stage');
    if (stageEl) stageEl.textContent = '';
}
```

- [ ] **Step 3: 跑全量测试**

Run: `npx jest 2>&1 | tail -5`
Expected: PASS 5 套件,109 测试

- [ ] **Step 4: 提交**

```bash
git add src/renderer/js/controllers/PlayUrlController.js
git commit -m "feat(playUrl): _showProgress 支持二级 stage 文本 + variant 颜色变体"
```

---

## Task 9: 端到端手动验证

**Files:** 无

- [ ] **Step 1: 启动应用**

Run: `npm run dev`
Expected: 主窗口 + 主页加载完成

- [ ] **Step 2: 测试磁力链播放链路**

1. 切到外链页
2. 输入有效磁力链(可用测试磁力链如 `magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10`)
3. 等待解析(已有进度,确认未破坏)
4. 选文件 → 点播放
5. 观察外链页进度条:
   - 5% "① 准备播放: filename"
   - 10% "② 解析磁力元数据..."
   - 10-95% "② 连接 DHT/P2P" / "② 下载中: X% (M peers)"(跟随子进程)
   - 30% "③ 启动流服务器..."
   - 40% "④ 打开播放器窗口..."
   - 50% "⑤ 视频缓冲中..."
   - 隐藏(视频真正开始播放时)

- [ ] **Step 3: 记录结果**

记录所有阶段是否按预期出现,有无跳变 / 卡顿。如有问题,回到对应 Task 修复。

---

## Task 10: 最终回归

**Files:** 无

- [ ] **Step 1: 全量测试**

Run: `npx jest 2>&1 | tail -5`
Expected: PASS 5 套件,109 测试

- [ ] **Step 2: ESLint 全量**

Run: `npx eslint src/renderer/js/controllers/PlayUrlController.js src/renderer/js/controllers/magnetParserAdapter.js src/renderer/js/player.js src/main/modules/ipcHandler.js src/preload.js 2>&1 | tail -10`
Expected: 0 errors, 0 warnings

- [ ] **Step 3: 语法检查所有改动文件**

Run: `for f in src/renderer/js/controllers/PlayUrlController.js src/renderer/js/controllers/magnetParserAdapter.js src/renderer/js/player.js src/renderer/js/utils/magnetDownloadProgressMapper.js src/main/modules/ipcHandler.js src/preload.js; do node --check "$f" && echo "OK: $f"; done`
Expected: 全部 OK

- [ ] **Step 4: 提交(如有遗漏改动)**

```bash
git status  # 检查未提交文件
# 如有,git add + commit
```

---

## Self-Review(完成计划后已自检)

1. **Spec 覆盖检查**:
   - §3 6 阶段定义 → Task 6 (PlayUrlController)
   - §5.1 PlayUrlController 改动 → Task 6
   - §5.2 magnetParserAdapter 改动 → Task 2
   - §5.3 preload 改动 → Task 3
   - §5.4 ipcHandler 改动 → Task 4
   - §5.5 player.js 改动 → Task 5
   - §5.6 style.css 改动 → Task 7
   - §7.1 单元测试 → Task 1 (映射器测试)
   - §7.2 手动 e2e → Task 9
   - §7.3 全量回归 → Task 10
   ✓ 全部覆盖

2. **Placeholder 扫描**: 无 TBD / TODO

3. **类型一致性**:
   - `mapMagnetDownloadProgress` 在 Task 1 定义,在 Task 6 通过 `window.MagnetDownloadProgressMapper.mapMagnetDownloadProgress` 调用 ✓
   - `onDownloadProgress` 在 Task 2 定义,在 Task 6 调用 ✓
   - `onPlayerLoaded` / `onPlayerCanplay` 在 Task 3 定义,在 Task 6 调用 ✓
   - `_handleMagnetDownloadProgress` / `_handlePlayerLoaded` / `_handlePlayerCanplay` 在 Task 6 定义,事件订阅在 Task 6 同处 ✓
   - `player-canplay` IPC 事件名在 Task 3(preload)、Task 4(ipcHandler)、Task 5(player.js send)、Task 6(订阅)全部一致 ✓
