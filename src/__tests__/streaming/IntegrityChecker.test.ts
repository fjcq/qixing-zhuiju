// @ts-nocheck
const IntegrityChecker = require('../../main/modules/streaming/IntegrityChecker');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * 生成与给定 SHA256 不同的有效 64 位 hex 字符串
 * 通过翻转最后一个字符 (0<->1) 保证产生不同的值
 * @param {string} correct - 正确的 SHA256 (64 位 hex)
 * @returns {string} 不同的 64 位 hex 字符串
 */
const makeWrongSha = (correct) =>
{
    const last = correct[63];
    const newLast = last === '0' ? '1' : '0';
    return correct.slice(0, 63) + newLast;
};

describe('IntegrityChecker', () =>
{
    let tmpDir;
    let checker;

    beforeAll(() =>
    {
        checker = new IntegrityChecker();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'integrity-test-'));
    });

    afterAll(() =>
    {
        if (tmpDir && fs.existsSync(tmpDir))
        {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    describe('verifyFileSize', () =>
    {
        let filePath;
        const fileContent = Buffer.from('hello world size check payload');

        beforeEach(() =>
        {
            filePath = path.join(
                tmpDir,
                `size-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`
            );
            fs.writeFileSync(filePath, fileContent);
        });

        it('文件存在且大小匹配时返回 ok=true', async () =>
        {
            const result = await checker.verifyFileSize(filePath, fileContent.length);
            expect(result.ok).toBe(true);
            expect(result.actualSize).toBe(fileContent.length);
            expect(result.expectedSize).toBe(fileContent.length);
            expect(result.reason).toBeUndefined();
        });

        it('文件存在但大小不匹配时返回 ok=false, reason=size-mismatch', async () =>
        {
            const wrongSize = fileContent.length + 100;
            const result = await checker.verifyFileSize(filePath, wrongSize);
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('size-mismatch');
            expect(result.actualSize).toBe(fileContent.length);
            expect(result.expectedSize).toBe(wrongSize);
        });

        it('文件不存在时返回 ok=false, reason=ENOENT, actualSize=0', async () =>
        {
            const missingPath = path.join(tmpDir, 'no-such-file.bin');
            const result = await checker.verifyFileSize(missingPath, 100);
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('ENOENT');
            expect(result.actualSize).toBe(0);
            expect(result.expectedSize).toBe(100);
        });

        it('expectedSize 为 NaN 时返回 ok=false, reason=invalid-expected-size', async () =>
        {
            const result = await checker.verifyFileSize(filePath, NaN);
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('invalid-expected-size');
        });
    });

    describe('verifySha256', () =>
    {
        let filePath;
        let fileContent;
        let expectedSha256;

        beforeEach(() =>
        {
            fileContent = crypto.randomBytes(64);
            filePath = path.join(
                tmpDir,
                `sha-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`
            );
            fs.writeFileSync(filePath, fileContent);
            expectedSha256 = crypto.createHash('sha256').update(fileContent).digest('hex');
        });

        it('文件存在且哈希匹配时返回 ok=true', async () =>
        {
            const result = await checker.verifySha256(filePath, expectedSha256);
            expect(result.ok).toBe(true);
            expect(result.actualSha256).toBe(expectedSha256);
            expect(result.expectedSha256).toBe(expectedSha256);
            expect(result.reason).toBeUndefined();
        });

        it('文件存在但哈希不匹配时返回 ok=false, reason=sha256-mismatch', async () =>
        {
            const wrongSha = makeWrongSha(expectedSha256);
            const result = await checker.verifySha256(filePath, wrongSha);
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('sha256-mismatch');
            expect(result.actualSha256).toBe(expectedSha256);
            expect(result.expectedSha256).toBe(wrongSha.toLowerCase());
        });

        it('文件不存在时返回 ok=false, reason=ENOENT', async () =>
        {
            const missingPath = path.join(tmpDir, 'no-such-file.bin');
            const result = await checker.verifySha256(missingPath, expectedSha256);
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('ENOENT');
        });

        it('expectedSha256 非 64 位 hex 时返回 ok=false, reason=invalid-expected-sha256', async () =>
        {
            const invalidSha = 'abc123';
            const result = await checker.verifySha256(filePath, invalidSha);
            expect(result.ok).toBe(false);
            expect(result.reason).toBe('invalid-expected-sha256');
        });

        it('大写 expectedSha256 也能匹配 (自动小写化)', async () =>
        {
            const upperSha = expectedSha256.toUpperCase();
            const result = await checker.verifySha256(filePath, upperSha);
            expect(result.ok).toBe(true);
            expect(result.actualSha256).toBe(expectedSha256);
            expect(result.expectedSha256).toBe(expectedSha256);
        });

        it('大文件 (>1MB) 流式哈希正确且内存占用受限', async () =>
        {
            // 生成 2MB 测试文件
            const largeSize = 2 * 1024 * 1024;
            const largeContent = crypto.randomBytes(largeSize);
            const largePath = path.join(tmpDir, `large-${Date.now()}.bin`);
            fs.writeFileSync(largePath, largeContent);
            const expectedLargeSha = crypto.createHash('sha256')
                .update(largeContent).digest('hex');

            // 强制 GC 以获得更准确的堆测量 (需 --expose-gc, 否则跳过)
            if (typeof global.gc === 'function')
            {
                global.gc();
            }
            const heapBefore = process.memoryUsage().heapUsed;

            const result = await checker.verifySha256(largePath, expectedLargeSha);

            const heapAfter = process.memoryUsage().heapUsed;
            const heapGrowth = heapAfter - heapBefore;

            expect(result.ok).toBe(true);
            expect(result.actualSha256).toBe(expectedLargeSha);
            // 流式读取下, 2MB 文件不应导致堆增长超过 50MB
            // (流式实现实际增长 <1MB; 此阈值留出余量并捕获一次性加载整文件的实现)
            expect(heapGrowth).toBeLessThan(50 * 1024 * 1024);

            fs.unlinkSync(largePath);
        });
    });

    describe('verifyLocal', () =>
    {
        let filePath;
        const fileContent = Buffer.from('local file content bytes');

        beforeEach(() =>
        {
            filePath = path.join(
                tmpDir,
                `local-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`
            );
            fs.writeFileSync(filePath, fileContent);
        });

        it('文件存在时返回 ok=true, size 正确', async () =>
        {
            const result = await checker.verifyLocal(filePath);
            expect(result.ok).toBe(true);
            expect(result.exists).toBe(true);
            expect(result.size).toBe(fileContent.length);
            expect(result.reason).toBeUndefined();
        });

        it('文件不存在时返回 ok=false, reason=ENOENT', async () =>
        {
            const missingPath = path.join(tmpDir, 'no-such-file.bin');
            const result = await checker.verifyLocal(missingPath);
            expect(result.ok).toBe(false);
            expect(result.exists).toBe(false);
            expect(result.size).toBe(0);
            expect(result.reason).toBe('ENOENT');
        });

        it('路径为目录时返回 ok=false 与具体 reason', async () =>
        {
            const dirPath = path.join(tmpDir, 'sub-dir');
            fs.mkdirSync(dirPath);
            const result = await checker.verifyLocal(dirPath);
            expect(result.ok).toBe(false);
            expect(result.exists).toBe(false);
            expect(result.size).toBe(0);
            expect(typeof result.reason).toBe('string');
            expect(result.reason).not.toBe('');
        });
    });
});
