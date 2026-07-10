// streaming HTTP 服务器与事件转发
// 提供 /stream/<taskId> 路由（支持 Range + CORS）与 StreamEngine/RetryController 事件转发
// 从 ipcGateway.js 拆分以控制单文件行数 ≤500

// Electron BrowserWindow 模块（用于事件转发到渲染窗口）
const { BrowserWindow } = require('electron');
// Node 内置 HTTP 服务器
const http = require('http');

/**
 * 转发事件到所有未销毁的渲染窗口
 * @param {string} eventName - 事件名（streaming:progress 等）
 * @param {*} payload - 事件载荷
 */
function forwardEvent(eventName, payload)
{
    for (const win of BrowserWindow.getAllWindows())
    {
        if (!win.isDestroyed())
        {
            win.webContents.send(eventName, payload);
        }
    }
}

/**
 * 发送错误响应（headers 已发送时销毁连接）
 * @param {http.ServerResponse} res - 响应对象
 * {string} [errCode] - ENOENT 等；非 ENOENT 一律返回 500
 * @param {string} [message] - 自定义消息
 */
function sendErrorResponse(res, errCode, message)
{
    if (res.headersSent)
    {
        res.destroy();
        return;
    }
    const isNotFound = errCode === 'ENOENT';
    const status = isNotFound ? 404 : 500;
    const body = message || (isNotFound ? 'File Not Found' : 'Internal Server Error');
    res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.end(body);
}

/**
 * 处理 /stream/<taskId> HTTP 请求
 * 支持 GET/HEAD/OPTIONS，Range 请求返回 206 Partial Content
 * 文件不存在通过流 'error' 事件返回 404
 * @param {http.IncomingMessage} req - 请求对象
 * @param {http.ServerResponse} res - 响应对象
 * @param {Object} streamEngine - StreamEngine 实例
 */
function handleStreamRequest(req, res, streamEngine)
{
    // 仅允许 GET/HEAD/OPTIONS
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS')
    {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
    }

    // 解析 URL: /stream/<taskId>
    const urlObj = new URL(req.url, 'http://127.0.0.1');
    const match = urlObj.pathname.match(/^\/stream\/(.+)$/);
    if (!match)
    {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
    }
    const taskId = decodeURIComponent(match[1]);

    // CORS 头（video 标签跨域加载需要）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers',
        'Content-Range, Content-Length, Accept-Ranges');

    // OPTIONS 预检
    if (req.method === 'OPTIONS')
    {
        res.writeHead(204);
        res.end();
        return;
    }

    // 解析 Range 头：bytes=<start>-<end?>
    const range = req.headers.range;
    let start = 0;
    let end;
    if (range)
    {
        const m = /bytes=(\d+)-(\d*)/.exec(range);
        if (m)
        {
            start = parseInt(m[1], 10);
            end = m[2] ? parseInt(m[2], 10) : undefined;
        }
    }

    // 获取任务清单（用于文件大小与 contentType）
    const task = streamEngine.manifestStore.get(taskId);
    if (!task)
    {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Task Not Found');
        return;
    }

    // 计算 Content-Range / Content-Length
    const fileSize = task.size;
    const reqEnd = (end !== undefined && end < fileSize - 1) ? end : fileSize - 1;
    const contentLength = Math.max(0, reqEnd - start + 1);

    res.setHeader('Content-Length', contentLength);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', task.contentType || 'application/octet-stream');
    if (range)
    {
        res.setHeader('Content-Range', `bytes ${start}-${reqEnd}/${fileSize}`);
        res.writeHead(206);
    }
    else
    {
        res.writeHead(200);
    }

    // HEAD 请求只返回头不返回体
    if (req.method === 'HEAD')
    {
        res.end();
        return;
    }

    // 创建读取流并 pipe 到响应
    // 文件不存在的错误通过 stream 'error' 事件传递（StreamEngine.createReadStream 设计）
    try
    {
        const stream = streamEngine.createReadStream(taskId, { start, end: reqEnd });
        stream.on('error', (err) => sendErrorResponse(res, err.code, err.message));
        stream.pipe(res);
    }
    catch (err)
    {
        // createReadStream 同步抛错（task 不存在等），构造错误响应
        sendErrorResponse(res, err.code, err.message);
    }
}

/**
 * 创建本地 HTTP 服务器监听 /stream/<taskId> 路由
 * @param {Object} streamEngine - StreamEngine 实例
 * @param {number} streamPort - 监听端口（0=随机）
 * @param {Function} [onReady] - 启动成功回调 (port) => void
 * @returns {http.Server}
 */
function createStreamServer(streamEngine, streamPort, onReady)
{
    const server = http.createServer((req, res) =>
    {
        handleStreamRequest(req, res, streamEngine);
    });
    server.on('error', (err) =>
    {
        console.error('[streamServer] HTTP server error:', err);
    });
    server.listen(streamPort, '127.0.0.1', () =>
    {
        const port = server.address().port;
        // 暴露实际端口给 StreamEngine 用于构造 playUrl
        streamEngine.streamPort = port;
        if (onReady)
        {
            onReady(port);
        }
    });
    return server;
}

/**
 * 挂接 StreamEngine 与 RetryController 事件转发
 * StreamEngine 的 7 个事件直接转发；RetryController 的 fatal/exhausted 转为 streaming:error
 * @param {Object} streamEngine - StreamEngine 实例
 * @param {Object} retryController - RetryController 实例
 */
function attachEventForwarders(streamEngine, retryController)
{
    streamEngine.on('progress', (p) => forwardEvent('streaming:progress', p));
    streamEngine.on('state-change', (p) => forwardEvent('streaming:state-change', p));
    streamEngine.on('prebuffer', (p) => forwardEvent('streaming:prebuffer', p));
    streamEngine.on('integrity', (p) => forwardEvent('streaming:integrity', p));
    streamEngine.on('error', (p) => forwardEvent('streaming:error', p));
    streamEngine.on('queue-changed', (p) => forwardEvent('streaming:queue-changed', p));
    streamEngine.on('completed', (p) => forwardEvent('streaming:completed', p));

    // RetryController 事件转发
    retryController.on('retry', (p) => forwardEvent('streaming:retry', p));
    retryController.on('fatal', (p) =>
    {
        forwardEvent('streaming:error', {
            taskId: p.taskId,
            errorType: (p.error && p.error.errorType) || 'unknown',
            message: (p.error && p.error.message) || 'fatal error',
            recoverable: false,
            actions: []
        });
    });
    retryController.on('exhausted', (p) =>
    {
        forwardEvent('streaming:error', {
            taskId: p.taskId,
            errorType: (p.error && p.error.errorType) || 'network',
            message: (p.error && p.error.message) || 'retries exhausted',
            recoverable: false,
            actions: ['manual-retry']
        });
    });
}

module.exports = {
    forwardEvent,
    createStreamServer,
    attachEventForwarders
};
