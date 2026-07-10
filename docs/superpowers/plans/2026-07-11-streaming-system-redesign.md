# 边下边播系统重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构七星追剧的边下边播系统，实现 5 秒启动、Range 续传、优先级队列、限速、完整性校验、磁力缓存等 13 项用户视角能力。

**Architecture:** 四层架构（传输层 / 调度层 / 业务层 / 持久层）+ IPC 网关 + 渲染端增强。传输层抽象统一 `ITransport` 接口，HTTP/Magnet/Local 三协议走同一调度。业务层 StreamEngine 编排边下边播，输出可播放 HTTP URL。

**Tech Stack:** Electron 27、Node 18 原生 http/https、webtorrent v2.x（子进程）、hls.js 1.4、Jest + ts-jest 测试、CommonJS 模块。

**关联设计文档：** [2026-07-11-streaming-system-redesign-design.md](../specs/2026-07-11-streaming-system-redesign-design.md)

---

## 文件结构

### 新建文件（主进程）

```
src/main/modules/streaming/
├── transports/
│   ├── ITransport.js          # 传输层统一接口
│   ├── HttpTransport.js       # HTTP/HTTPS + Range
│   ├── MagnetTransport.js     # 磁力子进程通信包装
│   └── LocalTransport.js      # 本地文件直读
├── scheduler/
│   ├── SpeedLimiter.js        # 令牌桶限速
│   ├── DownloadQueue.js       # 优先级队列 + 并发控制
│   ├── ResumeManager.js       # downloadedRanges 管理
│   └── StorageManager.js      # 路径/空间/TTL
├── persistence/
│   ├── ManifestStore.js       # manifest.json 原子写
│   └── ConfigStore.js         # 下载配置
├── StreamEngine.js            # 边下边播编排核心
├── AdaptiveBitrateController.js
├── IntegrityChecker.js
├── RetryController.js
├── MagnetResolveCache.js
└── ipcGateway.js              # streaming:* IPC 注册
```

### 新建文件（测试）

```
src/__tests__/streaming/
├── SpeedLimiter.test.ts
├── DownloadQueue.test.ts
├── ResumeManager.test.ts
├── StorageManager.test.ts
├── ManifestStore.test.ts
├── HttpTransport.test.ts
├── IntegrityChecker.test.ts
├── RetryController.test.ts
└── MagnetResolveCache.test.ts
```

### 修改文件

- `main.js` — 初始化新模块
- `src/preload.js` — 暴露 `window.electron.streaming`
- `src/main/modules/ipcHandler.js` — `/stream/<taskId>` 路由
- `src/main/scripts/magnetHandler.mjs` — 协议扩展
- `src/renderer/js/controllers/PlayUrlController.js` — PREBUFFERING 状态
- `src/renderer/js/controllers/DownloadController.js` — 重写
- `src/renderer/js/controllers/HistoryController.js` — 增强
- `src/renderer/js/player.js` — 监听 prebuffer
- `src/renderer/css/downloads.css` / `play-url.css` — 样式
- `src/renderer/index.html` — 新 DOM 节点

### 删除文件

- `src/main/modules/DownloadManager.js`（最后阶段删除）

---

## 阶段 1：调度层基础（无外部依赖，可独立测试）

### Task 1: SpeedLimiter 令牌桶限速器

**Files:**
- Create: `src/main/modules/streaming/scheduler/SpeedLimiter.js`
- Test: `src/__tests__/streaming/SpeedLimiter.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/__tests__/streaming/SpeedLimiter.test.ts`：

