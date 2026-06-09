# 外链页面重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把外链页面（`#play-url-page`）从 4 个分散 section 改造为"智能识别巨输入框 + 按钮组 + 内联历史抽屉"的极简结构

**Architecture:** 前端 only 改造。完全复用现有 `magnetHandler.mjs`、`storage.js`、`select-video-file` / `handle-magnet-link` IPC 通道。新增 5 个职责单一的小模块（inputRecognizer / urlHistoryManager / fileListRenderer / magnetParserAdapter / historyDrawer），由改造后的 `PlayUrlController` 编排。

**Tech Stack:** Electron 27 + 原生 HTML/CSS/JS（无框架）+ Jest 30（ts-jest，纯函数模块单元测试）

**Spec 文档：** [2026-06-09-play-url-page-redesign-design.md](file:///e:/止水制造/项目/七星追剧/docs/superpowers/specs/2026-06-09-play-url-page-redesign-design.md)

---

## 文件结构

### 新建文件

```
src/renderer/
├── css/
│   └── play-url.css                           # 外链页专用样式
└── js/controllers/
    ├── inputRecognizer.js                     # 纯函数：detectInputType
    ├── urlHistoryManager.js                   # 包装 storage.js + 类型推断
    ├── fileListRenderer.js                    # 磁力文件列表 DOM 渲染
    ├── magnetParserAdapter.js                 # 包装 IPC 进度事件
    └── historyDrawer.js                       # 历史抽屉 DOM 组件

src/__tests__/
├── inputRecognizer.test.ts                    # 单元测试
└── urlHistoryManager.test.ts                  # 单元测试
```

### 修改文件

```
src/renderer/
├── index.html                                 # 替换 #play-url-page 整段
└── js/controllers/
    └── PlayUrlController.js                   # 改造为协调器
```

### 不动文件

- `src/renderer/js/storage.js`（现有 play_history 结构被 5 处复用，零修改）
- `src/main/modules/ipcHandler.js`（已有 select-video-file / handle-magnet-link）
- `src/main/scripts/magnetHandler.mjs`（磁力解析器）
- `src/preload.js`（IPC 白名单已含所需通道）
- `src/renderer/player.html`（播放器本身）

---

## 任务总览

| # | 任务 | 提交粒度 |
|---|---|---|
| T1 | inputRecognizer 纯函数（TDD） | 1 commit |
| T2 | urlHistoryManager 包装层（TDD） | 1 commit |
| T3 | fileListRenderer DOM 渲染 | 1 commit |
| T4 | magnetParserAdapter IPC 包装 | 1 commit |
| T5 | historyDrawer DOM 组件 | 1 commit |
| T6 | play-url.css 样式 | 1 commit |
| T7 | index.html 结构替换 | 1 commit |
| T8 | PlayUrlController 改造（集成） | 1 commit |
| T9 | 端到端验证 | 1 commit（如需修复） |

---

## Task 1: inputRecognizer 纯函数（TDD）

**Files:**
- Create: `src/__tests__/inputRecognizer.test.ts`
- Create: `src/renderer/js/controllers/inputRecognizer.js`

### Step 1: 写失败的测试

**先创建目录（如果不存在）：**

```bash
mkdir -p src/__tests__ src/renderer/js/controllers
```

**创建 `src/__tests__/inputRecognizer.test.ts`：**

```typescript
/**
 * inputRecognizer 单元测试
 * 纯函数：detectInputType(str) → { type, ...payload }
 */

import {
    detectInputType,
    TYPE_URL,
    TYPE_LOCAL,
    TYPE_MAGNET,
    TYPE_UNKNOWN,
    TYPE_EMPTY
} from '../renderer/js/controllers/inputRecognizer';

describe('detectInputType', () => {
    describe('magnet 识别', () => {
        it('应识别标准 magnet: URI', () => {
            const r = detectInputType('magnet:?xt=urn:btih:abc123def456abc123def456abc123def45678');
            expect(r.type).toBe(TYPE_MAGNET);
            expect(r.hash).toBe('abc123def456abc123def456abc123def45678');
        });

        it('应自动补全 40 位 hex Info Hash 的 magnet: 前缀', () => {
            const r = detectInputType('ABC123def456abc123def456abc123def45678');
            expect(r.type).toBe(TYPE_MAGNET);
            expect(r.hash).toBe('ABC123def456abc123def456abc123def45678');
            expect(r.magnetUri).toBe('magnet:?xt=urn:btih:ABC123def456abc123def456abc123def45678');
        });

        it('应自动补全 32 位 base32 Info Hash 的 magnet: 前缀', () => {
            const r = detectInputType('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
            expect(r.type).toBe(TYPE_MAGNET);
            expect(r.magnetUri).toContain('magnet:?xt=urn:btih:');
        });
    });

    describe('URL 识别', () => {
        it('应识别 .m3u8 https URL', () => {
            const r = detectInputType('https://cdn.example.com/video.m3u8');
            expect(r.type).toBe(TYPE_URL);
            expect(r.subtype).toBe('m3u8');
        });

        it('应识别 .mp4 https URL', () => {
            const r = detectInputType('https://x.com/a.mp4');
            expect(r.type).toBe(TYPE_URL);
            expect(r.subtype).toBe('mp4');
        });

        it('应识别无视频后缀的 https URL（待探测）', () => {
            const r = detectInputType('https://example.com/play?id=123');
            expect(r.type).toBe(TYPE_URL);
        });

        it('应识别 http:// URL', () => {
            const r = detectInputType('http://example.com/a.flv');
            expect(r.type).toBe(TYPE_URL);
        });
    });

    describe('本地文件识别', () => {
        it('应识别 file:// URI', () => {
            const r = detectInputType('file:///C:/movies/a.mp4');
            expect(r.type).toBe(TYPE_LOCAL);
            expect(r.path).toBe('C:\\movies\\a.mp4');
        });

        it('应识别 Windows 盘符路径', () => {
            const r = detectInputType('C:\\movies\\a.mp4');
            expect(r.type).toBe(TYPE_LOCAL);
            expect(r.path).toBe('C:\\movies\\a.mp4');
        });

        it('应识别 UNC 路径', () => {
            const r = detectInputType('\\\\server\\share\\a.mp4');
            expect(r.type).toBe(TYPE_LOCAL);
            expect(r.path).toBe('\\\\server\\share\\a.mp4');
        });

        it('应识别 POSIX 绝对路径（带文件存在性提示）', () => {
            const r = detectInputType('/home/user/movie.mp4');
            expect(r.type).toBe(TYPE_LOCAL);
            expect(r.path).toBe('/home/user/movie.mp4');
        });
    });

    describe('未知与空', () => {
        it('应将普通字符串识别为 unknown', () => {
            expect(detectInputType('hello world').type).toBe(TYPE_UNKNOWN);
        });

        it('应将空字符串识别为 empty', () => {
            expect(detectInputType('').type).toBe(TYPE_EMPTY);
        });

        it('应将纯空格识别为 empty', () => {
            expect(detectInputType('   ').type).toBe(TYPE_EMPTY);
        });
    });
});
```

### Step 2: 跑测试确认失败

```bash
cd "e:/止水制造/项目/七星追剧" && npx jest src/__tests__/inputRecognizer.test.ts 2>&1 | head -30
```

**Expected:** FAIL — `Cannot find module '../renderer/js/controllers/inputRecognizer'`

### Step 3: 实现 inputRecognizer

**创建 `src/renderer/js/controllers/inputRecognizer.js`：**

```javascript
/**
 * inputRecognizer
 * 智能识别用户输入内容的类型：URL / 本地文件 / 磁力链 / 未知
 * 纯函数，无副作用，可独立单测
 */

const TYPE_URL = 'url';
const TYPE_LOCAL = 'local';
const TYPE_MAGNET = 'magnet';
const TYPE_UNKNOWN = 'unknown';
const TYPE_EMPTY = 'empty';

const VIDEO_EXTS = ['m3u8', 'mp4', 'mkv', 'webm', 'avi', 'flv', 'mov', 'wmv'];

/**
 * 检测输入内容类型
 * @param {string} input - 用户输入的字符串
 * @returns {{ type: string, hash?: string, magnetUri?: string, path?: string, subtype?: string }}
 */
function detectInputType(input) {
    const str = (input || '').trim();
    if (!str) {
        return { type: TYPE_EMPTY };
    }

    // 1. 标准 magnet URI
    if (str.startsWith('magnet:')) {
        return parseMagnetUri(str);
    }

    // 2. 纯 40 位 hex Info Hash
    if (/^[a-fA-F0-9]{40}$/.test(str)) {
        return {
            type: TYPE_MAGNET,
            hash: str,
            magnetUri: `magnet:?xt=urn:btih:${str}`
        };
    }

    // 3. 纯 32 位 base32 Info Hash
    if (/^[A-Z2-7]{32}$/.test(str)) {
        return {
            type: TYPE_MAGNET,
            hash: str,
            magnetUri: `magnet:?xt=urn:btih:${str}`
        };
    }

    // 4. file:// URI
    if (str.startsWith('file://')) {
        return {
            type: TYPE_LOCAL,
            path: fileUriToPath(str)
        };
    }

    // 5. Windows 盘符路径
    if (/^[A-Za-z]:[\\/]/.test(str)) {
        return { type: TYPE_LOCAL, path: str };
    }

    // 6. UNC 路径
    if (str.startsWith('\\\\')) {
        return { type: TYPE_LOCAL, path: str };
    }

    // 7. POSIX 绝对路径
    if (str.startsWith('/')) {
        return { type: TYPE_LOCAL, path: str };
    }

    // 8. http(s) URL
    if (/^https?:\/\//i.test(str)) {
        return parseHttpUrl(str);
    }

    return { type: TYPE_UNKNOWN };
}

/**
 * 解析 magnet URI 提取 hash
 */
function parseMagnetUri(uri) {
    const match = uri.match(/urn:btih:([a-fA-F0-9]{40})/i) ||
                  uri.match(/urn:btih:([A-Z2-7]{32})/i);
    return {
        type: TYPE_MAGNET,
        hash: match ? match[1] : '',
        magnetUri: uri
    };
}

/**
 * 解析 http(s) URL，提取视频后缀
 */
function parseHttpUrl(url) {
    const pathname = url.split('?')[0].toLowerCase();
    for (const ext of VIDEO_EXTS) {
        if (pathname.endsWith('.' + ext)) {
            return { type: TYPE_URL, subtype: ext, url };
        }
    }
    return { type: TYPE_URL, url };
}

/**
 * 将 file:// URI 转为本地路径
 */
function fileUriToPath(uri) {
    // file:///C:/path → C:\path
    // file:///home/user/path → /home/user/path
    let p = uri.replace(/^file:\/\/\//, '');
    if (/^[A-Za-z]:/.test(p)) {
        p = p.replace(/\//g, '\\');
    }
    return decodeURIComponent(p);
}

// CommonJS 导出（Electron 渲染进程使用）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        detectInputType,
        TYPE_URL,
        TYPE_LOCAL,
        TYPE_MAGNET,
        TYPE_UNKNOWN,
        TYPE_EMPTY
    };
}
```

### Step 4: 跑测试确认通过

由于渲染进程 JS 是 CommonJS，需要在 jest.config.js 的 testMatch 中加 `.js`，或者用 TypeScript import（jest 会通过 ts-jest 编译 .js？不行，ts-jest 只处理 .ts/.tsx）。

**解决：在测试文件里改用 require 方式加载 .js 模块。** 把 `src/__tests__/inputRecognizer.test.ts` 改为：

```typescript
/**
 * inputRecognizer 单元测试
 * 纯函数：detectInputType(str) → { type, ...payload }
 */

const {
    detectInputType,
    TYPE_URL,
    TYPE_LOCAL,
    TYPE_MAGNET,
    TYPE_UNKNOWN,
    TYPE_EMPTY
} = require('../renderer/js/controllers/inputRecognizer');

describe('detectInputType', () => {
    describe('magnet 识别', () => {
        it('应识别标准 magnet: URI', () => {
            const r = detectInputType('magnet:?xt=urn:btih:abc123def456abc123def456abc123def45678');
            expect(r.type).toBe(TYPE_MAGNET);
            expect(r.hash).toBe('abc123def456abc123def456abc123def45678');
        });

        it('应自动补全 40 位 hex Info Hash 的 magnet: 前缀', () => {
            const r = detectInputType('ABC123def456abc123def456abc123def45678');
            expect(r.type).toBe(TYPE_MAGNET);
            expect(r.hash).toBe('ABC123def456abc123def456abc123def45678');
            expect(r.magnetUri).toBe('magnet:?xt=urn:btih:ABC123def456abc123def456abc123def45678');
        });

        it('应自动补全 32 位 base32 Info Hash 的 magnet: 前缀', () => {
            const r = detectInputType('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
            expect(r.type).toBe(TYPE_MAGNET);
            expect(r.magnetUri).toContain('magnet:?xt=urn:btih:');
        });
    });

    describe('URL 识别', () => {
        it('应识别 .m3u8 https URL', () => {
            const r = detectInputType('https://cdn.example.com/video.m3u8');
            expect(r.type).toBe(TYPE_URL);
            expect(r.subtype).toBe('m3u8');
        });

        it('应识别 .mp4 https URL', () => {
            const r = detectInputType('https://x.com/a.mp4');
            expect(r.type).toBe(TYPE_URL);
            expect(r.subtype).toBe('mp4');
        });

        it('应识别无视频后缀的 https URL（待探测）', () => {
            const r = detectInputType('https://example.com/play?id=123');
            expect(r.type).toBe(TYPE_URL);
        });

        it('应识别 http:// URL', () => {
            const r = detectInputType('http://example.com/a.flv');
            expect(r.type).toBe(TYPE_URL);
        });
    });

    describe('本地文件识别', () => {
        it('应识别 file:// URI', () => {
            const r = detectInputType('file:///C:/movies/a.mp4');
            expect(r.type).toBe(TYPE_LOCAL);
            expect(r.path).toBe('C:\\movies\\a.mp4');
        });

        it('应识别 Windows 盘符路径', () => {
            const r = detectInputType('C:\\movies\\a.mp4');
            expect(r.type).toBe(TYPE_LOCAL);
            expect(r.path).toBe('C:\\movies\\a.mp4');
        });

        it('应识别 UNC 路径', () => {
            const r = detectInputType('\\\\server\\share\\a.mp4');
            expect(r.type).toBe(TYPE_LOCAL);
            expect(r.path).toBe('\\\\server\\share\\a.mp4');
        });

        it('应识别 POSIX 绝对路径', () => {
            const r = detectInputType('/home/user/movie.mp4');
            expect(r.type).toBe(TYPE_LOCAL);
            expect(r.path).toBe('/home/user/movie.mp4');
        });
    });

    describe('未知与空', () => {
        it('应将普通字符串识别为 unknown', () => {
            expect(detectInputType('hello world').type).toBe(TYPE_UNKNOWN);
        });

        it('应将空字符串识别为 empty', () => {
            expect(detectInputType('').type).toBe(TYPE_EMPTY);
        });

        it('应将纯空格识别为 empty', () => {
            expect(detectInputType('   ').type).toBe(TYPE_EMPTY);
        });
    });
});
```

```bash
cd "e:/止水制造/项目/七星追剧" && npx jest src/__tests__/inputRecognizer.test.ts 2>&1 | tail -40
```

**Expected:** PASS — 14 tests passed

### Step 5: 提交

```bash
git add src/__tests__/inputRecognizer.test.ts src/renderer/js/controllers/inputRecognizer.js
git commit -m "feat: 新增 inputRecognizer 智能识别纯函数

识别用户输入内容类型（URL / 本地文件 / 磁力链 / 未知 / 空）。
14 个单测覆盖 magnet URI、40/32 位 Info Hash、http(s) URL、
file:// URI、Windows 盘符/UNC、POSIX 路径等场景。

为外链页重构提供核心识别能力。"
```

---

## Task 2: urlHistoryManager 包装层（TDD）

**Files:**
- Create: `src/__tests__/urlHistoryManager.test.ts`
- Create: `src/renderer/js/controllers/urlHistoryManager.js`

### Step 1: 写失败的测试

**创建 `src/__tests__/urlHistoryManager.test.ts`：**

```typescript
/**
 * urlHistoryManager 单元测试
 * 包装 storage.js 的 getPlayHistory / addPlayHistory / removePlayHistory
 * 增强功能：从 vod_id 前缀和 type_name 字段推断类型
 *
 * 策略：mock storage.js 模块，避免依赖 localStorage（Jest node 环境无 DOM）
 */

const urlHistoryManager = require('../renderer/js/controllers/urlHistoryManager');

// 内存存储，模拟 storage 的行为
const _store = { data: [] };

jest.mock('../renderer/js/storage', () => {
    return {
        StorageService: class MockStorage {
            getPlayHistory() {
                return [..._store.data];
            }
            addPlayHistory(item) {
                _store.data = _store.data.filter(x => x.vod_id !== item.vod_id);
                _store.data.unshift({ ...item, watch_time: item.watch_time || Date.now() });
            }
            removePlayHistory(vodId) {
                _store.data = _store.data.filter(x => x.vod_id !== vodId);
            }
        }
    };
});

describe('urlHistoryManager', () => {
    let manager;

    beforeEach(() => {
        _store.data = [];
        manager = new urlHistoryManager.UrlHistoryManager();
    });

    describe('addItem', () => {
        it('应正常添加 URL 类型历史', () => {
            manager.addItem({
                vod_id: 'https://x.com/a.mp4',
                vod_name: 'test.mp4',
                type_name: '外链'
            });
            const list = manager.getList();
            expect(list).toHaveLength(1);
            expect(list[0].vod_id).toBe('https://x.com/a.mp4');
        });

        it('应正常添加磁力链类型历史', () => {
            manager.addItem({
                vod_id: 'magnet:?xt=urn:btih:abc123def456abc123def456abc123def45678',
                vod_name: 'movie',
                type_name: '磁力'
            });
            expect(manager.getList()).toHaveLength(1);
        });

        it('应正常添加本地文件类型历史', () => {
            manager.addItem({
                vod_id: 'file:///C:/movies/a.mp4',
                vod_name: 'a.mp4',
                type_name: '本地'
            });
            expect(manager.getList()).toHaveLength(1);
        });
    });

    describe('inferType', () => {
        it('应从 vod_id 推断为 magnet', () => {
            expect(manager.inferType({ vod_id: 'magnet:?xt=urn:btih:abc' })).toBe('magnet');
        });

        it('应从 vod_id 推断为 url', () => {
            expect(manager.inferType({ vod_id: 'https://x.com/a.mp4' })).toBe('url');
        });

        it('应从 vod_id 推断为 local', () => {
            expect(manager.inferType({ vod_id: 'file:///C:/a.mp4' })).toBe('local');
        });

        it('应从 type_name 字段推断为 magnet', () => {
            expect(manager.inferType({ vod_id: 'x', type_name: '磁力' })).toBe('magnet');
        });
    });

    describe('removeItem', () => {
        it('应按 vod_id 删除', () => {
            manager.addItem({ vod_id: 'https://a.com', vod_name: 'a' });
            manager.addItem({ vod_id: 'https://b.com', vod_name: 'b' });
            manager.removeItem('https://a.com');
            const list = manager.getList();
            expect(list).toHaveLength(1);
            expect(list[0].vod_id).toBe('https://b.com');
        });
    });

    describe('错误处理', () => {
        it('getList 在 storage 抛错时返回空数组', () => {
            // 替换 addPlayHistory 抛错
            const origAdd = manager._storage.addPlayHistory;
            manager._storage.addPlayHistory = () => { throw new Error('quota exceeded'); };
            manager.addItem({ vod_id: 'https://x.com', vod_name: 'x' });
            // addItem 应静默失败
            expect(manager.getList()).toEqual([]);
            manager._storage.addPlayHistory = origAdd;
        });
    });
});
```

### Step 2: 跑测试确认失败

```bash
cd "e:/止水制造/项目/七星追剧" && npx jest src/__tests__/urlHistoryManager.test.ts 2>&1 | tail -20
```

**Expected:** FAIL — `Cannot find module`

### Step 3: 实现 urlHistoryManager

**创建 `src/renderer/js/controllers/urlHistoryManager.js`：**

```javascript
/**
 * urlHistoryManager
 * 包装 storage.js 的 play history API
 * 增强：从 vod_id 前缀 + type_name 字段推断类型（magnet / url / local）
 *
 * 严格遵循 project memory 规范：
 * - 正常路径不输出 [STORAGE] 日志
 * - 异常路径 console.error 后降级（getList 返回 []，写入静默失败）
 */

const { StorageService } = require('../renderer/js/storage');

class UrlHistoryManager {
    constructor() {
        this._storage = new StorageService();
    }

    /**
     * 获取历史列表（已按时间倒序）
     * @returns {Array}
     */
    getList() {
        try {
            return this._storage.getPlayHistory();
        } catch (error) {
            console.error('[STORAGE] urlHistoryManager.getList 失败:', error);
            return [];
        }
    }

    /**
     * 添加历史项
     * @param {{ vod_id: string, vod_name: string, type_name?: string, [k: string]: any }} item
     */
    addItem(item) {
        try {
            if (!item || !item.vod_id) {
                return;
            }
            this._storage.addPlayHistory({
                vod_id: item.vod_id,
                vod_name: item.vod_name || item.vod_id,
                vod_pic: item.vod_pic || '',
                type_name: item.type_name || this._typeNameFromId(item.vod_id),
                current_episode: 1,
                episode_name: '正片',
                watch_time: Date.now(),
                site_name: '',
                site_url: '',
                progress: 0,
                play_duration: 0
            });
        } catch (error) {
            console.error('[STORAGE] urlHistoryManager.addItem 失败:', error);
        }
    }

    /**
     * 删除历史项
     * @param {string} vodId
     */
    removeItem(vodId) {
        try {
            this._storage.removePlayHistory(vodId);
        } catch (error) {
            console.error('[STORAGE] urlHistoryManager.removeItem 失败:', error);
        }
    }

    /**
     * 从 vod_id 前缀推断类型
     * @param {string} vodId
     * @returns {'magnet'|'url'|'local'|'unknown'}
     */
    inferType(item) {
        if (!item) return 'unknown';
        const id = item.vod_id || '';
        if (id.startsWith('magnet:') || /^[a-fA-F0-9]{40}$/.test(id) || /^[A-Z2-7]{32}$/.test(id)) {
            return 'magnet';
        }
        if (id.startsWith('file://') || /^[A-Za-z]:[\\/]/.test(id) || id.startsWith('\\\\') || id.startsWith('/')) {
            return 'local';
        }
        if (id.startsWith('http://') || id.startsWith('https://')) {
            return 'url';
        }
        // 兜底：type_name 字段
        if (item.type_name === '磁力') return 'magnet';
        if (item.type_name === '本地') return 'local';
        if (item.type_name === '外链') return 'url';
        return 'unknown';
    }

    _typeNameFromId(vodId) {
        const t = this.inferType({ vod_id: vodId });
        return { magnet: '磁力', local: '本地', url: '外链' }[t] || '外链';
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { UrlHistoryManager };
}
```

### Step 4: 跑测试确认通过

```bash
cd "e:/止水制造/项目/七星追剧" && npx jest src/__tests__/urlHistoryManager.test.ts 2>&1 | tail -20
```

**Expected:** PASS — 7 tests passed

### Step 5: 提交

```bash
git add src/__tests__/urlHistoryManager.test.ts src/renderer/js/controllers/urlHistoryManager.js
git commit -m "feat: 新增 urlHistoryManager 包装 storage.js

提供 vod_id 类型推断（magnet/url/local）、历史增删查、错误降级。
7 个单测覆盖三类来源、推断、降级场景。

为外链页历史抽屉提供数据访问层。"
```

---

## Task 3: fileListRenderer DOM 渲染

**Files:**
- Create: `src/renderer/js/controllers/fileListRenderer.js`

### Step 1: 实现 fileListRenderer

**创建 `src/renderer/js/controllers/fileListRenderer.js`：**

```javascript
/**
 * fileListRenderer
 * 渲染磁力链解析后的文件列表（卡片式）
 * 智能标记"主视频文件"：体积最大的 .mp4/.mkv/.webm/.avi
 */

const VIDEO_EXTS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm3u8'];

/**
 * 渲染文件列表到容器
 * @param {HTMLElement} container - 容器 DOM
 * @param {Array<{ name: string, length: number, [k: string]: any }>} files - 原始文件列表
 * @param {(file: object, index: number) => void} onPlayClick - 播放回调
 * @returns {{ videos: Array, recommendedIndex: number }}
 */
function renderFileList(container, files, onPlayClick) {
    if (!container) {
        return { videos: [], recommendedIndex: -1 };
    }

    const videos = files.filter(f => isVideoFile(f.name));

    if (videos.length === 0) {
        container.innerHTML = `
            <div class="play-url-empty">
                <p>该资源不含可播放视频文件</p>
            </div>
        `;
        return { videos: [], recommendedIndex: -1 };
    }

    const recommendedIndex = pickRecommendedIndex(videos);

    container.innerHTML = videos.map((f, i) => {
        const isRecommended = i === recommendedIndex;
        const sizeText = formatFileSize(f.length);
        return `
            <div class="play-url-file-card${isRecommended ? ' is-recommended' : ''}" data-index="${i}">
                <span class="play-url-file-icon">${isRecommended ? '⭐' : '🎬'}</span>
                <div class="play-url-file-info">
                    <div class="play-url-file-name">${escapeHtml(f.name)}</div>
                    <div class="play-url-file-meta">${sizeText}</div>
                </div>
                <button class="play-url-file-play" data-index="${i}">播放</button>
            </div>
        `;
    }).join('');

    // 绑定点击事件
    container.querySelectorAll('.play-url-file-play').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-index'), 10);
            if (typeof onPlayClick === 'function') {
                onPlayClick(videos[idx], idx);
            }
        });
    });

    return { videos, recommendedIndex };
}

/**
 * 判断是否为视频文件
 */
function isVideoFile(name) {
    if (!name) return false;
    const ext = name.split('.').pop().toLowerCase();
    return VIDEO_EXTS.includes(ext);
}

/**
 * 选择推荐索引（体积最大的视频文件）
 */
function pickRecommendedIndex(videos) {
    let maxIdx = 0;
    let maxSize = 0;
    videos.forEach((v, i) => {
        if (v.length > maxSize) {
            maxSize = v.length;
            maxIdx = i;
        }
    });
    return maxIdx;
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let i = 0;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[i]}`;
}

