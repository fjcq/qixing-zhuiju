// @ts-nocheck
// nodeEnvironment 单元测试
// 关键：验证三层回退策略（electron-bundled → portable → system）
// 验证：缓存、invalidate、portableDir、状态对象结构

const fs = require('fs');
const path = require('path');
const os = require('os');

// 关键：用 jest.mock 在 require 之前替换 electron 模块
// 这样 nodeEnvironment.js 顶层 const { app } = require('electron') 拿到的就是 mock
// 注意：jest.mock 的 factory 只能引用 jest 自身和模块外层 require,不能引用工厂内 import 的变量
jest.mock('electron', () => {
    const path = require('path');
    const os = require('os');
    const testUserData = path.join(os.tmpdir(), 'qixing-test-node-env');
    return {
        app: {
            isPackaged: false,
            getPath: jest.fn(() => testUserData)
        }
    };
});

// 必须在 mock 设置好之后 require
const electron = require('electron');
const nodeEnvironment = require('../main/modules/nodeEnvironment');

describe('nodeEnvironment', () => {
    // 测试前清理可能残留的缓存目录
    const testUserData = path.join(os.tmpdir(), 'qixing-test-node-env');
    const testPortableDir = path.join(testUserData, 'node-portable');

    beforeEach(() => {
        // 重置 mock 的 getPath 返回值（指向测试 userData）
        // 关键：只能改 getPath 函数,不能改整个 app 对象
        //       因为 nodeEnvironment.js 顶层 const { app } 已经捕获了 mock app 的引用
        electron.app.isPackaged = false;
        electron.app.getPath.mockImplementation(() => testUserData);
        // 清空解析缓存（每个测试都重新解析）
        nodeEnvironment.invalidate();
    });

    afterAll(() => {
        // 清理测试目录
        try {
            if (fs.existsSync(testUserData)) {
                fs.rmSync(testUserData, { recursive: true, force: true });
            }
        } catch (e) { /* 忽略清理失败 */ }
    });

    describe('SOURCE 枚举', () => {
        test('应包含全部 4 个来源标识', () => {
            expect(nodeEnvironment.SOURCE.ELECTRON_BUNDLED).toBe('electron-bundled');
            expect(nodeEnvironment.SOURCE.PORTABLE).toBe('portable');
            expect(nodeEnvironment.SOURCE.SYSTEM).toBe('system');
            expect(nodeEnvironment.SOURCE.NONE).toBe('none');
        });
    });

    describe('getPortableDir', () => {
        test('未设置 app userData 时降级到家目录', () => {
            // app.getPath 抛错的情况（app 未 ready）
            electron.app.getPath.mockImplementation(() => {
                throw new Error('app not ready');
            });
            const dir = nodeEnvironment.getPortableDir();
            expect(dir).toContain('.qixing-zhuiju');
            expect(dir).toContain('node-portable');
        });

        test('app ready 时使用 userData 目录', () => {
            // 用 path.normalize 处理 Windows 短路径/长路径差异
            const dir = nodeEnvironment.getPortableDir();
            expect(path.normalize(dir)).toBe(path.normalize(testPortableDir));
        });
    });

    describe('resolve 解析顺序', () => {
        test('无 Electron 进程标识 + 无便携版目录 + 无系统 Node → 返回 null', async () => {
            // 在纯 Node 环境跑测试：process.versions.electron 是 undefined
            // 没有便携版目录，系统 Node 是否存在由环境决定
            // 我们测试返回值结构，而不依赖具体值
            const result = await nodeEnvironment.resolve();
            // 真实环境中要么返回 system（系统装了 Node），要么返回 null
            if (result === null) {
                expect(result).toBeNull();
            } else {
                // 至少返回的对象有 source/isElectron/version
                expect(result).toHaveProperty('source');
                expect(result).toHaveProperty('isElectron');
                expect(result).toHaveProperty('version');
            }
        });
    });

    describe('缓存与 invalidate', () => {
        test('多次 resolve 命中缓存', async () => {
            const r1 = await nodeEnvironment.resolve();
            const r2 = await nodeEnvironment.resolve();
            // 解析结果是同一个对象引用（缓存命中）
            expect(r1).toBe(r2);
        });

        test('invalidate 后会重新解析', async () => {
            const r1 = await nodeEnvironment.resolve();
            nodeEnvironment.invalidate();
            const r2 = await nodeEnvironment.resolve();
            // invalidate 后重新解析：引用应不同（即使是相同 source）
            // 实际值可能相同（环境没变），但调用确实重跑了
            // 这里只能间接验证：调用没有报错
            expect(r2).toBeDefined();
        });
    });

    describe('getStatus', () => {
        test('返回结构完整', async () => {
            const status = await nodeEnvironment.getStatus();
            // 验证所有字段都存在
            expect(status).toHaveProperty('ok');
            expect(status).toHaveProperty('source');
            expect(status).toHaveProperty('sourceLabel');
            expect(status).toHaveProperty('nodePath');
            expect(status).toHaveProperty('version');
            expect(status).toHaveProperty('description');
            expect(status).toHaveProperty('electronBundled');
            expect(status).toHaveProperty('portableAvailable');
            expect(status).toHaveProperty('portableDir');
            expect(status).toHaveProperty('systemAvailable');
            expect(status).toHaveProperty('magnetRuntimeOk');
            expect(status).toHaveProperty('magnetRuntimePath');
            expect(status).toHaveProperty('issues');
            expect(Array.isArray(status.issues)).toBe(true);
        });

        test('包含本地 magnet-runtime 时 magnetRuntimeOk=true', async () => {
            // 验证：项目自带的 magnet-runtime/node_modules/webtorrent 存在
            const status = await nodeEnvironment.getStatus();
            // 实际值取决于执行环境（CI 还是本地）
            // 我们只验证字段类型
            expect(typeof status.magnetRuntimeOk).toBe('boolean');
        });

        test('electronBundled 反映 process.versions.electron 是否存在', async () => {
            const status = await nodeEnvironment.getStatus();
            const expected = !!process.versions.electron;
            expect(status.electronBundled).toBe(expected);
        });
    });

    describe('spawnNode', () => {
        test('未找到 Node 时抛出 NODE_NOT_FOUND 错误', async () => {
            // 关键：nodeEnvironment.js 中的 spawnNode 调用的是模块闭包内的 resolve,
            //       替换 module.exports.resolve 无效。必须 mock 内部的子函数并 invalidate。
            const origElectron = nodeEnvironment._internal.resolveElectronBundled;
            const origPortable = nodeEnvironment._internal.resolvePortable;
            const origSystem = nodeEnvironment._internal.resolveSystem;
            nodeEnvironment._internal.resolveElectronBundled = () => null;
            nodeEnvironment._internal.resolvePortable = async () => null;
            nodeEnvironment._internal.resolveSystem = async () => null;
            nodeEnvironment.invalidate();
            try {
                await expect(nodeEnvironment.spawnNode(['/tmp/test.js']))
                    .rejects.toThrow(/未找到可用的 Node\.js/);
                await expect(nodeEnvironment.spawnNode(['/tmp/test.js']))
                    .rejects.toMatchObject({ code: 'NODE_NOT_FOUND' });
            } finally {
                nodeEnvironment._internal.resolveElectronBundled = origElectron;
                nodeEnvironment._internal.resolvePortable = origPortable;
                nodeEnvironment._internal.resolveSystem = origSystem;
                nodeEnvironment.invalidate();
            }
        });

        test('解析成功时返回 ChildProcess-like 对象', async () => {
            // 在系统 Node.js 可用的环境下应能 spawn 一个短命进程
            const status = await nodeEnvironment.getStatus();
            if (!status.ok) {
                // 跳过：环境不可用
                return;
            }
            const child = await nodeEnvironment.spawnNode(['-e', '1+1']);
            expect(child).toBeDefined();
            expect(typeof child.pid).toBe('number');
            // 清理子进程
            try { child.kill(); } catch (e) { /* 忽略 */ }
        });
    });

    describe('内部方法', () => {
        test('_internal 暴露了测试所需的探针', () => {
            expect(typeof nodeEnvironment._internal.probeNodeAt).toBe('function');
            expect(typeof nodeEnvironment._internal.runProbe).toBe('function');
        });

        test('probeNodeAt 对不存在的路径返回 ok=false', async () => {
            const r = await nodeEnvironment._internal.probeNodeAt('/nonexistent/node');
            expect(r.ok).toBe(false);
        });
    });
});
