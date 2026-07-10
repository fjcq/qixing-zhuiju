// @ts-nocheck
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const HttpTransport = require('../../main/modules/streaming/transports/HttpTransport');

/**
 * 测试用 HTTP 服务器句柄
 */
let server;
/**
 * 服务器基础 URL, 如 http://127.0.0.1:34567
 */
let baseUrl;
/**
 * 临时目录, 用于 abort/cancel 测试产生的文件
 */
let tmpDir;

/**
 * 启动测试 HTTP 服务器, 根据路径返回不同响应
 * @returns {Promise<{server: http.Server, baseUrl: string}>}
 */
function startTestServer()
{
    return new Promise((resolve) =>
    {
        const srv = http.createServer((req, res) =>
        {
            const url = req.url;

            // HEAD 成功: 完整 Content-Length + Accept-Ranges + Content-Disposition
            if (url === '/head-ok')
            {
                if (req.method === 'HEAD')
                {
                    res.writeHead(200, {
                        'Content-Length': '12345',
                        'Accept-Ranges': 'bytes',
                        'Content-Type': 'video/mp4',
                        'Content-Disposition': 'attachment; filename="test.mp4"'
                    });
                    res.end();
                    return;
                }
                res.writeHead(200, {
                    'Content-Length': '12345',
                    'Accept-Ranges': 'bytes',
                    'Content-Type': 'video/mp4'
                });
                res.end(Buffer.alloc(100, 65));
                return;
            }

            // HEAD 405: 强制 fallback 到 Range GET, 用 Content-Range 返回总大小
            if (url === '/head-405')
            {
                if (req.method === 'HEAD')
                {
                    res.writeHead(405, { 'Allow': 'GET' });
                    res.end();
                    return;
                }
                if (req.headers.range)
                {
                    res.writeHead(206, {
                        'Content-Range': 'bytes 0-0/98765',
                        'Content-Length': '1',
                        'Content-Type': 'video/mp4',
                        'Accept-Ranges': 'bytes'
                    });
                    res.end('x');
                    return;
                }
                res.writeHead(200, {
                    'Content-Length': '98765',
                    'Accept-Ranges': 'bytes',
                    'Content-Type': 'video/mp4'
                });
                res.end(Buffer.alloc(100, 65));
                return;
            }

            // 301 重定向到 /head-ok
            if (url === '/redirect-301')
            {
                res.writeHead(301, { 'Location': '/head-ok' });
                res.end();
                return;
            }

            // 多级重定向: a -> b -> head-ok
            if (url === '/redirect-a')
            {
                res.writeHead(302, { 'Location': '/redirect-b' });
                res.end();
                return;
            }
            if (url === '/redirect-b')
            {
                res.writeHead(302, { 'Location': '/head-ok' });
                res.end();
                return;
            }

            // 1000 字节文件, 支持 Range 读取
            if (url === '/file-1000')
            {
                const total = 1000;
                const range = req.headers.range;
                if (range)
                {
                    const m = /bytes=(\d+)-(\d+)/.exec(range);
                    if (m)
                    {
                        const start = parseInt(m[1], 10);
                        const end = parseInt(m[2], 10);
                        const len = end - start + 1;
                        res.writeHead(206, {
                            'Content-Range': `bytes ${start}-${end}/${total}`,
                            'Content-Length': len.toString(),
                            'Accept-Ranges': 'bytes',
                            'Content-Type': 'application/octet-stream'
                        });
                        res.end(Buffer.alloc(len, 65));
                        return;
                    }
                }
                res.writeHead(200, {
                    'Content-Length': total.toString(),
                    'Accept-Ranges': 'bytes',
                    'Content-Type': 'application/octet-stream'
                });
                res.end(Buffer.alloc(total, 65));
                return;
            }

            // 大文件, 慢速流式发送, 用于 abort/cancel 测试
            if (url === '/large-slow')
            {
                const total = 1000000;
                const range = req.headers.range;
                let start = 0;
                let end = total - 1;
                if (range)
                {
                    const m = /bytes=(\d+)-(\d+)/.exec(range);
                    if (m)
                    {
                        start = parseInt(m[1], 10);
                        end = parseInt(m[2], 10);
                    }
                }
                const len = end - start + 1;
                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${total}`,
                    'Content-Length': len.toString(),
                    'Accept-Ranges': 'bytes',
                    'Content-Type': 'application/octet-stream'
                });
                let written = 0;
                const writeChunk = () =>
                {
                    if (req.destroyed || res.destroyed)
                    {
                        return;
                    }
                    if (written >= len)
                    {
                        try
                        {
                            res.end();
                        }
                        catch (e)
                        {
                            // 客户端已断开
                        }
                        return;
                    }
                    const chunkSize = Math.min(1024, len - written);
                    try
                    {
                        res.write(Buffer.alloc(chunkSize, 65));
                        written += chunkSize;
                        setTimeout(writeChunk, 20);
                    }
                    catch (e)
                    {
                        // 客户端已断开, 停止写入
                    }
                };
                writeChunk();
                return;
            }

            // 500 服务器错误
            if (url === '/server-error')
            {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('server error');
                return;
            }

            // 默认 404
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('not found');
        });
        srv.listen(0, '127.0.0.1', () =>
        {
            const { port } = srv.address();
            resolve({ server: srv, baseUrl: `http://127.0.0.1:${port}` });
        });
    });
}

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
        fs.unlinkSync(path.join(tmpDir, f));
    }
    fs.rmdirSync(tmpDir);
}