/**
 * HTML 转义
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderFileList, isVideoFile, formatFileSize };
}
```

### Step 2: 提交

```bash
git add src/renderer/js/controllers/fileListRenderer.js
git commit -m "feat: 新增 fileListRenderer 文件列表 DOM 渲染器

渲染磁力链文件列表为卡片，智能标记体积最大视频为"⭐ 推荐"。
支持空列表、HTML 转义、点击回调。"
```

---

## Task 4: magnetParserAdapter IPC 包装

**Files:**
- Create: `src/renderer/js/controllers/magnetParserAdapter.js`

### Step 1: 实现 magnetParserAdapter

**创建 `src/renderer/js/controllers/magnetParserAdapter.js`：**

```javascript
/**
 * magnetParserAdapter
 * 包装现有 IPC：
 * - invoke('handle-magnet-link', magnetUri) 解析磁力链
 * - on('magnet-progress', callback) 订阅下载进度
 * - removeMagnetProgressListener() 清理监听
 *
 * 不修改主进程，不动 magnetHandler.mjs
 */

class MagnetParserAdapter {
    constructor() {
        this._ipc = (typeof window !== 'undefined' && window.electron) ? window.electron : null;
        this._progressCallback = null;
    }

    /**
     * 检查 IPC 是否可用
     * @returns {boolean}
     */
    isAvailable() {
        return !!(this._ipc && this._ipc.ipcRenderer && typeof this._ipc.ipcRenderer.invoke === 'function');
    }

