// @ts-nocheck
const fs = require('fs');
const path = require('path');
const os = require('os');
const HttpTransport = require('../../main/modules/streaming/transports/HttpTransport');

/**
 * 临时目录, 用于写入器测试
 */
let tmpDir;

/**
 * 递归清理临时目录
 */
function cleanupTmpDir()
{
    if (!fs.existsSync(tmpDir))
    {
        return;
    }
    const files = fs.readdirSync(tmpDir);
    for (const f of files)
    {
        try
        {
            fs.unlinkSync(path.join(tmpDir, f));
        }
        catch (e)
        {
            // 文件可能已被 abort 删除, 忽略
        }
    }
    fs.rmdirSync(tmpDir);
}

describe('HttpTransport - createSegmentWriter', () =>
{
    beforeAll(() =>
    {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-writer-'));
    });

    afterAll(() =>
    {
        cleanupTmpDir();
    });

    it('新建写入 — 验证数据正确, bytesWritten 累加', async () =>
    {
        const savePath = path.join(tmpDir, 'new-file.bin');
        const transport = new HttpTransport();
        const writer = await transport.createSegmentWriter({ savePath });
        expect(writer.savePath).toBe(savePath);
        expect(writer.append).toBe(false);
        expect(writer.bytesWritten).toBe(0);

        await writer.write(Buffer.from('hello'));
        expect(writer.bytesWritten).toBe(5);
        await writer.write(Buffer.from(' world'));
        expect(writer.bytesWritten).toBe(11);
        await writer.end();

        const content = fs.readFileSync(savePath);
        expect(content.toString()).toBe('hello world');
    });

    it('append 模式 — 追加到现有文件末尾', async () =>
    {
        const savePath = path.join(tmpDir, 'append-file.bin');
        fs.writeFileSync(savePath, 'existing-');

        const transport = new HttpTransport();
        const writer = await transport.createSegmentWriter({
            savePath,
            append: true
        });
        expect(writer.append).toBe(true);
        expect(writer.bytesWritten).toBe(0);

        await writer.write(Buffer.from('more'));
        expect(writer.bytesWritten).toBe(4);
        await writer.end();

        const content = fs.readFileSync(savePath);
        expect(content.toString()).toBe('existing-more');
    });

    it('abort 删除文件 — 验证文件被清理', async () =>
    {
        const savePath = path.join(tmpDir, 'abort-file.bin');
        const transport = new HttpTransport();
        const writer = await transport.createSegmentWriter({ savePath });
        await writer.write(Buffer.from('partial-data'));
        expect(fs.existsSync(savePath)).toBe(true);

        await writer.abort();
        expect(fs.existsSync(savePath)).toBe(false);
    });

    it('目录不存在 — 抛 Error', async () =>
    {
        const savePath = path.join(tmpDir, 'nonexistent-dir', 'file.bin');
        const transport = new HttpTransport();
        await expect(transport.createSegmentWriter({ savePath }))
            .rejects.toThrow();
    });

    it('连续 write 后 end 正常关闭', async () =>
    {
        const savePath = path.join(tmpDir, 'multi-write.bin');
        const transport = new HttpTransport();
        const writer = await transport.createSegmentWriter({ savePath });

        for (let i = 0; i < 10; i++)
        {
            await writer.write(Buffer.from([i]));
        }
        expect(writer.bytesWritten).toBe(10);
        await writer.end();

        const content = fs.readFileSync(savePath);
        expect(content.length).toBe(10);
        expect(content[0]).toBe(0);
        expect(content[9]).toBe(9);
    });

    it('append 模式 bytesWritten 只计本次写入', async () =>
    {
        const savePath = path.join(tmpDir, 'append-count.bin');
        fs.writeFileSync(savePath, Buffer.alloc(50, 0));

        const transport = new HttpTransport();
        const writer = await transport.createSegmentWriter({
            savePath,
            append: true
        });
        await writer.write(Buffer.alloc(30, 1));
        expect(writer.bytesWritten).toBe(30);
        await writer.end();

        const content = fs.readFileSync(savePath);
        expect(content.length).toBe(80);
        // 前 50 字节为 0, 后 30 字节为 1
        expect(content[49]).toBe(0);
        expect(content[50]).toBe(1);
        expect(content[79]).toBe(1);
    });
});
