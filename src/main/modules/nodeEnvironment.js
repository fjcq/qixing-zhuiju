// Node.js 运行环境解析模块
// 目标：让用户无需手动安装 Node.js 也能使用磁力链等子进程功能
// 三层回退策略：
//   1) Electron 内置 Node.js（process.execPath + ELECTRON_RUN_AS_NODE=1）—— 零安装、零下载
//   2) 便携版 Node.js（userData/node-portable/）—— 首次按需下载/解压，兼容旧版 Electron 升级场景
//   3) 系统 Node.js（where/which node）—— 兜底，用户已安装时复用
//
// 设计要点：
// - 单例：解析结果缓存到 _resolved，再次调用直接返回
// - 隔离：通过 ELECTRON_RUN_AS_NODE 模式启动 Electron 二进制，避免与 Electron 主进程 IPC 冲突
// - 透明：调用方只关心"拿到一个能跑 .mjs 脚本的二进制"，不关心来源

const { app } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 来源标识：用于 UI 展示与诊断
 *  - electron-bundled : Electron 自带 Node.js（最佳，零依赖）
 *  - portable         : 应用自带的便携版 Node.js
 *  - system           : 用户系统已安装的 Node.js
 *  - none             : 所有路径都不可用
 */
const SOURCE = Object.freeze({
    ELECTRON_BUNDLED: 'electron-bundled',
    PORTABLE: 'portable',
    SYSTEM: 'system',
    NONE: 'none'
});

// 缓存解析结果，避免每次启动磁力链子进程都重新检测
let _resolved = null;

// 探测超时：避免系统 where/which 卡死（比如 PATH 异常时）
const PROBE_TIMEOUT_MS = 5000;

/**
 * 异步执行命令并返回 stdout
 * @param {string} cmd - 可执行文件名（PATH 查找）
 * @param {string[]} args
 * @param {object} [extraEnv] - 追加环境变量（如 ELECTRON_RUN_AS_NODE=1）
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string, code: number|null}>}
 */
function runProbe(cmd, args, extraEnv) {
    return new Promise(resolve => {
        try {
            const opts = { timeout: PROBE_TIMEOUT_MS, windowsHide: true };
            if (extraEnv) {
                opts.env = { ...process.env, ...extraEnv };
            }
            const child = execFile(cmd, args, opts, (err, stdout, stderr) => {
                resolve({
                    ok: !err,
                    stdout: String(stdout || '').trim(),
                    stderr: String(stderr || '').trim(),
                    code: err && typeof err.code === 'number' ? err.code : null
                });
            });
            child.on('error', () => resolve({ ok: false, stdout: '', stderr: '', code: null }));
        } catch (e) {
            resolve({ ok: false, stdout: '', stderr: String(e && e.message || e), code: null });
        }
    });
}

/**
 * 获取便携版 Node.js 的安装目录
 * 路径：userData/node-portable/<版本>/
 * 关键：app.getPath 必须在 app ready 之后调用，否则会抛运行时错误
 *       失败时降级到 ~/.qixing-zhuiju/node-portable/
 */
function getPortableDir() {
    let userData = '';
    try {
        if (app && typeof app.getPath === 'function') {
            userData = app.getPath('userData');
        }
    } catch (e) { /* 忽略：app 未 ready */ }
    const base = userData || path.join(os.homedir(), '.qixing-zhuiju');
    return path.join(base, 'node-portable');
}

/**
 * 检查指定路径的 node 可执行文件是否可用
 * @param {string} nodePath
 * @returns {Promise<{ok: boolean, version?: string}>}
 */
async function probeNodeAt(nodePath) {
    if (!nodePath || !fs.existsSync(nodePath)) {
        return { ok: false };
    }
    const r = await runProbe(nodePath, ['--version']);
    if (!r.ok) return { ok: false };
    // 'v18.18.2' → '18.18.2'
    const versionMatch = r.stdout.match(/v?(\d+\.\d+\.\d+)/);
    return { ok: true, version: versionMatch ? versionMatch[1] : r.stdout };
}

/**
 * 解析 Electron 内置的 Node.js
 * 关键：Electron 27 自带 Node 18.18.2，已满足 webtorrent v2.x 的最低要求（>=16）
 * 启动方式：spawn(process.execPath, [...], { env: { ELECTRON_RUN_AS_NODE: '1', ... } })
 *           这会让 Electron 二进制以纯 Node.js 模式运行，不启动 Chromium
 */
function resolveElectronBundled() {
    if (!process.versions || !process.versions.electron) {
        return null;
    }
    return {
        source: SOURCE.ELECTRON_BUNDLED,
        nodePath: process.execPath,
        isElectron: true,
        version: process.versions.node,
        description: `Electron ${process.versions.electron} 内置 Node.js ${process.versions.node}`
    };
}