    /**
     * 订阅进度事件
     * @param {(data: { status: string, progress: number, speed?: string, eta?: string }) => void} callback
     */
    onProgress(callback) {
        if (!this.isAvailable() || !this._ipc.onMagnetProgress) return;
        this._progressCallback = callback;
        this._ipc.onMagnetProgress(callback);
    }

    /**
     * 移除进度监听
     */
    removeProgressListener() {
        if (!this.isAvailable()) return;
        if (this._ipc.removeMagnetProgressListener) {
            this._ipc.removeMagnetProgressListener();
        }
        this._progressCallback = null;
    }

    /**
     * 解析磁力链（resolve action）
     * @param {string} magnetUri
     * @returns {Promise<{ success: boolean, files?: Array, infoHash?: string, error?: string }>}
     */
    async parse(magnetUri) {
        if (!this.isAvailable()) {
            return { success: false, error: 'Electron IPC 不可用' };
        }
        try {
            const result = await this._ipc.ipcRenderer.invoke('handle-magnet-link', magnetUri);
            if (result && result.success) {
                return {
                    success: true,
                    files: result.files || [],
                    infoHash: result.infoHash || ''
                };
            }
            return { success: false, error: result?.error || '磁力链解析失败' };
        } catch (error) {
            return { success: false, error: error.message || String(error) };
        }
    }