```typescript
// @ts-nocheck
const SpeedLimiter = require('../../main/modules/streaming/scheduler/SpeedLimiter');

describe('SpeedLimiter', () => {
    it('无限制时立即允许消费', () => {
        const limiter = new SpeedLimiter({ globalBps: 0 });
        expect(limiter.tryConsume(1024)).toBe(true);
    });

    it('全局限速时超额消费被拒', () => {
        const limiter = new SpeedLimiter({ globalBps: 1024 });
        expect(limiter.tryConsume(1024)).toBe(true);
        expect(limiter.tryConsume(1)).toBe(false);
    });

    it('100ms 后桶恢复', (done) => {
        const limiter = new SpeedLimiter({ globalBps: 10240 });
        expect(limiter.tryConsume(10240)).toBe(true);
        expect(limiter.tryConsume(1)).toBe(false);
        setTimeout(() => {
            expect(limiter.tryConsume(1024)).toBe(true);
            done();
        }, 120);
    });

    it('播放优先模式：全局桶降到 50%', () => {
        const limiter = new SpeedLimiter({ globalBps: 10000 });
        expect(limiter.tryConsume(10000)).toBe(true);
        limiter.setPlaybackActive(true);
        limiter._refill();
        expect(limiter.tryConsume(5000)).toBe(true);
        expect(limiter.tryConsume(1)).toBe(false);
    });

    it('单任务限速取小值', () => {
        const limiter = new SpeedLimiter({ globalBps: 100000 });
        limiter.setTaskLimit('task-1', 5000);
        expect(limiter.tryConsume('task-1', 5000)).toBe(true);
        expect(limiter.tryConsume('task-1', 1)).toBe(false);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx jest src/__tests__/streaming/SpeedLimiter.test.ts
```

预期：FAIL（模块不存在）

- [ ] **Step 3: 实现 SpeedLimiter**

创建 `src/main/modules/streaming/scheduler/SpeedLimiter.js`：

```javascript
// 令牌桶限速器
class SpeedLimiter {
    constructor(opts) {
        this.globalBps = (opts && opts.globalBps) || 0;
        this.windowMs = (opts && opts.windowMs) || 100;
        this.taskLimits = new Map();
        this.taskBuckets = new Map();
        this.globalBucket = this.globalBps;
        this.playbackActive = false;
        this._lastRefill = Date.now();
        this._timer = setInterval(() => this._refill(), this.windowMs);
        if (this._timer.unref) this._timer.unref();
    }

    setTaskLimit(taskId, bps) {
        this.taskLimits.set(taskId, bps);
        if (!this.taskBuckets.has(taskId)) this.taskBuckets.set(taskId, bps);
    }

    clearTaskLimit(taskId) {
        this.taskLimits.delete(taskId);
        this.taskBuckets.delete(taskId);
    }

    setPlaybackActive(active) {
        this.playbackActive = !!active;
    }

    tryConsume(taskIdOrBytes, bytes) {
        if (typeof taskIdOrBytes === 'number' && bytes === undefined) {
            return this._tryConsumeGlobal(taskIdOrBytes);
        }
        return this._tryConsumeWithTask(taskIdOrBytes, bytes);
    }

    _tryConsumeGlobal(bytes) {
        if (this.globalBps === 0) return true;
        this._refill();
        if (this.globalBucket >= bytes) {
            this.globalBucket -= bytes;
            return true;
        }
        return false;
    }

    _tryConsumeWithTask(taskId, bytes) {
        const taskLimit = this.taskLimits.get(taskId);
        if (taskLimit !== undefined && taskLimit > 0) {
            this._refill();
            const taskBucket = this.taskBuckets.get(taskId) || 0;
            if (taskBucket < bytes) return false;
            this.taskBuckets.set(taskId, taskBucket - bytes);
        }
        if (this.globalBps > 0) return this._tryConsumeGlobal(bytes);
        return true;
    }

    _refill() {
        const now = Date.now();
        const elapsed = now - this._lastRefill;
        if (elapsed <= 0) return;
        this._lastRefill = now;
        if (this.globalBps > 0) {
            const effectiveBps = this.playbackActive
                ? Math.floor(this.globalBps * 0.5) : this.globalBps;
            const refill = Math.floor((elapsed / 1000) * effectiveBps);
            this.globalBucket = Math.min(effectiveBps, this.globalBucket + refill);
        }
        for (const [taskId, bps] of this.taskLimits.entries()) {
            if (bps <= 0) continue;
            const refill = Math.floor((elapsed / 1000) * bps);
            const current = this.taskBuckets.get(taskId) || 0;
            this.taskBuckets.set(taskId, Math.min(bps, current + refill));
        }
    }

    destroy() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }
}

module.exports = SpeedLimiter;
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx jest src/__tests__/streaming/SpeedLimiter.test.ts
```