/**
 * 解析便携版 Node.js
 * 按目录扫描：<portableDir>/<ver>/node.exe
 * 多个版本共存时取最新版本号
 */
async function resolvePortable() {
    const dir = getPortableDir();
    if (!fs.existsSync(dir)) {
        return null;
    }
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
            .filter(d => d.isDirectory());
    } catch (e) {
        return null;
    }
    if (entries.length === 0) {
        return null;
    }
    // 按目录名（约定为版本号）排序，取最大
    const sorted = entries
        .map(d => ({ name: d.name, full: path.join(dir, d.name, 'node.exe') }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    for (let i = sorted.length - 1; i >= 0; i--) {
        const probe = await probeNodeAt(sorted[i].full);
        if (probe.ok) {
            return {
                source: SOURCE.PORTABLE,
                nodePath: sorted[i].full,
                isElectron: false,
                version: probe.version,
                description: `便携版 Node.js ${probe.version} (${sorted[i].name})`
            };
        }
    }
    return null;
}

/**
 * 解析系统 Node.js
 * Windows 用 where，POSIX 用 which
 * 拿不到时再尝试常见安装路径
 */
async function resolveSystem() {
    const isWin = process.platform === 'win32';
    const finder = isWin ? 'where' : 'which';
    const probe = await runProbe(finder, ['node']);
    let candidate = '';
    if (probe.ok && probe.stdout) {
        // where 可能返回多行（多个 node 路径），取第一个存在的
        const lines = probe.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        for (const line of lines) {
            if (fs.existsSync(line)) {
                candidate = line;
                break;
            }
        }
    }
    // 兜底：常见安装路径（针对国内用户最常见的安装位置）
    if (!candidate) {
        const fallbacks = isWin ? [
            'C:\\Program Files\\nodejs\\node.exe',
            'C:\\Program Files (x86)\\nodejs\\node.exe',
            path.join(os.homedir(), 'AppData', 'Roaming', 'nvm', 'current', 'node.exe'),
            'D:\\nodejs\\node.exe',
            'D:\\Program Files\\nodejs\\node.exe'
        ] : [
            '/usr/local/bin/node',
            '/usr/bin/node',
            path.join(os.homedir(), '.nvm', 'current', 'bin', 'node')
        ];
        for (const p of fallbacks) {
            if (fs.existsSync(p)) {
                candidate = p;
                break;
            }
        }
    }
    if (!candidate) {
        return null;
    }
    const probeVersion = await probeNodeAt(candidate);
    if (!probeVersion.ok) {
        return null;
    }
    return {
        source: SOURCE.SYSTEM,
        nodePath: candidate,
        isElectron: false,
        version: probeVersion.version,
        description: `系统 Node.js ${probeVersion.version} (${candidate})`
    };
}

// 内部子函数对象（导出 + 模块内共用同一个引用）
// 关键：让 _internal = module.exports._internal 是同一个对象
//       这样测试修改 _internal 子函数（如 mock resolveElectronBundled 返回 null）
//       也能让模块内 resolve() 看到（因为它通过 _internal.resolveElectronBundled() 调用）
//       否则 spawnNode 内部用的就是模块闭包内的 resolve,无法被测试覆盖
const _internal = {
    probeNodeAt,
    resolveElectronBundled,
    resolvePortable,
    resolveSystem,
    runProbe
};

/**
 * 解析当前可用的 Node.js 运行时
 * 解析顺序固定：electron-bundled → portable → system
 * 关键：内部子函数通过 _internal 调用,这样测试可以 mock
 * @returns {Promise<{
 *   source: string,
 *   nodePath: string,
 *   isElectron: boolean,
 *   version: string,
 *   description: string
 * } | null>} 找不到任何可用 Node.js 时返回 null
 */
async function resolve() {
    if (_resolved) return _resolved;

    // 1) Electron 内置（零成本，绝大多数情况走这里）
    const electron = _internal.resolveElectronBundled();
    if (electron) {
        // 启动一个短命子进程验证 ELECTRON_RUN_AS_NODE 模式可用
        // 关键：有些 Electron 版本可能不响应 ELECTRON_RUN_AS_NODE
        // 启动失败时回退到 portable → system
        const probe = await _internal.runProbe(electron.nodePath, ['--version'], {
            ELECTRON_RUN_AS_NODE: '1'
        });
        if (probe.ok) {
            const versionMatch = probe.stdout.match(/v?(\d+\.\d+\.\d+)/);
            if (versionMatch) {
                electron.version = versionMatch[1];
                _resolved = electron;
                return _resolved;
            }
        }
    }

    // 2) 便携版
    const portable = await _internal.resolvePortable();
    if (portable) {
        _resolved = portable;
        return _resolved;
    }

    // 3) 系统 Node.js
    const system = await _internal.resolveSystem();
    if (system) {
        _resolved = system;
        return _resolved;
    }

    return null;
}

/**
 * 获取当前环境状态（用于 UI 展示）
 * - 不缓存：每次都做轻量检测，保证状态实时
 * - 包含 magnet-runtime 完整性（webtorrent 等依赖是否齐全）
 * @returns {Promise<{
 *   ok: boolean,
 *   source: string,
 *   sourceLabel: string,
 *   nodePath: string,
 *   version: string,
 *   description: string,
 *   electronBundled: boolean,
 *   portableAvailable: boolean,
 *   portableDir: string,
 *   systemAvailable: boolean,
 *   magnetRuntimeOk: boolean,
 *   magnetRuntimePath: string,
 *   issues: string[]
 * }>}
 */
async function getStatus() {
    const resolved = await resolve();
    const issues = [];

    // 检测 magnet-runtime 完整性
    // 关键：magnet-runtime/node_modules 必须在打包资源里
    // 缺失时所有 Node.js 路径都救不了——必须明确告诉用户
    // 优先检查开发环境路径是否存在，避免 app.isPackaged 误判
    let magnetRuntimePath = '';
    let magnetRuntimeOk = false;
    const devMagnetRuntimePath = path.join(__dirname, '..', '..', '..', 'magnet-runtime');
    if (fs.existsSync(devMagnetRuntimePath)) {
        magnetRuntimePath = devMagnetRuntimePath;
    } else {
        magnetRuntimePath = path.join(process.resourcesPath, 'magnet-runtime');
    }
    try {
        // 必须存在 webtorrent 才能用，否则只算半个环境
        const webtorrentPath = path.join(magnetRuntimePath, 'node_modules', 'webtorrent');
        if (fs.existsSync(webtorrentPath)) {
            magnetRuntimeOk = true;
        } else {
            issues.push('磁力链运行时目录不完整（缺少 webtorrent），磁力链功能不可用');
        }
    } catch (e) {
        issues.push(`磁力链运行时检测失败: ${(e && e.message) || e}`);
    }

    // 检查便携版是否已就绪
    let portableAvailable = false;
    const portableDir = getPortableDir();
    try {
        if (fs.existsSync(portableDir)) {
            const subdirs = fs.readdirSync(portableDir, { withFileTypes: true })
                .filter(d => d.isDirectory());
            portableAvailable = subdirs.length > 0;
        }
    } catch (e) { /* 忽略 */ }

    // 来源标签：UI 用
    const sourceLabelMap = {
        [SOURCE.ELECTRON_BUNDLED]: '应用内置',
        [SOURCE.PORTABLE]: '便携版',
        [SOURCE.SYSTEM]: '系统安装',
        [SOURCE.NONE]: '未找到'
    };

    if (!resolved) {
        issues.push('未找到任何可用的 Node.js 运行环境');
    }
    if (resolved && !magnetRuntimeOk) {
        issues.push('磁力链依赖缺失，需要重新安装应用');
    }

    return {
        ok: !!resolved && magnetRuntimeOk,
        source: resolved ? resolved.source : SOURCE.NONE,
        sourceLabel: resolved ? sourceLabelMap[resolved.source] : '未找到',
        nodePath: resolved ? resolved.nodePath : '',
        version: resolved ? resolved.version : '',
        description: resolved ? resolved.description : '',
        electronBundled: !!process.versions.electron,
        portableAvailable,
        portableDir,
        systemAvailable: resolved ? resolved.source === SOURCE.SYSTEM : false,
        magnetRuntimeOk,
        magnetRuntimePath,
        issues
    };
}

/**
 * 重置解析缓存（用于"环境修复"按钮：清缓存后重新解析）
 * 关键：用户可能刚下载了便携版 Node.js，需要重新解析才能命中
 */
function invalidate() {
    _resolved = null;
}

/**
 * 以解析好的 Node.js 启动子进程
 * 自动附加 ELECTRON_RUN_AS_NODE=1（如果是 Electron 内置 Node.js）
 * @param {string[]} args - 传给 node 的参数，如 ['/path/to/script.mjs']
 * @param {object} [opts] - child_process.spawn 选项
 * @returns {Promise<import('child_process').ChildProcess>}
 */
async function spawnNode(args, opts = {}) {
    const resolved = await resolve();
    if (!resolved) {
        const err = new Error('未找到可用的 Node.js 运行环境');
        err.code = 'NODE_NOT_FOUND';
        throw err;
    }
    const env = { ...(opts.env || process.env) };
    if (resolved.isElectron) {
        env.ELECTRON_RUN_AS_NODE = '1';
    }
    return spawn(resolved.nodePath, args, {
        ...opts,
        env
    });
}

module.exports = {
    SOURCE,
    resolve,
    getStatus,
    invalidate,
    spawnNode,
    getPortableDir,
    // 内部方法导出，便于测试和诊断
    // 关键：与模块内 _internal 引用同一个对象,这样测试 mock 子函数能影响 resolve
    _internal
};