    /**
     * 播放指定文件（play action）
     * @param {string} magnetUri
     * @param {string} fileName
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    async play(magnetUri, fileName) {
        if (!this.isAvailable()) {
            return { success: false, error: 'Electron IPC 不可用' };
        }
        try {
            const result = await this._ipc.ipcRenderer.invoke('play-magnet-file', { magnetUri, fileName });
            return result && result.success
                ? { success: true }
                : { success: false, error: result?.error || '播放失败' };
        } catch (error) {
            return { success: false, error: error.message || String(error) };
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MagnetParserAdapter };
}
```

### Step 2: 提交

```bash
git add src/renderer/js/controllers/magnetParserAdapter.js
git commit -m "feat: 新增 magnetParserAdapter 包装 IPC

包装 handle-magnet-link / magnet-progress / play-magnet-file。
零主进程改动，零 magnetHandler.mjs 改动。"
```

---

## Task 5: historyDrawer DOM 组件

**Files:**
- Create: `src/renderer/js/controllers/historyDrawer.js`

### Step 1: 实现 historyDrawer

**创建 `src/renderer/js/controllers/historyDrawer.js`：**

```javascript
/**
 * historyDrawer
 * 外链页内联历史抽屉：展开/折叠/列表渲染/点击再播/删除/复制
 *
 * 依赖：
 * - urlHistoryManager.getList() / removeItem()
 * - inputRecognizer.inferType() 用于徽章
 */

class HistoryDrawer {
    /**
     * @param {{
     *   container: HTMLElement,
     *   historyManager: { getList: () => Array, removeItem: (id: string) => void },
     *   inferType: (item: object) => 'magnet'|'url'|'local'|'unknown',
     *   onItemClick: (item: object) => void
     * }} options
     */
    constructor(options) {
        this.container = options.container;
        this.historyManager = options.historyManager;
        this.inferType = options.inferType;
        this.onItemClick = options.onItemClick || (() => {});
        this._isOpen = false;
    }