预期：PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/streaming/scheduler/SpeedLimiter.js src/__tests__/streaming/SpeedLimiter.test.ts
git commit -m "feat: 添加 SpeedLimiter 令牌桶限速器"
```

---

### Task 2: ResumeManager downloadedRanges 管理

**Files:**
- Create: `src/main/modules/streaming/scheduler/ResumeManager.js`
- Test: `src/__tests__/streaming/ResumeManager.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/__tests__/streaming/ResumeManager.test.ts`：

```typescript
// @ts-nocheck
const ResumeManager = require('../../main/modules/streaming/scheduler/ResumeManager');

describe('ResumeManager', () => {
    it('空状态返回起始位置 0', () => {
        const rm = new ResumeManager();
        expect(rm.getNextStart('task-1', 1000)).toBe(0);
    });

    it('添加单个 range 后返回结束位置', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        expect(rm.getNextStart('task-1', 1000)).toBe(500);
    });

    it('相邻 range 自动合并', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        rm.addRange('task-1', 500, 1000);
        expect(rm.getRanges('task-1')).toEqual([{ start: 0, end: 1000 }]);
    });

    it('重叠 range 自动合并', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        rm.addRange('task-1', 300, 800);
        expect(rm.getRanges('task-1')).toEqual([{ start: 0, end: 800 }]);
    });

    it('已下载字节累加正确', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        rm.addRange('task-1', 600, 1000);
        expect(rm.getDownloadedBytes('task-1')).toBe(900);
    });

    it('任务间隔离', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        rm.addRange('task-2', 0, 300);
        expect(rm.getDownloadedBytes('task-1')).toBe(500);
        expect(rm.getDownloadedBytes('task-2')).toBe(300);
    });

    it('序列化与反序列化', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        const serialized = rm.serialize('task-1');
        const rm2 = new ResumeManager();
        rm2.deserialize('task-1', serialized);
        expect(rm2.getRanges('task-1')).toEqual([{ start: 0, end: 500 }]);
    });

    it('判断是否已完整下载', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 1000);
        expect(rm.isComplete('task-1', 1000)).toBe(true);
        expect(rm.isComplete('task-1', 1001)).toBe(false);
    });

    it('清除任务数据', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        rm.clear('task-1');
        expect(rm.getRanges('task-1')).toEqual([]);
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx jest src/__tests__/streaming/ResumeManager.test.ts
```

- [ ] **Step 3: 实现 ResumeManager**

创建 `src/main/modules/streaming/scheduler/ResumeManager.js`：

```javascript
// 断点续传管理器
class ResumeManager {
    constructor() {
        this.taskRanges = new Map();
    }

    addRange(taskId, start, end) {
        if (!this.taskRanges.has(taskId)) this.taskRanges.set(taskId, []);
        this.taskRanges.get(taskId).push({ start, end });
        this._merge(taskId);
    }

    _merge(taskId) {
        const ranges = this.taskRanges.get(taskId);
        if (ranges.length <= 1) return;
        ranges.sort((a, b) => a.start - b.start);
        const merged = [ranges[0]];
        for (let i = 1; i < ranges.length; i++) {
            const last = merged[merged.length - 1];
            const cur = ranges[i];
            if (last.end >= cur.start) {
                last.end = Math.max(last.end, cur.end);
            } else {
                merged.push(cur);
            }
        }
        this.taskRanges.set(taskId, merged);
    }

    getNextStart(taskId, totalBytes) {
        const ranges = this.taskRanges.get(taskId) || [];
        if (ranges.length === 0) return 0;
        return Math.min(ranges[ranges.length - 1].end, totalBytes);
    }

    getRanges(taskId) {
        return (this.taskRanges.get(taskId) || []).map(r => ({ start: r.start, end: r.end }));
    }

    getDownloadedBytes(taskId) {
        return (this.taskRanges.get(taskId) || []).reduce((sum, r) => sum + (r.end - r.start), 0);
    }

    isComplete(taskId, totalBytes) {
        const ranges = this.taskRanges.get(taskId) || [];
        if (ranges.length === 0) return false;
        return ranges[0].start === 0 && ranges[0].end >= totalBytes;
    }

    serialize(taskId) { return this.getRanges(taskId); }

    deserialize(taskId, ranges) {
        if (!Array.isArray(ranges)) return;
        this.taskRanges.set(taskId, ranges.map(r => ({ start: r.start, end: r.end })));
        this._merge(taskId);
    }

    clear(taskId) { this.taskRanges.delete(taskId); }
}

module.exports = ResumeManager;
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx jest src/__tests__/streaming/ResumeManager.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/streaming/scheduler/ResumeManager.js src/__tests__/streaming/ResumeManager.test.ts
git commit -m "feat: 添加 ResumeManager 断点续传管理器"
```

---

### Task 3: DownloadQueue 优先级队列

**Files:**
- Create: `src/main/modules/streaming/scheduler/DownloadQueue.js`
- Test: `src/__tests__/streaming/DownloadQueue.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/__tests__/streaming/DownloadQueue.test.ts`：

```typescript
// @ts-nocheck
const DownloadQueue = require('../../main/modules/streaming/scheduler/DownloadQueue');

describe('DownloadQueue', () => {
    it('低于并发限制时立即激活', () => {
        const q = new DownloadQueue({ maxConcurrent: 3 });
        q.enqueue({ id: 't1', priority: 'normal' });
        expect(q.getActiveTasks()).toHaveLength(1);
    });

    it('超过并发限制时排队等待', () => {
        const q = new DownloadQueue({ maxConcurrent: 2 });
        q.enqueue({ id: 't1', priority: 'normal' });
        q.enqueue({ id: 't2', priority: 'normal' });
        q.enqueue({ id: 't3', priority: 'normal' });
        expect(q.getActiveTasks()).toHaveLength(2);
        expect(q.getQueuedTasks()).toHaveLength(1);
    });

    it('高优先级任务插队到队首', () => {
        const q = new DownloadQueue({ maxConcurrent: 1 });
        q.enqueue({ id: 't1', priority: 'normal' });
        q.enqueue({ id: 't2', priority: 'normal' });
        q.enqueue({ id: 't3', priority: 'high' });
        expect(q.getQueuedTasks()[0].id).toBe('t3');
    });

    it('高优先级抢占低优先级活动任务', () => {
        const q = new DownloadQueue({ maxConcurrent: 1 });
        q.enqueue({ id: 't1', priority: 'low' });
        const result = q.enqueue({ id: 't2', priority: 'high' });
        expect(result.preempted).toBe('t1');
        expect(q.getActiveTasks()[0].id).toBe('t2');
        expect(q.getTask('t1').status).toBe('paused');
    });

    it('完成任务后自动激活下一个', () => {
        const q = new DownloadQueue({ maxConcurrent: 1 });
        q.enqueue({ id: 't1', priority: 'normal' });
        q.enqueue({ id: 't2', priority: 'normal' });
        q.complete('t1');
        expect(q.getActiveTasks()[0].id).toBe('t2');
    });

    it('暂停活动任务释放槽位', () => {
        const q = new DownloadQueue({ maxConcurrent: 1 });
        q.enqueue({ id: 't1', priority: 'normal' });
        q.enqueue({ id: 't2', priority: 'normal' });
        q.pause('t1');
        expect(q.getActiveTasks()[0].id).toBe('t2');
    });

    it('取消任务从队列移除', () => {
        const q = new DownloadQueue({ maxConcurrent: 1 });
        q.enqueue({ id: 't1', priority: 'normal' });
        q.enqueue({ id: 't2', priority: 'normal' });
        q.cancel('t2');
        expect(q.getTask('t2')).toBeUndefined();
    });

    it('调整优先级触发重新排序', () => {
        const q = new DownloadQueue({ maxConcurrent: 1 });
        q.enqueue({ id: 't1', priority: 'normal' });
        q.enqueue({ id: 't2', priority: 'normal' });
        q.enqueue({ id: 't3', priority: 'normal' });
        q.setPriority('t3', 'high');
        expect(q.getQueuedTasks()[0].id).toBe('t3');
    });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx jest src/__tests__/streaming/DownloadQueue.test.ts
```

- [ ] **Step 3: 实现 DownloadQueue**

创建 `src/main/modules/streaming/scheduler/DownloadQueue.js`：

```javascript
// 下载优先级队列
class DownloadQueue {
    constructor(opts) {
        this.maxConcurrent = (opts && opts.maxConcurrent) || 3;
        this.tasks = new Map();
        this.activeOrder = [];
    }

    enqueue(task) {
        const t = Object.assign({ status: 'queued', priority: 'normal' }, task);
        this.tasks.set(t.id, t);
        const result = { ...t };
        if (this.activeOrder.length < this.maxConcurrent) {
            t.status = 'downloading';
            this.activeOrder.push(t.id);
        } else {
            const preemptedId = this._tryPreempt(t.priority);
            if (preemptedId) result.preempted = preemptedId;
        }
        return result;
    }

    _tryPreempt(newPriority) {
        const pw = { high: 3, normal: 2, low: 1 };
        const newW = pw[newPriority] || 2;
        let lowestId = null, lowestW = Infinity;
        for (const id of this.activeOrder) {
            const t = this.tasks.get(id);
            if (!t) continue;
            const w = pw[t.priority] || 2;
            if (w < newW && w < lowestW) { lowestW = w; lowestId = id; }
        }
        if (lowestId) {
            this._pauseInternal(lowestId, 'preempted');
            const newId = this._findNewestQueued();
            if (newId) {
                const nt = this.tasks.get(newId);
                nt.status = 'downloading';
                this.activeOrder.push(newId);
            }
        }
        return lowestId;
    }

    _findNewestQueued() {
        for (const [id, t] of this.tasks) { if (t.status === 'queued') return id; }
        return null;
    }

    _pauseInternal(taskId, reason) {
        const t = this.tasks.get(taskId);
        if (!t) return;
        t.status = 'paused'; t.pauseReason = reason;
        const idx = this.activeOrder.indexOf(taskId);
        if (idx >= 0) this.activeOrder.splice(idx, 1);
    }

    pause(taskId) { this._pauseInternal(taskId, 'user'); this._scheduleNext(); }

    resume(taskId) {
        const t = this.tasks.get(taskId);
        if (!t || t.status !== 'paused') return;
        t.status = 'queued'; delete t.pauseReason;
        this._scheduleNext();
    }

    complete(taskId) {
        const t = this.tasks.get(taskId);
        if (!t) return;
        t.status = 'completed'; t.completedAt = Date.now();
        const idx = this.activeOrder.indexOf(taskId);
        if (idx >= 0) this.activeOrder.splice(idx, 1);
        this._scheduleNext();
    }

    cancel(taskId) {
        const idx = this.activeOrder.indexOf(taskId);
        if (idx >= 0) this.activeOrder.splice(idx, 1);
        this.tasks.delete(taskId);
        this._scheduleNext();
    }

    markError(taskId, error) {
        const t = this.tasks.get(taskId);
        if (!t) return;
        t.status = 'error'; t.error = error;
        const idx = this.activeOrder.indexOf(taskId);
        if (idx >= 0) this.activeOrder.splice(idx, 1);
        this._scheduleNext();
    }

    setPriority(taskId, priority) {
        const t = this.tasks.get(taskId);
        if (!t) return;
        t.priority = priority;
        if (t.status === 'queued' && priority === 'high') {
            if (this.activeOrder.length >= this.maxConcurrent) this._tryPreempt('high');
        }
    }

    _scheduleNext() {
        while (this.activeOrder.length < this.maxConcurrent) {
            const nextId = this._pickNextQueued();
            if (!nextId) break;
            this.tasks.get(nextId).status = 'downloading';
            this.activeOrder.push(nextId);
        }
    }

    _pickNextQueued() {
        const pw = { high: 3, normal: 2, low: 1 };
        const queued = Array.from(this.tasks.values()).filter(t => t.status === 'queued');
        if (queued.length === 0) return null;
        queued.sort((a, b) => {
            const d = (pw[b.priority] || 2) - (pw[a.priority] || 2);
            return d !== 0 ? d : (a.addedAt || 0) - (b.addedAt || 0);
        });
        return queued[0].id;
    }

    getActiveTasks() {
        return this.activeOrder.map(id => this.tasks.get(id)).filter(Boolean).map(t => ({ ...t }));
    }

    getQueuedTasks() {
        const pw = { high: 3, normal: 2, low: 1 };
        return Array.from(this.tasks.values())
            .filter(t => t.status === 'queued')
            .sort((a, b) => {
                const d = (pw[b.priority] || 2) - (pw[a.priority] || 2);
                return d !== 0 ? d : (a.addedAt || 0) - (b.addedAt || 0);
            }).map(t => ({ ...t }));
    }

    getTask(taskId) { const t = this.tasks.get(taskId); return t ? { ...t } : undefined; }
    listAll() { return Array.from(this.tasks.values()).map(t => ({ ...t })); }
}

module.exports = DownloadQueue;
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx jest src/__tests__/streaming/DownloadQueue.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add src/main/modules/streaming/scheduler/DownloadQueue.js src/__tests__/streaming/DownloadQueue.test.ts
git commit -m "feat: 添加 DownloadQueue 优先级队列"
```

---

### Task 4: StorageManager 存储与空间管理

**Files:**
- Create: `src/main/modules/streaming/scheduler/StorageManager.js`
- Test: `src/__tests__/streaming/StorageManager.test.ts`

- [ ] **Step 1: 写失败测试** — 参考 Task 3 测试模式，测试 `getStorageInfo`/`checkSpaceAvailable`/`generateSavePath`/`cleanupOldTasks`

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 StorageManager** — 包含：`getStorageInfo`（fs.statfs）、`checkSpaceAvailable`、`generateSavePath`（同名冲突 `(1)` 后缀）、`cleanupOldTasks`（TTL 清理）、`setDownloadPath`（路径迁移）

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交** — `feat: 添加 StorageManager 存储管理器`

---

### Task 5: ManifestStore 原子写清单

**Files:**
- Create: `src/main/modules/streaming/persistence/ManifestStore.js`
- Test: `src/__tests__/streaming/ManifestStore.test.ts`

- [ ] **Step 1: 写失败测试** — 测试 `add`/`update`/`remove`/`findByStatus`/原子写容错

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 ManifestStore** — 原子写（.tmp→rename）、`getAll`/`get`/`add`/`update`/`remove`/`findByStatus`

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交** — `feat: 添加 ManifestStore 原子写清单`

---

### Task 6: MagnetResolveCache 磁力解析缓存

**Files:**
- Create: `src/main/modules/streaming/MagnetResolveCache.js`
- Test: `src/__tests__/streaming/MagnetResolveCache.test.ts`

- [ ] **Step 1: 写失败测试** — 测试命中/未命中/TTL 过期/LRU 淘汰/访问刷新顺序

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 MagnetResolveCache** — Map 保持插入顺序实现 LRU，TTL 检查，maxEntries 淘汰

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交** — `feat: 添加 MagnetResolveCache 磁力解析缓存`

---

### Task 7: RetryController 指数退避重试

**Files:**
- Create: `src/main/modules/streaming/RetryController.js`
- Test: `src/__tests__/streaming/RetryController.test.ts`

- [ ] **Step 1: 写失败测试** — 测试首次重试/指数退避/exhausted/不可恢复/fatal/clear

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 RetryController** — EventEmitter、reportError、指数退避 5s/10s/20s/40s、markSuccess、clear、destroy

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交** — `feat: 添加 RetryController 指数退避重试`

---

## 阶段 2：传输层

### Task 8: ITransport 接口定义

**Files:**
- Create: `src/main/modules/streaming/transports/ITransport.js`

- [ ] **Step 1: 创建接口文件** — 定义 `probe`/`createSegmentReader`/`createSegmentWriter`/`cancel` 方法签名与文档

- [ ] **Step 2: 提交** — `feat: 添加 ITransport 传输层统一接口`

---

### Task 9: HttpTransport HTTP/HTTPS + Range

**Files:**
- Create: `src/main/modules/streaming/transports/HttpTransport.js`
- Test: `src/__tests__/streaming/HttpTransport.test.ts`

- [ ] **Step 1: 写失败测试** — 启动本地 HTTP 服务器，测试 `probe`/`createSegmentReader`（Range 读取）/`createSegmentWriter`/`cancel`

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 HttpTransport** — HEAD 探测、Range GET、重定向、fs.createWriteStream、cancel（req.destroy）

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交** — `feat: 添加 HttpTransport`

---

### Task 10: IntegrityChecker 完整性校验

**Files:**
- Create: `src/main/modules/streaming/IntegrityChecker.js`
- Test: `src/__tests__/streaming/IntegrityChecker.test.ts`

- [ ] **Step 1: 写失败测试** — 测试 verifyFileSize/verifySha256/verifyLocal

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 IntegrityChecker** — fs.statSync 大小校验、crypto.createHash('sha256') 哈希校验、存在性校验

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交** — `feat: 添加 IntegrityChecker`

---

## 阶段 3：业务编排

### Task 11: StreamEngine 边下边播编排核心

**Files:**
- Create: `src/main/modules/streaming/StreamEngine.js`

- [ ] **Step 1: 实现 StreamEngine** — 编排 probe→start→prebuffer→play，集成 DownloadQueue/SpeedLimiter/ResumeManager/ManifestStore/IntegrityChecker/RetryController，暴露 `start`/`pause`/`resume`/`cancel`/`createReadStream` 方法，emit progress/prebuffer/completed/integrity 事件

- [ ] **Step 2: 提交** — `feat: 添加 StreamEngine 边下边播编排核心`

---

### Task 12: AdaptiveBitrateController 自适应码率

**Files:**
- Create: `src/main/modules/streaming/AdaptiveBitrateController.js`

- [ ] **Step 1: 实现 AdaptiveBitrateController** — 监听 StreamEngine progress 事件，动态调整 prebufferTarget（30s/60s），速度<码率时 emit bitrate-warning

- [ ] **Step 2: 提交** — `feat: 添加 AdaptiveBitrateController`

---

### Task 13: ipcGateway IPC 网关

**Files:**
- Create: `src/main/modules/streaming/ipcGateway.js`
- Modify: `src/main/modules/ipcHandler.js`

- [ ] **Step 1: 实现 ipcGateway** — 注册所有 `streaming:*` IPC 频道，转发 StreamEngine 事件到渲染进程

- [ ] **Step 2: 在 ipcHandler.js 添加 `/stream/<taskId>` 路由** — 从 StreamEngine.createReadStream 拿分段流，支持 Range + CORS

- [ ] **Step 3: 提交** — `feat: 添加 streaming IPC 网关与 /stream/<taskId> 路由`

---

## 阶段 4：主进程装配

### Task 14: main.js 装配新模块

**Files:**
- Modify: `main.js`

- [ ] **Step 1: 在 main.js 中初始化 SpeedLimiter/DownloadQueue/StorageManager/ManifestStore/IntegrityChecker/RetryController/AdaptiveBitrateController/StreamEngine**

- [ ] **Step 2: 调用 setupStreamingIPC 注册 IPC 频道**

- [ ] **Step 3: 设置 `global.__streamEngine` 供 ipcHandler 路由使用**

- [ ] **Step 4: 验证 `npm run dev` 启动无报错**

- [ ] **Step 5: 提交** — `feat: 主进程装配 streaming 模块`

---

### Task 15: preload.js 暴露 streaming API

**Files:**
- Modify: `src/preload.js`

- [ ] **Step 1: 在 preload.js 末尾添加 `window.electron.streaming` 对象** — 包含所有 invoke 方法与 on* 事件监听器（返回 unsubscribe 函数）

- [ ] **Step 2: 验证渲染端可访问 `window.electron.streaming.getStorageInfo()`**

- [ ] **Step 3: 提交** — `feat: preload 暴露 window.electron.streaming API`

---

## 阶段 5：渲染端 UI 增强

### Task 16: DownloadController 重写

**Files:**
- Modify: `src/renderer/js/controllers/DownloadController.js`
- Modify: `src/renderer/css/downloads.css`
- Modify: `src/renderer/index.html`

- [ ] **Step 1: index.html 添加剩余空间指示器 + 全局限速滑块 DOM**

- [ ] **Step 2: DownloadController 添加 `_bindIpcListeners`/`_refreshStorageInfo`/`_bindGlobalSpeedControl`/`_cancelWithConfirm`/`_showCompletionNotification`/`_showErrorCard`/`_handleErrorAction` 方法**

- [ ] **Step 3: downloads.css 添加 `.storage-indicator`/`.global-speed-control`/`.task-error-actions` 样式**

- [ ] **Step 4: 验证 UI 显示正确**

- [ ] **Step 5: 提交** — `feat: 重写 DownloadController UI`

---

### Task 17: PlayUrlController PREBUFFERING 状态

**Files:**
- Modify: `src/renderer/js/controllers/PlayUrlController.js`
- Modify: `src/renderer/css/play-url.css`

- [ ] **Step 1: STATE 常量新增 PREBUFFERING**

- [ ] **Step 2: 添加 `_startStreamAndPlay` 方法** — 切换 PREBUFFERING 状态，调用 `streaming:start`，监听 onPrebuffer 进度，ready 后打开播放器

- [ ] **Step 3: 磁力文件列表按大小降序 + 默认高亮最大视频文件**

- [ ] **Step 4: play-url.css 添加 `.is-prebuffering` 动画样式**

- [ ] **Step 5: 验证状态切换流程**

- [ ] **Step 6: 提交** — `feat: PlayUrlController PREBUFFERING 状态`

---

### Task 18: player.js 监听 prebuffer 事件

**Files:**
- Modify: `src/renderer/js/player.js`

- [ ] **Step 1: 添加 `setupStreamingBufferMonitor`** — 监听 video waiting/playing 事件 + streaming.onPrebuffer，缓冲<10s 显示"缓冲中..."

- [ ] **Step 2: 添加 `.player-buffer-warn` 样式**

- [ ] **Step 3: 验证播放器缓冲提示**

- [ ] **Step 4: 提交** — `feat: 播放器 prebuffer 监听`

---

## 阶段 6：磁力子进程扩展

### Task 19: MagnetTransport 包装

**Files:**
- Create: `src/main/modules/streaming/transports/MagnetTransport.js`

- [ ] **Step 1: 实现 MagnetTransport** — 包装 magnetHandler.mjs 子进程 stdio JSON 通信，扩展 set-priority/set-speed-limit/verify-pieces 协议，限速流包装（Throttle Transform）

- [ ] **Step 2: 提交** — `feat: 添加 MagnetTransport`

---

### Task 20: magnetHandler.mjs 协议扩展

**Files:**
- Modify: `src/main/scripts/magnetHandler.mjs`

- [ ] **Step 1: 添加 `set-priority`/`set-speed-limit`/`verify-pieces` action 处理**

- [ ] **Step 2: 实现 Throttle Transform 流** — 在 `file.createReadStream` 外层包装

- [ ] **Step 3: 提交** — `feat: magnetHandler 协议扩展（限速/优先级/校验）`

---

### Task 21: LocalTransport 本地文件直读

**Files:**
- Create: `src/main/modules/streaming/transports/LocalTransport.js`

- [ ] **Step 1: 实现 LocalTransport** — 基于 fs.createReadStream + Range，probe 用 fs.statSync

- [ ] **Step 2: 提交** — `feat: 添加 LocalTransport`

---

## 阶段 7：集成验证与清理

### Task 22: 端到端验证

- [ ] **Step 1: 验证 HTTP 边下边播** — 粘贴 HTTP 直链 → 点播放 → 确认 5s 内画面出现 → 确认进度条同步

- [ ] **Step 2: 验证 HTTP 断点续传** — 暂停 → 关闭应用 → 重启 → 恢复下载 → 确认从断点继续

- [ ] **Step 3: 验证磁力边下边播** — 粘贴磁力链 → 选文件 → 确认播放启动

- [ ] **Step 4: 验证本地文件播放** — 拖入本地 MP4 → 确认播放正常

- [ ] **Step 5: 验证并发控制** — 同时启动 4 个下载 → 确认第 4 个排队等待

- [ ] **Step 6: 验证优先级抢占** — 排队中任务设为 high → 确认抢占低优先级活动任务

- [ ] **Step 7: 验证限速** — 全局限速 1MB/s → 确认下载速度受限

- [ ] **Step 8: 验证完整性校验** — 下载完成 → 确认 Content-Length 校验通过

- [ ] **Step 9: 验证错误重试** — 断网 → 确认自动重试 + "重试中 (1/4)" 提示

- [ ] **Step 10: 验证错误行动按钮** — 任务错误 → 确认显示"重试"/"检查网络"按钮

---

### Task 23: 删除旧代码

**Files:**
- Delete: `src/main/modules/DownloadManager.js`

- [ ] **Step 1: 确认所有引用已迁移** — 搜索 `DownloadManager` 引用，确认无残留

- [ ] **Step 2: 删除旧文件**

- [ ] **Step 3: 提交** — `refactor: 删除旧 DownloadManager`

---

### Task 24: 运行全量测试

- [ ] **Step 1: 运行所有 streaming 测试**

```bash
npx jest src/__tests__/streaming/ --verbose
```

- [ ] **Step 2: 确认所有测试通过**

- [ ] **Step 3: 运行 `npm run dev` 做最终冒烟测试**
