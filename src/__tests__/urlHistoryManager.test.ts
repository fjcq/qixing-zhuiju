/**
 * urlHistoryManager 单元测试
 * 包装 storage.js 的 getPlayHistory / addPlayHistory / removePlayHistory
 * 增强功能：从 vod_id 前缀和 type_name 字段推断类型
 *
 * 策略：mock storage.js 模块，避免依赖 localStorage（Jest node 环境无 DOM）
 */

const urlHistoryManager = require('../renderer/js/controllers/urlHistoryManager');

const _store: { data: any[] } = { data: [] };

jest.mock('../renderer/js/storage', () => {
    return {
        StorageService: class MockStorage {
            getPlayHistory() {
                return [..._store.data];
            }
            addPlayHistory(item: any) {
                _store.data = _store.data.filter((x: any) => x.vod_id !== item.vod_id);
                _store.data.unshift({ ...item, watch_time: item.watch_time || Date.now() });
            }
            removePlayHistory(vodId: string) {
                _store.data = _store.data.filter((x: any) => x.vod_id !== vodId);
            }
        }
    };
});

describe('urlHistoryManager', () => {
    let manager: any;

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
                vod_id: 'magnet:?xt=urn:btih:abc123def456abc123def456abc123def45678ab',
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
            const origAdd = manager._storage.addPlayHistory;
            manager._storage.addPlayHistory = () => { throw new Error('quota exceeded'); };
            manager.addItem({ vod_id: 'https://x.com', vod_name: 'x' });
            expect(manager.getList()).toEqual([]);
            manager._storage.addPlayHistory = origAdd;
        });
    });
});