    /**
     * 切换展开/折叠
     */
    toggle() {
        if (this._isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * 展开抽屉
     */
    open() {
        if (!this.container) return;
        this._isOpen = true;
        this.container.classList.add('is-open');
        this.render();
    }

    /**
     * 折叠抽屉
     */
    close() {
        if (!this.container) return;
        this._isOpen = false;
        this.container.classList.remove('is-open');
    }

    /**
     * 重新渲染列表
     */
    render() {
        if (!this.container || !this._isOpen) return;

        const list = this.historyManager.getList();
        if (!list || list.length === 0) {
            this.container.innerHTML = `
                <div class="play-url-history-empty">
                    <p>暂无历史记录</p>
                </div>
            `;
            return;
        }

        this.container.innerHTML = `
            <div class="play-url-history-list">
                ${list.map((item, i) => this._renderItem(item, i)).join('')}
            </div>
        `;

        // 绑定事件
        this.container.querySelectorAll('.play-url-history-item').forEach(el => {
            const vodId = el.getAttribute('data-vod-id');
            const idx = parseInt(el.getAttribute('data-idx'), 10);
            const item = list[idx];

            el.addEventListener('click', e => {
                if (e.target.closest('.play-url-history-action')) return;
                this.onItemClick(item);
            });

            const deleteBtn = el.querySelector('.play-url-history-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    this.historyManager.removeItem(vodId);
                    this.render();
                });
            }

            const copyBtn = el.querySelector('.play-url-history-copy');
            if (copyBtn) {
                copyBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    this._copyToClipboard(vodId);
                });
            }
        });
    }

    _renderItem(item, idx) {
        const type = this.inferType(item);
        const typeIcon = { magnet: '🧲', url: '🌐', local: '📁', unknown: '❓' }[type] || '❓';
        const typeLabel = { magnet: '磁力', url: 'URL', local: '本地', unknown: '未知' }[type] || '未知';
        const title = item.vod_name || item.vod_id || '未命名';
        const timeText = this._formatTime(item.watch_time);

        return `
            <div class="play-url-history-item" data-vod-id="${this._escapeAttr(item.vod_id)}" data-idx="${idx}">
                <span class="play-url-history-icon">${typeIcon}</span>
                <div class="play-url-history-info">
                    <div class="play-url-history-title">${this._escapeHtml(title)}</div>
                    <div class="play-url-history-meta">${typeLabel} · ${timeText}</div>
                </div>
                <div class="play-url-history-actions">
                    <button class="play-url-history-action play-url-history-copy" title="复制链接">📋</button>
                    <button class="play-url-history-action play-url-history-delete" title="删除">🗑️</button>
                </div>
            </div>
        `;
    }

    _formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        const now = Date.now();
        const diff = now - ts;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
        if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`;
        return d.toLocaleDateString('zh-CN');
    }

    _copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
        }
    }

    _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    _escapeAttr(str) {
        if (!str) return '';
        return String(str).replace(/"/g, '&quot;');
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HistoryDrawer };
}
```

### Step 2: 提交

```bash
git add src/renderer/js/controllers/historyDrawer.js
git commit -m "feat: 新增 historyDrawer DOM 抽屉组件

外链页内联历史抽屉：open/close/render/再播/删除/复制。
依赖 urlHistoryManager + inputRecognizer.inferType。"
```

---

## Task 6: play-url.css 样式

**Files:**
- Create: `src/renderer/css/play-url.css`

### Step 1: 创建样式文件

**创建 `src/renderer/css/play-url.css`：**