/**
 * 等待流终止 (error 或 close 事件), 带超时兜底
 * @param {import('stream').Readable} stream - 待监听的流
 * @param {number} [timeoutMs=2000] - 超时毫秒数
 * @returns {Promise<boolean>} 是否收到终止事件
 */
function waitForStreamTermination(stream, timeoutMs = 2000)
{
    return new Promise((resolve) =>
    {
        let done = false;
        const finish = (result) =>
        {
            if (!done)
            {
                done = true;
                resolve(result);
            }
        };
        stream.once('error', () => finish(true));
        stream.once('close', () => finish(true));
        setTimeout(() => finish(false), timeoutMs);
    });
}

describe('HttpTransport', () =>
{
    beforeAll(async () =>
    {
        const info = await startTestServer();
        server = info.server;
        baseUrl = info.baseUrl;
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'http-transport-'));
    });

    afterAll(async () =>
    {
        await new Promise((resolve) =>
        {
            server.closeAllConnections();
            server.close(resolve);
        });
        cleanupTmpDir();
    });

    describe('probe', () =>
    {
        it('HEAD 成功 — 返回正确 size/contentType/fileName/acceptRanges', async () =>
        {
            const transport = new HttpTransport();
            const result = await transport.probe({
                type: 'url',
                value: `${baseUrl}/head-ok`
            });
            expect(result.size).toBe(12345);
            expect(result.acceptRanges).toBe(true);
            expect(result.contentType).toBe('video/mp4');
            expect(result.fileName).toBe('test.mp4');
        });

        it('HEAD 405 → fallback Range GET — 从 Content-Range 解析 size', async () =>
        {
            const transport = new HttpTransport();
            const result = await transport.probe({
                type: 'url',
                value: `${baseUrl}/head-405`
            });
            expect(result.size).toBe(98765);
            expect(result.acceptRanges).toBe(true);
            expect(result.contentType).toBe('video/mp4');
        });

        it('跟随 301 重定向到最终 URL', async () =>
        {
            const transport = new HttpTransport();
            const result = await transport.probe({
                type: 'url',
                value: `${baseUrl}/redirect-301`
            });
            expect(result.size).toBe(12345);
            expect(result.contentType).toBe('video/mp4');
        });

        it('跟随多级重定向 (a→b→head-ok)', async () =>
        {
            const transport = new HttpTransport();
            const result = await transport.probe({
                type: 'url',
                value: `${baseUrl}/redirect-a`
            });
            expect(result.size).toBe(12345);
        });

        it('非法 URL — 抛 invalid-url 错误', async () =>
        {
            const transport = new HttpTransport();
            await expect(transport.probe({
                type: 'url',
                value: 'not-a-valid-url'
            })).rejects.toMatchObject({ errorType: 'invalid-url' });
        });

        it('非 http/https 协议 — 抛 invalid-url', async () =>
        {
            const transport = new HttpTransport();
            await expect(transport.probe({
                type: 'url',
                value: 'ftp://example.com/file'
            })).rejects.toMatchObject({ errorType: 'invalid-url' });
        });

        it('网络错误 (连接不存在端口) — 抛 network', async () =>
        {
            const transport = new HttpTransport();
            await expect(transport.probe({
                type: 'url',
                value: 'http://127.0.0.1:1/nonexistent'
            })).rejects.toMatchObject({ errorType: 'network' });
        });

        it('500 服务器错误 — 抛 server 错误', async () =>
        {
            const transport = new HttpTransport();
            await expect(transport.probe({
                type: 'url',
                value: `${baseUrl}/server-error`
            })).rejects.toMatchObject({ errorType: 'server' });
        });
    });

    describe('createSegmentReader', () =>
    {
        it('正常 Range 读取 — 验证 bytesTotal/onProgress/stream 数据', async () =>
        {
            const transport = new HttpTransport({
                type: 'url',
                value: `${baseUrl}/file-1000`
            });
            const progressCalls = [];
            const reader = await transport.createSegmentReader({
                id: 'seg-1',
                start: 0,
                end: 99,
                onProgress: (loaded, total) =>
                {
                    progressCalls.push({ loaded, total });
                }
            });
            expect(reader.id).toBe('seg-1');
            expect(reader.start).toBe(0);
            expect(reader.end).toBe(99);
            expect(reader.bytesTotal).toBe(100);
            expect(reader.bytesLoaded).toBe(0);

            const chunks = [];
            reader.stream.on('data', (chunk) => chunks.push(chunk));
            await new Promise((resolve) => reader.stream.on('end', resolve));

            const buf = Buffer.concat(chunks);
            expect(buf.length).toBe(100);
            expect(reader.bytesLoaded).toBe(100);
            expect(progressCalls.length).toBeGreaterThan(0);
            const last = progressCalls[progressCalls.length - 1];
            expect(last.loaded).toBe(100);
            expect(last.total).toBe(100);
        });

        it('Range 中段读取 — start>0', async () =>
        {
            const transport = new HttpTransport({
                type: 'url',
                value: `${baseUrl}/file-1000`
            });
            const reader = await transport.createSegmentReader({
                id: 'seg-2',
                start: 100,
                end: 199
            });
            expect(reader.bytesTotal).toBe(100);
            const chunks = [];
            reader.stream.on('data', (c) => chunks.push(c));
            await new Promise((resolve) => reader.stream.on('end', resolve));
            expect(Buffer.concat(chunks).length).toBe(100);
            expect(reader.bytesLoaded).toBe(100);
        });

        it('abort 中止 — stream 触发 error 或 close', async () =>
        {
            const transport = new HttpTransport({
                type: 'url',
                value: `${baseUrl}/large-slow`
            });
            const reader = await transport.createSegmentReader({
                id: 'seg-abort',
                start: 0,
                end: 999999
            });

            const terminationPromise = waitForStreamTermination(reader.stream);

            // 等待第一个 data 事件 (newListener 延迟挂载机制要求显式订阅 'data')
            await new Promise((resolve) =>
            {
                reader.stream.once('data', resolve);
            });
            expect(reader.bytesLoaded).toBeGreaterThan(0);

            reader.abort();
            const terminated = await terminationPromise;
            expect(terminated).toBe(true);
        });
    });

    describe('cancel', () =>
    {
        it('取消进行中的 reader', async () =>
        {
            const transport = new HttpTransport({
                type: 'url',
                value: `${baseUrl}/large-slow`
            });
            const reader = await transport.createSegmentReader({
                id: 'seg-cancel',
                start: 0,
                end: 999999
            });

            const terminationPromise = waitForStreamTermination(reader.stream);

            // 等待第一个 data 事件 (newListener 延迟挂载机制要求显式订阅 'data')
            await new Promise((resolve) =>
            {
                reader.stream.once('data', resolve);
            });

            transport.cancel('seg-cancel');
            const terminated = await terminationPromise;
            expect(terminated).toBe(true);
        });

        it('未知 segmentId 静默忽略', () =>
        {
            const transport = new HttpTransport();
            expect(() => transport.cancel('unknown-id')).not.toThrow();
        });
    });
});
