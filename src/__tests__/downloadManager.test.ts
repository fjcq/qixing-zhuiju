// @ts-nocheck
// DownloadManager 单元测试
// 通过劫持 Module._load 拦截 'electron' 模块
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

// 拦截 require('electron') 返回 mock
const origLoad = Module._load;
Module._load = function(request, parent) {
    if (request === 'electron') {
        return {
            app: { getPath: () => os.tmpdir() },
            BrowserWindow: { getAllWindows: () => [] }
        };
    }
    return origLoad.apply(this, arguments);
};

const DownloadManager = require('../main/modules/DownloadManager');

describe('DownloadManager', () => {
    const TEST_DIR = path.join(os.tmpdir(), 'qixing-download-test');
    let dm;
    const sampleFile = path.join(TEST_DIR, 'sample.mp4');
    const sampleFile2 = path.join(TEST_DIR, 'sample2.mkv');    beforeAll(() => {
        if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
        fs.writeFileSync(sampleFile, 'fake-video-content-1');
        fs.writeFileSync(sampleFile2, 'fake-video-content-2');
        const mp = path.join(TEST_DIR, 'manifest.json');
        if (fs.existsSync(mp)) fs.unlinkSync(mp);
    });

    beforeEach(() => {
        // 清理遗留文件
        ['rn-old.mp4', 'rn-new.mp4', 'bad_name__.mp4', 'm.mp4', 'del.mp4', 'old.mp4', 'new.mp4', 'gone.mp4', 'a-small.mp4', 'b-big.mkv', 'sample.mp4', 'sample2.mkv', 'movie-2024.mp4', 'old-video.mkv']
            .forEach(n => {
                const p = path.join(TEST_DIR, n);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            });
        // 清理 magnet 子目录（防止上一个测试的磁力文件残留影响下一个测试）
        const magnetDir = path.join(TEST_DIR, 'magnet');
        if (fs.existsSync(magnetDir)) fs.rmSync(magnetDir, { recursive: true, force: true });
        const subDir = path.join(TEST_DIR, 'subdir');
        if (fs.existsSync(subDir)) fs.rmSync(subDir, { recursive: true, force: true });
        // 重置 sampleFile 存在
        fs.writeFileSync(sampleFile, 'fake-video-content-1');
        fs.writeFileSync(sampleFile2, 'fake-video-content-2');
        // 清理 manifest
        const mp = path.join(TEST_DIR, 'manifest.json');
        if (fs.existsSync(mp)) fs.unlinkSync(mp);
        dm = new DownloadManager();
        dm.downloadDir = TEST_DIR;
        dm.manifestPath = mp;
        dm.initialize();
        // initialize() 内部会调 _reconcileWithDisk 扫描磁盘，遗留的测试文件会被加进 manifest
        // 每个测试用例从干净状态开始 —— 这是修复前的行为契约，测试不感知 reconcile 行为
        dm.manifest = [];
    });

    afterAll(() => {
        try { fs.unlinkSync(sampleFile); } catch (e) { /* ignore */ }
        try { fs.unlinkSync(sampleFile2); } catch (e) { /* ignore */ }
        try {
            const mp = path.join(TEST_DIR, 'manifest.json');
            if (fs.existsSync(mp)) fs.unlinkSync(mp);
        } catch (e) { /* ignore */ }
    });

    test('初始化后目录存在且 manifest 是数组', () => {
        expect(fs.existsSync(TEST_DIR)).toBe(true);
        expect(Array.isArray(dm.manifest)).toBe(true);
    });

    test('addExistingFile 添加一个文件', () => {
        const r = dm.addExistingFile({
            name: 'sample.mp4',
            filePath: sampleFile,
            sourceType: 'url',
            sourceUrl: 'http://example.com/sample.mp4'
        });
        expect(r.success).toBe(true);
        expect(r.record.id).toBeTruthy();
        expect(r.record.size).toBeGreaterThan(0);
        expect(r.record.ext).toBe('mp4');
        expect(r.record.sourceType).toBe('url');
    });

    test('addExistingFile 文件不存在时返回失败', () => {
        const r = dm.addExistingFile({
            name: 'missing.mp4',
            filePath: 'Z:/no/such/file.mp4'
        });
        expect(r.success).toBe(false);
    });

    test('listFiles 按名称排序', () => {
        dm.addExistingFile({ name: 'sample2.mkv', filePath: sampleFile2, sourceType: 'import' });
        dm.addExistingFile({ name: 'sample.mp4', filePath: sampleFile, sourceType: 'url' });
        const list = dm.listFiles({ sortBy: 'name', sortDir: 'asc' });
        expect(list.length).toBe(2);
    });

    test('listFiles 按大小排序（降序）', () => {
        fs.writeFileSync(sampleFile, 'x'.repeat(100));
        fs.writeFileSync(sampleFile2, 'x'.repeat(500));
        dm.manifest = [];
        dm.addExistingFile({ name: 'a-small.mp4', filePath: sampleFile });
        dm.addExistingFile({ name: 'b-big.mkv', filePath: sampleFile2 });
        const list = dm.listFiles({ sortBy: 'size', sortDir: 'desc' });
        expect(list[0].name).toBe('b-big.mkv');
    });

    test('listFiles 名称搜索', () => {
        dm.manifest = [];
        dm.addExistingFile({ name: 'movie-2024.mp4', filePath: sampleFile });
        dm.addExistingFile({ name: 'old-video.mkv', filePath: sampleFile2 });
        const list = dm.listFiles({ search: 'movie' });
        expect(list.length).toBe(1);
        expect(list[0].name).toContain('movie');
    });

    test('listFiles 来源筛选', () => {
        dm.manifest = [];
        dm.addExistingFile({ name: 'a.mp4', filePath: sampleFile, sourceType: 'url' });
        dm.addExistingFile({ name: 'b.mkv', filePath: sampleFile2, sourceType: 'magnet' });
        const urlOnly = dm.listFiles({ sourceType: 'url' });
        expect(urlOnly.length).toBe(1);
        expect(urlOnly[0].sourceType).toBe('url');
    });

    test('renameFile 正常重命名', () => {
        const r1 = dm.addExistingFile({ name: 'old.mp4', filePath: sampleFile });
        const renamed = dm.renameFile(r1.record.id, 'new.mp4');
        expect(renamed.success).toBe(true);
        expect(renamed.record.name).toBe('new.mp4');
        expect(fs.existsSync(sampleFile)).toBe(false);
        expect(fs.existsSync(path.join(TEST_DIR, 'new.mp4'))).toBe(true);
    });

    test('renameFile 文件名含非法字符被清洗', () => {
        const r1 = dm.addExistingFile({ name: 'old.mp4', filePath: sampleFile });
        const renamed = dm.renameFile(r1.record.id, 'bad:name<>.mp4');
        expect(renamed.success).toBe(true);
        expect(renamed.record.name).not.toContain(':');
        expect(renamed.record.name).not.toContain('<');
    });

    test('renameFile id 不存在返回失败', () => {
        const r = dm.renameFile('non-existent', 'new.mp4');
        expect(r.success).toBe(false);
    });

    test('moveFile 移动到子目录', () => {
        const r1 = dm.addExistingFile({ name: 'mv.mp4', filePath: sampleFile });
        const moved = dm.moveFile(r1.record.id, 'subdir');
        expect(moved.success).toBe(true);
        expect(moved.record.folder).toBe('subdir');
        const subDir = path.join(TEST_DIR, 'subdir');
        expect(fs.existsSync(subDir)).toBe(true);
        expect(fs.existsSync(path.join(subDir, 'mv.mp4'))).toBe(true);
    });

    test('deleteFile 删除文件', () => {
        const r1 = dm.addExistingFile({ name: 'del.mp4', filePath: sampleFile });
        const deleted = dm.deleteFile(r1.record.id);
        expect(deleted.success).toBe(true);
        expect(fs.existsSync(sampleFile)).toBe(false);
        expect(dm.manifest.length).toBe(0);
    });

    test('deleteFile id 不存在返回失败', () => {
        const r = dm.deleteFile('no-such');
        expect(r.success).toBe(false);
    });

    test('listFolders 列出子目录', () => {
        fs.mkdirSync(path.join(TEST_DIR, 'f1'), { recursive: true });
        fs.mkdirSync(path.join(TEST_DIR, 'f2'), { recursive: true });
        const folders = dm.listFolders();
        expect(folders).toContain('f1');
        expect(folders).toContain('f2');
    });

    test('_pruneMissing 清理不存在的记录', () => {
        dm.addExistingFile({ name: 'gone.mp4', filePath: path.join(TEST_DIR, 'gone.mp4') });
        dm._pruneMissing();
        expect(dm.manifest.find(m => m.name === 'gone.mp4')).toBeUndefined();
    });

    // ========== 磁盘对账相关测试（_reconcileWithDisk / _scanDownloadDir）==========
    // 关键场景：磁力下载中文件尚未写入磁盘，app 重启后必须保留记录（否则就是用户报的"打开下载页是空的"）

    test('磁盘对账：磁力 downloading 状态即使文件不存在也保留', () => {
        // 模拟场景：上次会话里开始下载了一个磁力，文件还没写入磁盘
        const magnetFilePath = path.join(TEST_DIR, 'magnet', 'abcdef1234567890abcdef1234567890abcdef12', 'not-yet-downloaded.mp4');
        dm.manifest.push({
            id: 'm1',
            name: 'not-yet-downloaded.mp4',
            path: magnetFilePath,
            size: 0,
            totalSize: 1024 * 1024,
            mtime: Date.now(),
            sourceType: 'magnet',
            sourceUrl: 'magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12',
            infoHash: 'abcdef1234567890abcdef1234567890abcdef12',
            status: 'downloading',
            ext: 'mp4',
            folder: 'magnet'
        });
        // 确保磁力文件确实不存在
        if (fs.existsSync(magnetFilePath)) fs.unlinkSync(magnetFilePath);
        // 触发对账
        dm._reconcileWithDisk();
        // 关键断言：记录必须保留（启动时归位为 paused，但记录不能丢）
        const kept = dm.manifest.find(m => m.id === 'm1');
        expect(kept).toBeDefined();
        // 启动时归位：downloading → paused（避免 UI 假下载状态）
        expect(kept.status).toBe('paused');
    });

    test('磁盘对账：磁力 paused 状态即使文件不存在也保留', () => {
        const magnetFilePath = path.join(TEST_DIR, 'magnet', 'pausedhash00000000000000000000000000000', 'paused.mp4');
        dm.manifest.push({
            id: 'm2',
            name: 'paused.mp4',
            path: magnetFilePath,
            size: 0,
            totalSize: 2048,
            mtime: Date.now(),
            sourceType: 'magnet',
            infoHash: 'pausedhash00000000000000000000000000000',
            status: 'paused',
            ext: 'mp4',
            folder: 'magnet'
        });
        if (fs.existsSync(magnetFilePath)) fs.unlinkSync(magnetFilePath);
        dm._reconcileWithDisk();
        expect(dm.manifest.find(m => m.id === 'm2')).toBeDefined();
    });

    test('磁盘对账：磁盘上有文件但 manifest 没有 → 补登记', () => {
        // 模拟：磁盘上有 magnet 文件，但 manifest 丢失了这条记录
        const infoHash = 'restored0000000000000000000000000000';
        const filePath = path.join(TEST_DIR, 'magnet', infoHash, 'restored.mp4');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, 'restored-content');
        // 确保 manifest 中没有这条
        dm.manifest = dm.manifest.filter(m => m.path !== filePath);
        // 对账
        dm._reconcileWithDisk();
        const restored = dm.manifest.find(m => m.path === filePath);
        expect(restored).toBeDefined();
        expect(restored.sourceType).toBe('magnet');
        expect(restored.infoHash).toBe(infoHash);
        expect(restored.status).toBe('completed');
    });

    test('磁盘对账：磁盘上有普通文件但 manifest 没有 → 补登记为 import', () => {
        // 模拟：用户手动把一个文件复制到下载目录（绕过我们的下载流程）
        const orphanPath = path.join(TEST_DIR, 'imported-orphan.mp4');
        fs.writeFileSync(orphanPath, 'orphan-content');
        dm.manifest = dm.manifest.filter(m => m.path !== orphanPath);
        dm._reconcileWithDisk();
        const restored = dm.manifest.find(m => m.path === orphanPath);
        expect(restored).toBeDefined();
        expect(restored.sourceType).toBe('import');
        expect(restored.name).toBe('imported-orphan.mp4');
    });

    test('磁盘对账：URL/import 记录磁盘文件不存在 → 删除', () => {
        dm.addExistingFile({ name: 'gone-import.mp4', filePath: path.join(TEST_DIR, 'gone-import.mp4') });
        // 不创建磁盘文件
        dm._reconcileWithDisk();
        expect(dm.manifest.find(m => m.name === 'gone-import.mp4')).toBeUndefined();
    });

    test('磁盘对账：扫描时排除 manifest.json 自身', () => {
        // 启动对账，验证 manifest.json 没被当成 import 加进 manifest
        const beforeCount = dm.manifest.length;
        dm._reconcileWithDisk();
        const manifestSelf = dm.manifest.find(m => m.path === dm.manifestPath);
        expect(manifestSelf).toBeUndefined();
    });

    // ========== 启动时归位 in-progress 状态为 paused ==========
    // 关键场景：上次会话的 downloading 记录，app 重启时子进程并未启动，
    // 若保留 downloading 状态会出现"假下载"：UI 显示下载中但点击暂停无效。
    // 启动时必须归位为 paused（用户可手动继续恢复）。

    test('启动时归位：磁力 downloading 状态 → paused', () => {
        const magnetFilePath = path.join(TEST_DIR, 'magnet', 'demotedhash00000000000000000000000000', 'demoted.mp4');
        dm.manifest.push({
            id: 'm-demote',
            name: 'demoted.mp4',
            path: magnetFilePath,
            size: 0,
            totalSize: 1024,
            mtime: Date.now(),
            sourceType: 'magnet',
            infoHash: 'demotedhash00000000000000000000000000',
            status: 'downloading',
            ext: 'mp4',
            folder: 'magnet'
        });
        dm._reconcileWithDisk();
        const item = dm.manifest.find(m => m.id === 'm-demote');
        expect(item).toBeDefined();
        expect(item.status).toBe('paused');
    });

    test('启动时归位：磁力 error 状态 → paused', () => {
        dm.manifest.push({
            id: 'm-err',
            name: 'errored.mp4',
            path: path.join(TEST_DIR, 'magnet', 'errhash00000000000000000000000000000', 'errored.mp4'),
            size: 0,
            totalSize: 1024,
            mtime: Date.now(),
            sourceType: 'magnet',
            infoHash: 'errhash00000000000000000000000000000',
            status: 'error',
            ext: 'mp4',
            folder: 'magnet'
        });
        dm._reconcileWithDisk();
        const item = dm.manifest.find(m => m.id === 'm-err');
        expect(item).toBeDefined();
        expect(item.status).toBe('paused');
    });

    test('启动时归位：磁力 paused 状态保持 paused（不应改成其他）', () => {
        dm.manifest.push({
            id: 'm-paused',
            name: 'paused-keep.mp4',
            path: path.join(TEST_DIR, 'magnet', 'pausedhash00000000000000000000000000000', 'paused-keep.mp4'),
            size: 0,
            totalSize: 1024,
            mtime: Date.now(),
            sourceType: 'magnet',
            infoHash: 'pausedhash00000000000000000000000000000',
            status: 'paused',
            ext: 'mp4',
            folder: 'magnet'
        });
        dm._reconcileWithDisk();
        const item = dm.manifest.find(m => m.id === 'm-paused');
        expect(item.status).toBe('paused');
    });

    test('启动时归位：磁力 completed 状态不被归位', () => {
        // 模拟已完成的磁力：磁盘上有文件
        const infoHash = 'completed0000000000000000000000000000';
        const filePath = path.join(TEST_DIR, 'magnet', infoHash, 'completed.mp4');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, 'completed-content');
        dm.manifest.push({
            id: 'm-done',
            name: 'completed.mp4',
            path: filePath,
            size: 100,
            totalSize: 100,
            mtime: Date.now(),
            sourceType: 'magnet',
            infoHash,
            status: 'completed',
            ext: 'mp4',
            folder: 'magnet'
        });
        dm._reconcileWithDisk();
        const item = dm.manifest.find(m => m.id === 'm-done');
        expect(item.status).toBe('completed');
    });

    test('启动时归位：归位同时清空旧实时指标（speed/peers/eta）', () => {
        dm.manifest.push({
            id: 'm-stale',
            name: 'stale.mp4',
            path: path.join(TEST_DIR, 'magnet', 'stale000000000000000000000000000000', 'stale.mp4'),
            size: 1024,
            totalSize: 10000,
            mtime: Date.now(),
            sourceType: 'magnet',
            infoHash: 'stale000000000000000000000000000000',
            status: 'downloading',
            ext: 'mp4',
            folder: 'magnet',
            // 上次会话遗留的实时指标
            downloadSpeed: 1024000,
            numPeers: 5,
            wires: 10,
            eta: 30000
        });
        dm._reconcileWithDisk();
        const item = dm.manifest.find(m => m.id === 'm-stale');
        expect(item.downloadSpeed).toBe(0);
        expect(item.numPeers).toBe(0);
        expect(item.wires).toBe(0);
        expect(item.eta).toBeNull();
    });

    // ========== addMagnetFile 的 magnetUri 回填行为 ==========
    // 关键场景：子进程首次上报时主进程没有 magnetUri 也能创建记录，
    // 但后续 addMagnetFile 再次被调用时（带 magnetUri）必须能回填 sourceUrl

    test('addMagnetFile 首次创建记录，sourceUrl 与传入 magnetUri 一致', () => {
        const r = dm.addMagnetFile({
            name: 'fresh.mp4',
            filePath: path.join(TEST_DIR, 'magnet', 'fresh00000000000000000000000000000', 'fresh.mp4'),
            infoHash: 'fresh00000000000000000000000000000',
            magnetUri: 'magnet:?xt=urn:btih:fresh00000000000000000000000000000&dn=fresh&tr=udp%3A%2F%2Ftracker.example.com',
            totalSize: 1024,
            downloaded: 0,
            status: 'downloading'
        });
        expect(r.success).toBe(true);
        expect(r.record.sourceUrl).toContain('magnet:?xt=urn:btih:fresh00000000000000000000000000000');
    });

    test('addMagnetFile 增量更新：旧记录 sourceUrl 为空时回填 magnetUri', () => {
        // 模拟历史 bug：旧记录 sourceUrl 为空
        dm.manifest.push({
            id: 'm-legacy',
            name: 'legacy.mp4',
            path: path.join(TEST_DIR, 'magnet', 'legacy00000000000000000000000000000', 'legacy.mp4'),
            size: 100,
            totalSize: 1000,
            mtime: Date.now(),
            sourceType: 'magnet',
            sourceUrl: '', // 旧记录没有 magnetUri
            infoHash: 'legacy00000000000000000000000000000',
            status: 'paused',
            ext: 'mp4',
            folder: 'magnet'
        });
        // 后续 addMagnetFile 带回 magnetUri → 必须回填
        dm.addMagnetFile({
            name: 'legacy.mp4',
            infoHash: 'legacy00000000000000000000000000000',
            magnetUri: 'magnet:?xt=urn:btih:legacy00000000000000000000000000000&dn=legacy'
        });
        const item = dm.manifest.find(m => m.id === 'm-legacy');
        expect(item.sourceUrl).toBe('magnet:?xt=urn:btih:legacy00000000000000000000000000000&dn=legacy');
    });

    test('addMagnetFile 增量更新：已有 sourceUrl 时不被覆盖', () => {
        dm.manifest.push({
            id: 'm-exist',
            name: 'exist.mp4',
            path: path.join(TEST_DIR, 'magnet', 'exist000000000000000000000000000000', 'exist.mp4'),
            size: 100,
            totalSize: 1000,
            mtime: Date.now(),
            sourceType: 'magnet',
            sourceUrl: 'magnet:?xt=urn:btih:original00000000000000000000000000',
            infoHash: 'exist000000000000000000000000000000',
            status: 'paused',
            ext: 'mp4',
            folder: 'magnet'
        });
        dm.addMagnetFile({
            name: 'exist.mp4',
            infoHash: 'exist000000000000000000000000000000',
            magnetUri: 'magnet:?xt=urn:btih:different000000000000000000000000000'
        });
        const item = dm.manifest.find(m => m.id === 'm-exist');
        // 已被记录的 sourceUrl 不应被覆盖（避免 tracker 列表变更影响历史）
        expect(item.sourceUrl).toBe('magnet:?xt=urn:btih:original00000000000000000000000000');
    });
});