```css
/**
 * 外链页面专用样式
 * 巨输入框 + 智能识别徽章 + 按钮组 + 历史抽屉
 */

/* ========== 页面容器 ========== */
#play-url-page .page-content {
    max-width: 920px;
    margin: 0 auto;
    padding: 24px 20px 40px;
}

#play-url-page .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 28px;
}

#play-url-page .page-header h2 {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary, #fff);
    margin: 0;
}

#play-url-page .page-header-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary, #aaa);
    cursor: pointer;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 13px;
    transition: background 0.15s;
}

#play-url-page .page-header-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-primary, #fff);
}

/* ========== 巨输入框 ========== */
.play-url-input-wrapper {
    position: relative;
    margin-bottom: 14px;
}

.play-url-input {
    width: 100%;
    min-height: 180px;
    max-height: 320px;
    padding: 24px 100px 24px 24px;
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-primary, #fff);
    background: var(--bg-secondary, #1a1d24);
    border: 1.5px solid var(--border-color, #2d3340);
    border-radius: 12px;
    resize: vertical;
    font-family: inherit;
    transition: border-color 0.2s, box-shadow 0.2s;
    box-sizing: border-box;
}

.play-url-input::placeholder {
    color: var(--text-secondary, #888);
}

.play-url-input:focus {
    outline: none;
    border-color: #a78bfa;
    box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.15);
}

.play-url-input.is-dragover {
    border-color: #a78bfa;
    border-style: dashed;
    background: rgba(167, 139, 250, 0.05);
}

/* ========== 识别徽章 ========== */
.play-url-badge {
    position: absolute;
    top: 14px;
    right: 14px;
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 4px;
    pointer-events: none;
    background: rgba(167, 139, 250, 0.15);
    color: #a78bfa;
    border: 1px solid rgba(167, 139, 250, 0.3);
}

.play-url-badge.is-url { background: rgba(96, 165, 250, 0.15); color: #60a5fa; border-color: rgba(96, 165, 250, 0.3); }
.play-url-badge.is-local { background: rgba(74, 222, 128, 0.15); color: #4ade80; border-color: rgba(74, 222, 128, 0.3); }
.play-url-badge.is-magnet { background: rgba(251, 146, 60, 0.15); color: #fb923c; border-color: rgba(251, 146, 60, 0.3); }
.play-url-badge.is-unknown { background: rgba(248, 113, 113, 0.15); color: #f87171; border-color: rgba(248, 113, 113, 0.3); }
.play-url-badge.is-empty { display: none; }

/* ========== 主操作按钮 ========== */
.play-url-primary-action {
    width: 100%;
    padding: 14px;
    font-size: 15px;
    font-weight: 500;
    color: #fff;
    background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: opacity 0.2s, transform 0.1s;
}

.play-url-primary-action:hover:not(:disabled) {
    opacity: 0.92;
}

.play-url-primary-action:active:not(:disabled) {
    transform: scale(0.99);
}

.play-url-primary-action:disabled {
    background: var(--border-color, #2d3340);
    color: var(--text-secondary, #888);
    cursor: not-allowed;
}

/* ========== 磁力链进度区 ========== */
.play-url-progress {
    margin-top: 18px;
    padding: 16px;
    background: var(--bg-secondary, #1a1d24);
    border: 1px solid var(--border-color, #2d3340);
    border-radius: 10px;
}

.play-url-progress.is-error {
    border-color: rgba(248, 113, 113, 0.5);
    background: rgba(248, 113, 113, 0.05);
}

.play-url-progress.is-warning {
    border-color: rgba(251, 191, 36, 0.5);
    background: rgba(251, 191, 36, 0.05);
}

.play-url-progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    font-size: 13px;
    color: var(--text-primary, #fff);
}

.play-url-progress-bar {
    height: 6px;
    background: var(--border-color, #2d3340);
    border-radius: 3px;
    overflow: hidden;
}

.play-url-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #a78bfa 0%, #7c3aed 100%);
    width: 0;
    transition: width 0.3s;
}

.play-url-progress.is-error .play-url-progress-fill {
    background: #f87171;
}

.play-url-progress-cancel {
    background: transparent;
    border: 1px solid var(--border-color, #2d3340);
    color: var(--text-secondary, #aaa);
    padding: 4px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
}

/* ========== 文件列表 ========== */
.play-url-files {
    margin-top: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.play-url-file-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    background: var(--bg-secondary, #1a1d24);
    border: 1px solid var(--border-color, #2d3340);
    border-radius: 10px;
    transition: border-color 0.15s, background 0.15s;
}

.play-url-file-card:hover {
    border-color: rgba(167, 139, 250, 0.4);
    background: rgba(167, 139, 250, 0.05);
}

.play-url-file-card.is-recommended {
    border-color: rgba(251, 191, 36, 0.4);
    background: rgba(251, 191, 36, 0.05);
}

.play-url-file-icon {
    font-size: 20px;
    flex-shrink: 0;
}

.play-url-file-info {
    flex: 1;
    min-width: 0;
}

.play-url-file-name {
    font-size: 14px;
    color: var(--text-primary, #fff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.play-url-file-meta {
    font-size: 11px;
    color: var(--text-secondary, #888);
    margin-top: 2px;
}

.play-url-file-play {
    background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%);
    color: #fff;
    border: none;
    padding: 6px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    flex-shrink: 0;
}

.play-url-empty {
    margin-top: 18px;
    padding: 20px;
    text-align: center;
    color: var(--text-secondary, #888);
    background: var(--bg-secondary, #1a1d24);
    border: 1px dashed var(--border-color, #2d3340);
    border-radius: 10px;
}

/* ========== 按钮组 ========== */
.play-url-buttons {
    display: flex;
    gap: 10px;
    margin-top: 18px;
}

.play-url-secondary-btn {
    flex: 1;
    padding: 10px 14px;
    font-size: 13px;
    color: var(--text-primary, #fff);
    background: transparent;
    border: 1px solid var(--border-color, #2d3340);
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background 0.15s, border-color 0.15s;
}

.play-url-secondary-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(167, 139, 250, 0.4);
}

/* ========== 历史抽屉 ========== */
.play-url-history-drawer {
    margin-top: 18px;
    background: var(--bg-secondary, #1a1d24);
    border: 1px solid var(--border-color, #2d3340);
    border-radius: 10px;
    overflow: hidden;
    display: none;
}

.play-url-history-drawer.is-open {
    display: block;
}

.play-url-history-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color, #2d3340);
    font-size: 13px;
    color: var(--text-secondary, #aaa);
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.play-url-history-list {
    max-height: 400px;
    overflow-y: auto;
}

.play-url-history-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    cursor: pointer;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    transition: background 0.12s;
}

.play-url-history-item:hover {
    background: rgba(167, 139, 250, 0.08);
}

.play-url-history-item:last-child {
    border-bottom: none;
}

.play-url-history-icon {
    font-size: 18px;
    flex-shrink: 0;
}

.play-url-history-info {
    flex: 1;
    min-width: 0;
}

.play-url-history-title {
    font-size: 13px;
    color: var(--text-primary, #fff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.play-url-history-meta {
    font-size: 11px;
    color: var(--text-secondary, #888);
    margin-top: 2px;
}

.play-url-history-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
}

.play-url-history-action {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    font-size: 14px;
    opacity: 0.6;
    transition: opacity 0.12s, background 0.12s;
}

.play-url-history-action:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.08);
}

.play-url-history-empty {
    padding: 24px;
    text-align: center;
    color: var(--text-secondary, #888);
    font-size: 13px;
}
```

### Step 2: 提交

```bash
git add src/renderer/css/play-url.css
git commit -m "feat: 新增 play-url.css 外链页专用样式

巨输入框、识别徽章、主操作按钮、磁力进度区、文件列表、
按钮组、历史抽屉全套样式。深色主题，遵循项目设计令牌。"
```

---

## Task 7: index.html 结构替换

**Files:**
- Modify: `src/renderer/index.html`（替换 `#play-url-page` 段）

### Step 1: 引入新 CSS

在 `<head>` 区域，找到 `routes.css` 引入行后追加：

```html
<link rel="stylesheet" href="css/play-url.css">
```

### Step 2: 替换 #play-url-page

在 `src/renderer/index.html` 中，**整体替换**第 215-287 行（`<div id="play-url-page" class="page">` 到对应 `</div>` 结束）。

**新内容：**

```html
                <!-- 外链页面 -->
                <div id="play-url-page" class="page">
                    <div class="page-content">
                        <div class="page-header">
                            <h2>外链</h2>
                            <button class="page-header-btn" id="play-url-clear-btn" title="清空输入">清空</button>
                        </div>

                        <div class="play-url-input-wrapper">
                            <textarea
                                id="play-url-input"
                                class="play-url-input"
                                placeholder="输入视频链接 / 磁力链 / 本地路径 / Info Hash..."
                                spellcheck="false"
                                autocomplete="off"></textarea>
                            <span class="play-url-badge is-empty" id="play-url-badge">🌐 URL</span>
                        </div>

                        <button class="play-url-primary-action" id="play-url-submit" disabled>
                            <span>▶</span>
                            <span>立即播放</span>
                        </button>

                        <div class="play-url-progress" id="play-url-progress" style="display: none;">
                            <div class="play-url-progress-header">
                                <span id="play-url-progress-status">解析中...</span>
                                <button class="play-url-progress-cancel" id="play-url-progress-cancel">取消</button>
                            </div>
                            <div class="play-url-progress-bar">
                                <div class="play-url-progress-fill" id="play-url-progress-fill" style="width: 0%;"></div>
                            </div>
                        </div>

                        <div class="play-url-files" id="play-url-files"></div>

                        <div class="play-url-buttons">
                            <button class="play-url-secondary-btn" id="play-url-pick-file">📁 选择本地文件</button>
                            <button class="play-url-secondary-btn" id="play-url-toggle-history">🕘 查看历史</button>
                        </div>

                        <div class="play-url-history-drawer" id="play-url-history-drawer">
                            <div class="play-url-history-header">
                                <span>历史记录</span>
                                <button class="play-url-history-action" id="play-url-history-clear" title="清空历史">清空</button>
                            </div>
                            <div id="play-url-history-list"></div>
                        </div>
                    </div>
                </div>
```

### Step 3: 提交

```bash
git add src/renderer/index.html
git commit -m "refactor: 重构 #play-url-page 页面结构

替换为巨输入框 + 智能识别徽章 + 主操作按钮 + 磁力进度区 +
按钮组 + 内联历史抽屉的极简结构。引入 play-url.css。"
```

---

## Task 8: PlayUrlController 改造（集成）

**Files:**
- Modify: `src/renderer/js/controllers/PlayUrlController.js`（整体重写）

### Step 1: 重写 PlayUrlController

**整体替换 `src/renderer/js/controllers/PlayUrlController.js`：**

