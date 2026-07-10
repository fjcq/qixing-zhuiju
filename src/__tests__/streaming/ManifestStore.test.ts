// @ts-nocheck
const ManifestStore = require('../../main/modules/streaming/persistence/ManifestStore');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('ManifestStore', () =>
{
    let tmpDir;
    let manifestPath;
    let store;

    beforeEach(() =>
    {
        // 创建临时测试目录，避免污染真实清单文件
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
        manifestPath = path.join(tmpDir, 'manifest.json');
        store = new ManifestStore({ manifestPath });
    });

    afterEach(() =>
    {
        // 递归清理临时目录
        if (fs.existsSync(tmpDir))
        {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    /**
     * 构造一个最小可用任务对象
     * @param {Object} [overrides] - 覆盖字段
     * @returns {Object} 任务对象
     */
    const makeTask = overrides =>
    {
        return Object.assign({
            id: 'task-1',
            source: { type: 'url', value: 'https://example.com/a.mp4' },
            name: 'a.mp4',
            savePath: '/tmp/a.mp4',
            totalBytes: 1000,
            downloadedBytes: 0,
            downloadedRanges: [],
            status: 'queued',
            priority: 'normal',
            speedLimit: 0,
            mode: 'stream'
        }, overrides || {});
    };

    describe('load', () =>
    {
        it('文件不存在时初始化为空', async () =>
        {
            await store.load();
            expect(store.getAll()).toEqual([]);
        });

        it('文件存在时正确加载', async () =>
        {
            const tasks = {
                tasks: [
                    makeTask({ id: 'task-1', status: 'paused' }),
                    makeTask({ id: 'task-2', status: 'completed' })
                ]
            };
            fs.writeFileSync(manifestPath, JSON.stringify(tasks), 'utf8');
            await store.load();
            const all = store.getAll();
            expect(all).toHaveLength(2);
            expect(all[0].id).toBe('task-1');
            expect(all[0].status).toBe('paused');
            expect(all[1].id).toBe('task-2');
            expect(all[1].status).toBe('completed');
        });

        it('文件损坏（无效 JSON）时初始化为空', async () =>
        {
            fs.writeFileSync(manifestPath, '{not valid json', 'utf8');
            await store.load();
            expect(store.getAll()).toEqual([]);
        });

        it('返回 this 支持链式调用', async () =>
        {
            const result = await store.load();
            expect(result).toBe(store);
        });
    });

    describe('add', () =>
    {
        it('添加任务并自动补充时间戳', async () =>
        {
            const before = Date.now();
            await store.add(makeTask({ id: 'task-1' }));
            const after = Date.now();
            const task = store.get('task-1');
            expect(task).toBeDefined();
            expect(task.createdAt).toBeGreaterThanOrEqual(before);
            expect(task.createdAt).toBeLessThanOrEqual(after);
            expect(task.updatedAt).toBeGreaterThanOrEqual(before);
            expect(task.updatedAt).toBeLessThanOrEqual(after);
        });

        it('保留任务自带的 createdAt', async () =>
        {
            const fixedTs = 1000000;
            await store.add(makeTask({ id: 'task-1', createdAt: fixedTs }));
            const task = store.get('task-1');
            expect(task.createdAt).toBe(fixedTs);
        });

        it('重复 id 时覆盖旧任务', async () =>
        {
            await store.add(makeTask({ id: 'task-1', name: 'old.mp4' }));
            await store.add(makeTask({ id: 'task-1', name: 'new.mp4' }));
            const all = store.getAll();
            expect(all).toHaveLength(1);
            expect(all[0].name).toBe('new.mp4');
        });

        it('持久化到磁盘，重新加载后可读取', async () =>
        {
            await store.add(makeTask({ id: 'task-1', status: 'paused' }));
            const store2 = new ManifestStore({ manifestPath });
            await store2.load();
            const task = store2.get('task-1');
            expect(task).toBeDefined();
            expect(task.status).toBe('paused');
        });
    });

    describe('get', () =>
    {
        it('返回任务浅拷贝，修改不影响内部状态', async () =>
        {
            await store.add(makeTask({ id: 'task-1', status: 'queued' }));
            const task = store.get('task-1');
            task.status = 'completed';
            task.name = 'modified.mp4';
            const internal = store.get('task-1');
            expect(internal.status).toBe('queued');
            expect(internal.name).toBe('a.mp4');
        });

        it('不存在的 id 返回 undefined', () =>
        {
            expect(store.get('not-exist')).toBeUndefined();
        });
    });

    describe('update', () =>
    {
        it('合并 patch 并更新 updatedAt', async () =>
        {
            await store.add(makeTask({ id: 'task-1', status: 'queued' }));
            const before = Date.now();
            await store.update('task-1', { status: 'downloading', downloadedBytes: 500 });
            const task = store.get('task-1');
            expect(task.status).toBe('downloading');
            expect(task.downloadedBytes).toBe(500);
            expect(task.updatedAt).toBeGreaterThanOrEqual(before);
        });

        it('不存在的 id 返回 false', async () =>
        {
            const result = await store.update('not-exist', { status: 'completed' });
            expect(result).toBe(false);
        });

        it('存在的 id 返回 true', async () =>
        {
            await store.add(makeTask({ id: 'task-1' }));
            const result = await store.update('task-1', { status: 'completed' });
            expect(result).toBe(true);
        });
    });

    describe('remove', () =>
    {
        it('删除任务', async () =>
        {
            await store.add(makeTask({ id: 'task-1' }));
            const result = await store.remove('task-1');
            expect(result).toBe(true);
            expect(store.get('task-1')).toBeUndefined();
            expect(store.getAll()).toHaveLength(0);
        });

        it('不存在的 id 返回 false', async () =>
        {
            const result = await store.remove('not-exist');
            expect(result).toBe(false);
        });

        it('删除后持久化到磁盘', async () =>
        {
            await store.add(makeTask({ id: 'task-1' }));
            await store.add(makeTask({ id: 'task-2' }));
            await store.remove('task-1');
            const store2 = new ManifestStore({ manifestPath });
            await store2.load();
            expect(store2.getAll()).toHaveLength(1);
            expect(store2.get('task-1')).toBeUndefined();
            expect(store2.get('task-2')).toBeDefined();
        });
    });

    describe('findByStatus', () =>
    {
        it('返回匹配状态的任务', async () =>
        {
            await store.add(makeTask({ id: 'task-1', status: 'downloading' }));
            await store.add(makeTask({ id: 'task-2', status: 'paused' }));
            await store.add(makeTask({ id: 'task-3', status: 'downloading' }));
            await store.add(makeTask({ id: 'task-4', status: 'completed' }));
            const downloading = store.findByStatus('downloading');
            expect(downloading).toHaveLength(2);
            const ids = downloading.map(t => t.id).sort();
            expect(ids).toEqual(['task-1', 'task-3']);
        });

        it('返回浅拷贝，修改不影响内部状态', async () =>
        {
            await store.add(makeTask({ id: 'task-1', status: 'paused' }));
            const result = store.findByStatus('paused');
            result[0].status = 'completed';
            const internal = store.get('task-1');
            expect(internal.status).toBe('paused');
        });

        it('无匹配时返回空数组', async () =>
        {
            await store.add(makeTask({ id: 'task-1', status: 'queued' }));
            expect(store.findByStatus('completed')).toEqual([]);
        });
    });

    describe('findBySource', () =>
    {
        it('按 source.type 和 source.value 查找', async () =>
        {
            await store.add(makeTask({
                id: 'task-1',
                source: { type: 'url', value: 'https://example.com/a.mp4' }
            }));
            await store.add(makeTask({
                id: 'task-2',
                source: { type: 'magnet', value: 'magnet:?xt=urn:btih:abc' }
            }));
            await store.add(makeTask({
                id: 'task-3',
                source: { type: 'url', value: 'https://example.com/b.mp4' }
            }));
            const matches = store.findBySource('url', 'https://example.com/a.mp4');
            expect(matches).toHaveLength(1);
            expect(matches[0].id).toBe('task-1');
        });

        it('无匹配时返回空数组', async () =>
        {
            await store.add(makeTask({
                id: 'task-1',
                source: { type: 'url', value: 'https://example.com/a.mp4' }
            }));
            expect(store.findBySource('magnet', 'magnet:?xt=urn:btih:abc')).toEqual([]);
        });
    });

    describe('getAll', () =>
    {
        it('返回所有任务的浅拷贝数组', async () =>
        {
            await store.add(makeTask({ id: 'task-1' }));
            await store.add(makeTask({ id: 'task-2' }));
            const all = store.getAll();
            expect(all).toHaveLength(2);
            // 修改返回数组不影响内部状态
            all[0].status = 'completed';
            all.push({ id: 'fake' });
            const fresh = store.getAll();
            expect(fresh).toHaveLength(2);
            expect(fresh[0].status).toBe('queued');
        });
    });

    describe('原子写容错', () =>
    {
        it('save 后 .tmp 文件被清理', async () =>
        {
            await store.add(makeTask({ id: 'task-1' }));
            const tmpPath = `${manifestPath}.tmp`;
            expect(fs.existsSync(tmpPath)).toBe(false);
            expect(fs.existsSync(manifestPath)).toBe(true);
        });

        it('save 过程中 rename 失败时不损坏原文件', async () =>
        {
            // 先写入一个合法的旧清单
            await store.add(makeTask({ id: 'task-1', status: 'paused' }));
            const originalContent = fs.readFileSync(manifestPath, 'utf8');

            // 拦截 rename 使其抛错，模拟原子写最后一步失败
            const renameSpy = jest.spyOn(fs.promises, 'rename')
                .mockRejectedValueOnce(new Error('rename failed'));

            // 第二次 add 会触发 save → rename 失败
            await expect(store.add(makeTask({ id: 'task-2' })))
                .rejects.toThrow('rename failed');

            // 原文件内容应保持不变
            const afterContent = fs.readFileSync(manifestPath, 'utf8');
            expect(afterContent).toBe(originalContent);

            // .tmp 文件应被清理
            const tmpPath = `${manifestPath}.tmp`;
            expect(fs.existsSync(tmpPath)).toBe(false);

            renameSpy.mockRestore();
        });

        it('构造函数未提供 manifestPath 时抛错', () =>
        {
            expect(() => new ManifestStore({})).toThrow('manifestPath is required');
            expect(() => new ManifestStore()).toThrow('manifestPath is required');
        });
    });
});
