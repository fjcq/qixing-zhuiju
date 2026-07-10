// @ts-nocheck
const StorageManager = require('../../main/modules/streaming/scheduler/StorageManager');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('StorageManager', () => {
    let tmpDir;
    let manager;

    beforeEach(() => {
        // 创建临时测试目录，避免污染真实下载目录
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-test-'));
        manager = new StorageManager({ downloadPath: tmpDir });
    });

    afterEach(() => {
        // 递归清理临时目录
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    describe('getStorageInfo', () => {
        it('返回包含 total/free/used/downloadPath 的对象', async () => {
            const info = await manager.getStorageInfo();
            expect(info).toHaveProperty('total');
            expect(info).toHaveProperty('free');
            expect(info).toHaveProperty('used');
            expect(info).toHaveProperty('downloadPath');
            expect(info.downloadPath).toBe(tmpDir);
            expect(typeof info.total).toBe('number');
            expect(typeof info.free).toBe('number');
            expect(typeof info.used).toBe('number');
            // total 应等于 free + used
            expect(info.total).toBe(info.free + info.used);
        });
    });

    describe('checkSpaceAvailable', () => {
        it('剩余空间充足时返回 true', async () => {
            // 1KB 需求，远低于磁盘剩余与 5GB 阈值
            const ok = await manager.checkSpaceAvailable(1024);
            expect(ok).toBe(true);
        });

        it('剩余空间不足时返回 false', async () => {
            // 设置极小阈值便于触发不足场景
            const smallManager = new StorageManager({
                downloadPath: tmpDir,
                minFreeBytes: Number.MAX_SAFE_INTEGER,
            });
            const ok = await smallManager.checkSpaceAvailable(1024);
            expect(ok).toBe(false);
        });

        it('requiredBytes 超过剩余空间时返回 false', async () => {
            // requiredBytes 极大值，直接超过实际剩余空间
            const ok = await manager.checkSpaceAvailable(Number.MAX_SAFE_INTEGER);
            expect(ok).toBe(false);
        });
    });

    describe('generateSavePath', () => {
        it('无冲突时返回原路径', async () => {
            const p = await manager.generateSavePath('movie.mp4');
            expect(p).toBe(path.join(tmpDir, 'movie.mp4'));
        });

        it('同名冲突时返回带 (1) 后缀的路径', async () => {
            fs.writeFileSync(path.join(tmpDir, 'movie.mp4'), '');
            const p = await manager.generateSavePath('movie.mp4');
            expect(p).toBe(path.join(tmpDir, 'movie(1).mp4'));
        });

        it('多次冲突时递增后缀 (1)/(2)/(3)', async () => {
            fs.writeFileSync(path.join(tmpDir, 'movie.mp4'), '');
            fs.writeFileSync(path.join(tmpDir, 'movie(1).mp4'), '');
            const p1 = await manager.generateSavePath('movie.mp4');
            expect(p1).toBe(path.join(tmpDir, 'movie(2).mp4'));
            // 占用 (2) 后再次生成应为 (3)
            fs.writeFileSync(path.join(tmpDir, 'movie(2).mp4'), '');
            const p2 = await manager.generateSavePath('movie.mp4');
            expect(p2).toBe(path.join(tmpDir, 'movie(3).mp4'));
        });

        it('无扩展名文件也能正确处理冲突', async () => {
            fs.writeFileSync(path.join(tmpDir, 'README'), '');
            const p = await manager.generateSavePath('README');
            expect(p).toBe(path.join(tmpDir, 'README(1)'));
        });
    });

    describe('cleanupOldTasks', () => {
        it('删除早于 N 天的文件', async () => {
            const oldFile = path.join(tmpDir, 'old.mp4');
            const newFile = path.join(tmpDir, 'new.mp4');
            fs.writeFileSync(oldFile, 'old');
            fs.writeFileSync(newFile, 'new');
            // 设置 oldFile 修改时间为 40 天前
            const oldTime = Date.now() / 1000 - 40 * 24 * 60 * 60;
            fs.utimesSync(oldFile, oldTime, oldTime);
            const result = await manager.cleanupOldTasks(30);
            expect(result.removed).toBe(1);
            expect(fs.existsSync(oldFile)).toBe(false);
            expect(fs.existsSync(newFile)).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('保留近期文件', async () => {
            const recentFile = path.join(tmpDir, 'recent.mp4');
            fs.writeFileSync(recentFile, 'recent');
            const result = await manager.cleanupOldTasks(30);
            expect(result.removed).toBe(0);
            expect(fs.existsSync(recentFile)).toBe(true);
        });

        it('使用默认 TTL 天数（30 天）', async () => {
            const staleFile = path.join(tmpDir, 'stale.mp4');
            fs.writeFileSync(staleFile, 'stale');
            // 修改时间为 31 天前
            const staleTime = Date.now() / 1000 - 31 * 24 * 60 * 60;
            fs.utimesSync(staleFile, staleTime, staleTime);
            const result = await manager.cleanupOldTasks();
            expect(result.removed).toBe(1);
            expect(fs.existsSync(staleFile)).toBe(false);
        });
    });

    describe('setDownloadPath', () => {
        it('不迁移时仅更新路径', async () => {
            const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-new-'));
            try {
                const result = await manager.setDownloadPath(newDir, false);
                expect(result.migrated).toBe(false);
                expect(result.fileCount).toBe(0);
                expect(manager.getDownloadPath()).toBe(newDir);
            } finally {
                fs.rmSync(newDir, { recursive: true, force: true });
            }
        });

        it('migrate=true 时迁移文件到新路径', async () => {
            const srcFile = path.join(tmpDir, 'movie.mp4');
            fs.writeFileSync(srcFile, 'content');
            const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-migrate-'));
            try {
                const result = await manager.setDownloadPath(newDir, true);
                expect(result.migrated).toBe(true);
                expect(result.fileCount).toBe(1);
                expect(manager.getDownloadPath()).toBe(newDir);
                // 文件已迁移到新路径
                expect(fs.existsSync(path.join(newDir, 'movie.mp4'))).toBe(true);
                // 原文件已被移走
                expect(fs.existsSync(srcFile)).toBe(false);
            } finally {
                fs.rmSync(newDir, { recursive: true, force: true });
            }
        });

        it('迁移多个文件并统计数量', async () => {
            fs.writeFileSync(path.join(tmpDir, 'a.mp4'), 'a');
            fs.writeFileSync(path.join(tmpDir, 'b.mp4'), 'b');
            fs.writeFileSync(path.join(tmpDir, 'c.mp4'), 'c');
            const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-multi-'));
            try {
                const result = await manager.setDownloadPath(newDir, true);
                expect(result.migrated).toBe(true);
                expect(result.fileCount).toBe(3);
                expect(fs.existsSync(path.join(newDir, 'a.mp4'))).toBe(true);
                expect(fs.existsSync(path.join(newDir, 'b.mp4'))).toBe(true);
                expect(fs.existsSync(path.join(newDir, 'c.mp4'))).toBe(true);
            } finally {
                fs.rmSync(newDir, { recursive: true, force: true });
            }
        });
    });

    describe('getDownloadPath', () => {
        it('返回当前下载路径', () => {
            expect(manager.getDownloadPath()).toBe(tmpDir);
        });
    });
});