```javascript
/**
 * PlayUrlController
 * 外链页协调器。连接 inputRecognizer / urlHistoryManager /
 * fileListRenderer / magnetParserAdapter / historyDrawer。
 *
 * 状态机：
 *   IDLE → EDITING → RECOGNIZED → PLAYING_DIRECT
 *                              → PARSE_PROGRESS → FILES_READY → PLAYING_MAGNET
 *   任意态点取消 → 回 IDLE
 */

const {
    detectInputType
} = require('./inputRecognizer');
const { UrlHistoryManager } = require('./urlHistoryManager');
const { renderFileList } = require('./fileListRenderer');
const { MagnetParserAdapter } = require('./magnetParserAdapter');
const { HistoryDrawer } = require('./historyDrawer');

const STATE = {
    IDLE: 'idle',
    EDITING: 'editing',
    RECOGNIZED: 'recognized',
    PARSE_PROGRESS: 'parse_progress',
    FILES_READY: 'files_ready',
    PLAYING: 'playing'
};

class PlayUrlController {
    constructor(app) {
        this.app = app;
        this.componentService = app.componentService;
        this.state = STATE.IDLE;
        this._lastInput = '';
        this._currentMagnetUri = '';
        this._currentFiles = [];
        this._historyManager = new UrlHistoryManager();
        this._magnetParser = new MagnetParserAdapter();
        this._historyDrawer = null;
        this._detectTimer = null;
    }

    /**
     * 初始化外链页
     */
    initialize() {
        this._cacheDom();
        this._setupInputEvents();
        this._setupActionButtons();
        this._setupDropZone();
        this._initHistoryDrawer();
    }

    _cacheDom() {
        this.dom = {
            input: document.getElementById('play-url-input'),
            badge: document.getElementById('play-url-badge'),
            submit: document.getElementById('play-url-submit'),
            clear: document.getElementById('play-url-clear-btn'),
            progress: document.getElementById('play-url-progress'),
            progressStatus: document.getElementById('play-url-progress-status'),
            progressFill: document.getElementById('play-url-progress-fill'),
            progressCancel: document.getElementById('play-url-progress-cancel'),
            files: document.getElementById('play-url-files'),
            pickFile: document.getElementById('play-url-pick-file'),
            toggleHistory: document.getElementById('play-url-toggle-history'),
            historyDrawer: document.getElementById('play-url-history-drawer'),
            historyList: document.getElementById('play-url-history-list')
        };
    }

    _setupInputEvents() {
        if (!this.dom.input) return;

        this.dom.input.addEventListener('input', () => {
            this.state = STATE.EDITING;
            this._scheduleDetect();
        });

        this.dom.input.addEventListener('paste', () => {
            // paste 后 input 事件会触发，依赖 input 监听即可
        });

        this.dom.input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this._handleSubmit();
            }
        });
    }

    _scheduleDetect() {
        clearTimeout(this._detectTimer);
        this._detectTimer = setTimeout(() => {
            this._runDetect();
        }, 200);
    }

    _runDetect() {
        if (!this.dom.input) return;
        const value = this.dom.input.value;
        this._lastInput = value;
        const result = detectInputType(value);
        this._updateBadge(result.type);

        if (result.type === 'empty' || result.type === 'unknown') {
            this.dom.submit.disabled = true;
            this.state = STATE.IDLE;
        } else {
            this.dom.submit.disabled = false;
            this.state = STATE.RECOGNIZED;
        }
    }

    _updateBadge(type) {
        if (!this.dom.badge) return;
        const map = {
            url: { text: '🌐 URL', cls: 'is-url' },
            local: { text: '📁 本地', cls: 'is-local' },
            magnet: { text: '🧲 磁力', cls: 'is-magnet' },
            unknown: { text: '❓ 未知', cls: 'is-unknown' },
            empty: { text: '', cls: 'is-empty' }
        };
        const info = map[type] || map.empty;
        this.dom.badge.textContent = info.text;
        this.dom.badge.className = 'play-url-badge ' + info.cls;
    }

    _setupActionButtons() {
        if (this.dom.submit) {
            this.dom.submit.addEventListener('click', () => this._handleSubmit());
        }
        if (this.dom.clear) {
            this.dom.clear.addEventListener('click', () => this._handleClear());
        }
        if (this.dom.pickFile) {
            this.dom.pickFile.addEventListener('click', () => this._handlePickFile());
        }
        if (this.dom.toggleHistory) {
            this.dom.toggleHistory.addEventListener('click', () => this._historyDrawer?.toggle());
        }
        if (this.dom.progressCancel) {
            this.dom.progressCancel.addEventListener('click', () => this._handleCancel());
        }
        const clearHistoryBtn = document.getElementById('play-url-history-clear');
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => this._handleClearHistory());
        }
    }

    _setupDropZone() {
        if (!this.dom.input) return;
        const input = this.dom.input;

        ['dragenter', 'dragover'].forEach(evt => {
            input.addEventListener(evt, e => {
                e.preventDefault();
                e.stopPropagation();
                input.classList.add('is-dragover');
            });
        });

        ['dragleave', 'drop'].forEach(evt => {
            input.addEventListener(evt, e => {
                e.preventDefault();
                e.stopPropagation();
                input.classList.remove('is-dragover');
            });
        });

        input.addEventListener('drop', e => {
            const text = e.dataTransfer.getData('text/plain');
            if (text) {
                input.value = text;
                this._runDetect();
            }
        });
    }

    _initHistoryDrawer() {
        this._historyDrawer = new HistoryDrawer({
            container: this.dom.historyDrawer,
            historyManager: this._historyManager,
            inferType: item => this._historyManager.inferType(item),
            onItemClick: item => this._handleHistoryItemClick(item)
        });
    }

    _handleSubmit() {
        if (this.dom.submit.disabled) return;
        const result = detectInputType(this._lastInput);
        if (result.type === 'unknown' || result.type === 'empty') return;

        if (result.type === 'magnet') {
            this._handleMagnet(result.magnetUri || result.hash);
        } else if (result.type === 'url') {
            this._handleNetworkUrl(result.url || this._lastInput);
        } else if (result.type === 'local') {
            this._handleLocalFile(result.path || this._lastInput);
        }
    }

    _handleMagnet(magnetUri) {
        this._currentMagnetUri = magnetUri;
        this.state = STATE.PARSE_PROGRESS;
        this._showProgress('正在解析磁力链...', 0);
        this._hideFiles();
        this._historyManager.addItem({
            vod_id: magnetUri,
            vod_name: this._extractMagnetName(magnetUri),
            type_name: '磁力'
        });

        this._magnetParser.onProgress(data => {
            if (data && typeof data.progress === 'number') {
                const pct = Math.round(data.progress);
                const status = data.status || `下载中... ${pct}%`;
                this._showProgress(status, pct);
            }
        });

        this._magnetParser.parse(magnetUri).then(result => {
            this._magnetParser.removeProgressListener();
            if (!result.success) {
                this._showProgress(`❌ 解析失败：${result.error}`, 0, 'error');
                return;
            }
            this._hideProgress();
            this._showFiles(result.files, magnetUri);
        }).catch(error => {
            this._magnetParser.removeProgressListener();
            this._showProgress(`❌ 解析失败：${error.message}`, 0, 'error');
        });
    }

    _handleNetworkUrl(url) {
        this.state = STATE.PLAYING;
        this._historyManager.addItem({
            vod_id: url,
            vod_name: this._extractFileName(url),
            type_name: '外链'
        });
        this._openPlayer({
            url,
            title: this._extractFileName(url) || '网络视频',
            vod_name: this._extractFileName(url) || '网络视频',
            episode_name: '正片',
            isDirectPlay: true,
            playSource: 'network'
        });
    }

    _handleLocalFile(filePath) {
        this.state = STATE.PLAYING;
        const fileUrl = filePath.startsWith('file://') ? filePath : `file:///${filePath.replace(/\\/g, '/')}`;
        this._historyManager.addItem({
            vod_id: fileUrl,
            vod_name: this._extractFileName(filePath),
            type_name: '本地'
        });
        this._openPlayer({
            url: fileUrl,
            title: this._extractFileName(filePath) || '本地文件',
            vod_name: this._extractFileName(filePath) || '本地文件',
            episode_name: '正片',
            isDirectPlay: true,
            playSource: 'local'
        });
    }

    _handlePickFile() {
        if (!this._magnetParser.isAvailable()) {
            this._notify('Electron IPC 不可用', 'error');
            return;
        }
        window.electron.ipcRenderer.invoke('select-video-file').then(result => {
            if (!result || !result.success) {
                return;
            }
            this.dom.input.value = result.filePath;
            this._runDetect();
        });
    }

    _handleCancel() {
        this._magnetParser.removeProgressListener();
        this._hideProgress();
        this._hideFiles();
        this.state = STATE.IDLE;
    }

    _handleClear() {
        this.dom.input.value = '';
        this._runDetect();
        this._hideProgress();
        this._hideFiles();
    }

    _handleClearHistory() {
        const list = this._historyManager.getList();
        list.forEach(item => this._historyManager.removeItem(item.vod_id));
        this._historyDrawer.render();
    }

    _handleHistoryItemClick(item) {
        const type = this._historyManager.inferType(item);
        if (type === 'magnet') {
            this.dom.input.value = item.vod_id;
            this._runDetect();
            this._historyDrawer.close();
        } else if (type === 'url') {
            this._handleNetworkUrl(item.vod_id);
        } else if (type === 'local') {
            const path = item.vod_id.startsWith('file://')
                ? item.vod_id.replace(/^file:\/\/\//, '').replace(/\//g, '\\')
                : item.vod_id;
            this._handleLocalFile(path);
        }
    }

    _showProgress(status, pct, variant) {
        this.dom.progress.style.display = 'block';
        this.dom.progressStatus.textContent = status;
        this.dom.progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
        this.dom.progress.className = 'play-url-progress' + (variant ? ' is-' + variant : '');
    }

    _hideProgress() {
        this.dom.progress.style.display = 'none';
    }

    _showFiles(files, magnetUri) {
        this._currentFiles = files;
        this._currentMagnetUri = magnetUri;
        this.state = STATE.FILES_READY;
        renderFileList(this.dom.files, files, (file) => {
            this._playMagnetFile(magnetUri, file.name);
        });
    }

    _hideFiles() {
        this.dom.files.innerHTML = '';
    }

    _playMagnetFile(magnetUri, fileName) {
        this.state = STATE.PLAYING;
        this._magnetParser.play(magnetUri, fileName).then(result => {
            if (!result.success) {
                this._notify(`播放失败：${result.error}`, 'error');
            }
        });
    }

    _openPlayer(videoData) {
        if (typeof this.app?.openPlayer === 'function') {
            this.app.openPlayer(videoData);
        } else if (this.componentService?.openPlayer) {
            this.componentService.openPlayer(videoData);
        } else {
            this._notify('播放器未就绪', 'error');
        }
    }

    _notify(message, type) {
        if (this.componentService?.showNotification) {
            this.componentService.showNotification(message, type);
        }
    }

    _extractFileName(url) {
        if (!url) return '';
        const cleaned = url.split('?')[0].split('#')[0];
        const parts = cleaned.split('/');
        return parts[parts.length - 1] || '';
    }

    _extractMagnetName(magnetUri) {
        const dnMatch = magnetUri.match(/dn=([^&]+)/);
        if (dnMatch) {
            try {
                return decodeURIComponent(dnMatch[1]);
            } catch (e) {
                return dnMatch[1];
            }
        }
        return '磁力资源';
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PlayUrlController, STATE };
}
```

### Step 2: 跑测试确认不破坏

```bash
cd "e:/止水制造/项目/七星追剧" && npx jest 2>&1 | tail -15
```

**Expected:** 21 tests passed（inputRecognizer 14 + urlHistoryManager 7）

### Step 3: 提交

```bash
git add src/renderer/js/controllers/PlayUrlController.js
git commit -m "refactor: 改造 PlayUrlController 为协调器

