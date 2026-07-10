// @ts-nocheck
const MagnetResolveCache = require('../../main/modules/streaming/MagnetResolveCache');

describe('MagnetResolveCache', () =>
{
    /**
     * 构造一组测试用文件列表
     * @param {string} [prefix] - 文件名前缀
     * @returns {Array<Object>} 文件数组
     */
    const makeFiles = prefix =>
    {
        return [
            { path: `${prefix || 'a'}.mp4`, length: 100 },
            { path: `${prefix || 'b'}.mp4`, length: 200 }
        ];
    };

    describe('默认配置', () =>
    {
        it('默认 ttlMs 为 24 小时, maxEntries 为 100', () =>
        {
            const cache = new MagnetResolveCache();
            expect(cache.ttlMs).toBe(24 * 60 * 60 * 1000);
            expect(cache.maxEntries).toBe(100);
        });

        it('未传 opts 时不报错', () =>
        {
            const cache = new MagnetResolveCache();
            expect(cache.size()).toBe(0);
        });
    });

    describe('get', () =>
    {
        it('未命中返回 null', () =>
        {
            const cache = new MagnetResolveCache();
            expect(cache.get('not-exist')).toBeNull();
        });

        it('set + get 命中返回缓存内容', () =>
        {
            const cache = new MagnetResolveCache();
            const files = makeFiles('a');
            cache.set('hash1', files, 300);
            const result = cache.get('hash1');
            expect(result).not.toBeNull();
            expect(result.files).toEqual(files);
            expect(result.totalSize).toBe(300);
            expect(typeof result.cachedAt).toBe('number');
            expect(result.cachedAt).toBeGreaterThan(0);
        });

        it('返回深拷贝, 修改不影响内部状态', () =>
        {
            const cache = new MagnetResolveCache();
            const files = [{ path: 'a.mp4', length: 100 }];
            cache.set('hash1', files, 100);
            const result = cache.get('hash1');
            // 修改顶层与嵌套字段
            result.totalSize = 999;
            result.files[0].path = 'modified.mp4';
            result.files[0].length = 999;
            result.files.push({ path: 'added.mp4', length: 999 });
            const fresh = cache.get('hash1');
            expect(fresh.totalSize).toBe(100);
            expect(fresh.files[0].path).toBe('a.mp4');
            expect(fresh.files[0].length).toBe(100);
            expect(fresh.files).toHaveLength(1);
        });

        it('TTL 过期后返回 null', () =>
        {
            jest.useFakeTimers();
            try
            {
                const cache = new MagnetResolveCache({ ttlMs: 1000 });
                cache.set('hash1', makeFiles('a'), 300);
                jest.advanceTimersByTime(1001);
                expect(cache.get('hash1')).toBeNull();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('TTL 未过期时仍可命中', () =>
        {
            jest.useFakeTimers();
            try
            {
                const cache = new MagnetResolveCache({ ttlMs: 1000 });
                cache.set('hash1', makeFiles('a'), 300);
                jest.advanceTimersByTime(999);
                const result = cache.get('hash1');
                expect(result).not.toBeNull();
                expect(result.totalSize).toBe(300);
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('TTL 过期条目被 get 自动删除', () =>
        {
            jest.useFakeTimers();
            try
            {
                const cache = new MagnetResolveCache({ ttlMs: 1000 });
                cache.set('hash1', makeFiles('a'), 300);
                expect(cache.size()).toBe(1);
                jest.advanceTimersByTime(1001);
                // get 触发过期清理
                cache.get('hash1');
                expect(cache.size()).toBe(0);
                expect(cache.has('hash1')).toBe(false);
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('命中时刷新访问顺序到末尾', () =>
        {
            const cache = new MagnetResolveCache({ maxEntries: 3 });
            cache.set('hash1', makeFiles('a'), 100);
            cache.set('hash2', makeFiles('b'), 100);
            cache.set('hash3', makeFiles('c'), 100);
            // 访问 hash1, 应刷新到末尾
            cache.get('hash1');
            // 加入 hash4 触发淘汰, 最久未访问的应为 hash2
            cache.set('hash4', makeFiles('d'), 100);
            expect(cache.has('hash1')).toBe(true);
            expect(cache.has('hash2')).toBe(false);
            expect(cache.has('hash3')).toBe(true);
            expect(cache.has('hash4')).toBe(true);
        });
    });

    describe('set', () =>
    {
        it('记录 cachedAt 为当前时间', () =>
        {
            const before = Date.now();
            const cache = new MagnetResolveCache();
            cache.set('hash1', makeFiles('a'), 100);
            const after = Date.now();
            const result = cache.get('hash1');
            expect(result.cachedAt).toBeGreaterThanOrEqual(before);
            expect(result.cachedAt).toBeLessThanOrEqual(after);
        });

        it('已存在的 infoHash 先删除再插入, 刷新访问顺序', () =>
        {
            const cache = new MagnetResolveCache({ maxEntries: 3 });
            cache.set('hash1', makeFiles('a'), 100);
            cache.set('hash2', makeFiles('b'), 100);
            cache.set('hash3', makeFiles('c'), 100);
            // 重新 set hash1 刷新顺序到末尾
            cache.set('hash1', [{ path: 'updated.mp4', length: 999 }], 999);
            // 加入 hash4 触发淘汰, 最久未访问的应为 hash2
            cache.set('hash4', makeFiles('d'), 100);
            expect(cache.has('hash1')).toBe(true);
            expect(cache.has('hash2')).toBe(false);
            expect(cache.has('hash3')).toBe(true);
            expect(cache.has('hash4')).toBe(true);
            // hash1 应为更新后的内容
            const result = cache.get('hash1');
            expect(result.files[0].path).toBe('updated.mp4');
            expect(result.totalSize).toBe(999);
        });

        it('LRU 淘汰: 超出 maxEntries 时淘汰最久未访问的', () =>
        {
            const cache = new MagnetResolveCache({ maxEntries: 3 });
            cache.set('hash1', makeFiles('a'), 100);
            cache.set('hash2', makeFiles('b'), 100);
            cache.set('hash3', makeFiles('c'), 100);
            // 加入 hash4 触发淘汰, hash1 (最久未访问) 应被淘汰
            cache.set('hash4', makeFiles('d'), 100);
            expect(cache.has('hash1')).toBe(false);
            expect(cache.has('hash2')).toBe(true);
            expect(cache.has('hash3')).toBe(true);
            expect(cache.has('hash4')).toBe(true);
            expect(cache.size()).toBe(3);
        });

        it('更新已存在条目不增加 size', () =>
        {
            const cache = new MagnetResolveCache({ maxEntries: 3 });
            cache.set('hash1', makeFiles('a'), 100);
            cache.set('hash2', makeFiles('b'), 100);
            cache.set('hash1', [{ path: 'updated.mp4', length: 999 }], 999);
            expect(cache.size()).toBe(2);
        });
    });

    describe('has', () =>
    {
        it('存在的条目返回 true', () =>
        {
            const cache = new MagnetResolveCache();
            cache.set('hash1', makeFiles('a'), 100);
            expect(cache.has('hash1')).toBe(true);
        });

        it('不存在的条目返回 false', () =>
        {
            const cache = new MagnetResolveCache();
            expect(cache.has('not-exist')).toBe(false);
        });

        it('不刷新访问顺序', () =>
        {
            const cache = new MagnetResolveCache({ maxEntries: 3 });
            cache.set('hash1', makeFiles('a'), 100);
            cache.set('hash2', makeFiles('b'), 100);
            cache.set('hash3', makeFiles('c'), 100);
            // has 调用不应刷新顺序
            expect(cache.has('hash1')).toBe(true);
            // 加入 hash4 触发淘汰, hash1 仍应被淘汰
            cache.set('hash4', makeFiles('d'), 100);
            expect(cache.has('hash1')).toBe(false);
            expect(cache.has('hash2')).toBe(true);
            expect(cache.has('hash3')).toBe(true);
            expect(cache.has('hash4')).toBe(true);
        });
    });

    describe('delete', () =>
    {
        it('删除指定条目并返回 true', () =>
        {
            const cache = new MagnetResolveCache();
            cache.set('hash1', makeFiles('a'), 100);
            expect(cache.delete('hash1')).toBe(true);
            expect(cache.has('hash1')).toBe(false);
            expect(cache.get('hash1')).toBeNull();
            expect(cache.size()).toBe(0);
        });

        it('不存在的条目返回 false', () =>
        {
            const cache = new MagnetResolveCache();
            expect(cache.delete('not-exist')).toBe(false);
        });

        it('删除后再次 set 可重新缓存', () =>
        {
            const cache = new MagnetResolveCache();
            cache.set('hash1', makeFiles('a'), 100);
            cache.delete('hash1');
            cache.set('hash1', makeFiles('b'), 200);
            const result = cache.get('hash1');
            expect(result).not.toBeNull();
            expect(result.totalSize).toBe(200);
        });
    });

    describe('clear', () =>
    {
        it('清空所有缓存', () =>
        {
            const cache = new MagnetResolveCache();
            cache.set('hash1', makeFiles('a'), 100);
            cache.set('hash2', makeFiles('b'), 200);
            cache.set('hash3', makeFiles('c'), 300);
            cache.clear();
            expect(cache.size()).toBe(0);
            expect(cache.has('hash1')).toBe(false);
            expect(cache.has('hash2')).toBe(false);
            expect(cache.has('hash3')).toBe(false);
            expect(cache.get('hash1')).toBeNull();
        });

        it('清空后可继续使用', () =>
        {
            const cache = new MagnetResolveCache();
            cache.set('hash1', makeFiles('a'), 100);
            cache.clear();
            cache.set('hash2', makeFiles('b'), 200);
            expect(cache.size()).toBe(1);
            expect(cache.has('hash2')).toBe(true);
        });
    });

    describe('size', () =>
    {
        it('返回当前条目数', () =>
        {
            const cache = new MagnetResolveCache();
            expect(cache.size()).toBe(0);
            cache.set('hash1', makeFiles('a'), 100);
            expect(cache.size()).toBe(1);
            cache.set('hash2', makeFiles('b'), 200);
            expect(cache.size()).toBe(2);
            cache.delete('hash1');
            expect(cache.size()).toBe(1);
        });

        it('不区分是否过期', () =>
        {
            jest.useFakeTimers();
            try
            {
                const cache = new MagnetResolveCache({ ttlMs: 1000 });
                cache.set('hash1', makeFiles('a'), 100);
                jest.advanceTimersByTime(1001);
                // 过期但未被 get 触发删除前, size 仍为 1
                expect(cache.size()).toBe(1);
            }
            finally
            {
                jest.useRealTimers();
            }
        });
    });
});