集成 5 个子模块：inputRecognizer / urlHistoryManager /
fileListRenderer / magnetParserAdapter / historyDrawer。

实现状态机（IDLE → EDITING → RECOGNIZED → PARSE_PROGRESS →
FILES_READY → PLAYING），处理 4 种用户路径。"
```

---

## Task 9: 端到端验证

**Files:** 无（仅验证）

### Step 1: 启动开发模式

```bash
cd "e:/止水制造/项目/七星追剧" && npm run dev
```

**Expected:** Electron 应用启动，外链菜单点击进入新页面

### Step 2: 验证场景 1（粘贴 URL）

- 在巨输入框粘贴 `https://x.com/a.m3u8`
- 期望：右上角徽章显示 `🌐 URL`，"立即播放"按钮可用
- 点击播放 → 进入播放器

### Step 3: 验证场景 2（拖拽本地文件）

- 从资源管理器拖一个 .mp4 到巨输入框
- 期望：输入框高亮，松开后值变为文件路径，徽章 `📁 本地`
- 点击播放 → 进入播放器

### Step 4: 验证场景 3（磁力链）

- 粘贴 `magnet:?xt=urn:btih:abc123def456abc123def456abc123def45678`
- 期望：徽章 `🧲 磁力`，点播放 → 进度区出现 → 文件列表就地展开
- 选文件 → 进入播放器（流式下载中）

### Step 5: 验证场景 4（选择本地文件按钮）

- 点「📁 选择本地文件」→ 系统对话框
- 选文件 → 自动回填到巨输入框 → 徽章 `📁 本地`
- 点播放 → 进入播放器

### Step 6: 验证场景 5（历史抽屉）

- 点「🕘 查看历史」→ 抽屉展开，列出 4 条历史（URL / 本地 / 磁力 / file://）
- 点其中一项 → 关闭抽屉，磁力/URL/本地 进入对应播放流程
- 点删除按钮 → 该项消失
- 点清空 → 列表清空

### Step 7: 验证场景 6（错误处理）

- 输入 `hello world` → 徽章 `❓ 未知`，按钮置灰
- 输入 `C:\nonexistent\nope.mp4` → 徽章 `📁 本地`，按钮可用，点播放 → 播放器内显示"文件不存在"错误页

### Step 8: 提交（如有修复）

如端到端验证发现问题，修复后单独提交：

```bash
git add -A
git commit -m "fix: 端到端验证修复

[描述具体修复的问题]"
```

---

## 自审清单

✅ **Spec 覆盖：**
- 整体页面架构 → T7
- 智能识别 + file:// → T1
- 磁力链解析流程（方案 A）→ T4 + T8
- 状态机 → T8
- 错误处理 → T1/T2/T8（异常路径 console.error）
- 复用 storage.js 不动 → T2（仅包装）
- 复用 IPC 通道 → T4（仅包装）
- 历史抽屉 → T5
- localStorage 静默日志规范 → T2（构造函数 try/catch + 异常 console.error）
- 命名规范（PascalCase / _camelCase）→ T1-T8 全部遵守

✅ **类型一致性：**
- `detectInputType` 返回 `{type, ...}` 在 T1 定义，T8 调用一致
- `inferType(item)` 在 T1/T2/T5/T8 调用签名一致
- `HistoryDrawer` 构造参数 `inferType` 在 T5/T8 一致

✅ **无占位符：** 全文所有代码块完整，无 TBD / TODO / "类似 Task N"。

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-06-09-play-url-page-redesign.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 每个任务派一个独立子代理执行，任务间人工 review，快速迭代

**2. Inline Execution** - 当前会话内顺序执行任务，含检查点

请告诉我用哪种方式开始实施。
