// HTTP 模块
const http = require('http');
// HTTPS 模块
const https = require('https');
// 路径模块
const path = require('path');

// 父类接口
const ITransport = require('./ITransport');
// 分段写入器
const SegmentWriter = require('./SegmentWriter');

// 最大重定向次数
const MAX_REDIRECTS = 5;

/**
 * HTTP/HTTPS 传输层实现
 * 支持 Range 请求、重定向跟随、HEAD 探测回退
 * 继承自 ITransport, 实现 probe/createSegmentReader/createSegmentWriter/cancel
 */
class HttpTransport extends ITransport
{
    /**
     * 构造 HTTP 传输层
     * @param {Object} [source] - 源描述对象 { type:'url', value:'https://...' }
     */
    constructor(source)
    {
        super();
        this._source = source || null;
        // segmentId → { req, reader } 活动分段映射
        this._segments = new Map();
    }

    /**
     * 探测源信息
     * 先 HEAD 请求, 若 405 则回退到 Range GET (bytes=0-0)
     * 跟随重定向 (最多 5 次), 解析 Content-Length/Content-Range/Accept-Ranges/Content-Type/Content-Disposition
     * @param {Object} [source] - 源描述对象, 未传则使用构造时的 source
     * @returns {Promise<Object>} 探测结果 { size, acceptRanges, contentType, fileName }
     */
    async probe(source)
    {
        const src = source || this._source;
        if (!src || !src.value)
        {
            throw this._makeError('invalid-url', 'no source provided');
        }
        this._source = src;
        const parsedUrl = this._parseUrl(src.value);

        // HEAD 探测, 跟随重定向
        let result = await this._request(parsedUrl, 'HEAD', { headers: {} });
        let res = result.res;
        let finalUrl = result.finalUrl;

        // HEAD 不被接受, 回退到 Range GET
        if (res.statusCode === 405)
        {
            res.resume();
            result = await this._request(finalUrl, 'GET', {
                headers: { Range: 'bytes=0-0' }
            });
            res = result.res;
        }

        // 416 Range Not Satisfiable 归 invalid-url
        if (res.statusCode === 416)
        {
            res.resume();
            throw this._makeError('invalid-url', 'HTTP 416 Range Not Satisfiable');
        }
        // 4xx/5xx 归 server
        if (res.statusCode >= 400)
        {
            res.resume();
            throw this._makeError('server', `HTTP ${res.statusCode}`);
        }

        // 解析响应头
        let size;
        let acceptRanges;
        if (res.statusCode === 206)
        {
            // Range GET 响应, 从 Content-Range 解析总大小: bytes 0-0/12345
            const cr = res.headers['content-range'] || '';
            const m = /bytes\s+\d+-\d+\/(\d+)/i.exec(cr);
            const totalParsed = m ? parseInt(m[1], 10) : 0;
            size = Number.isNaN(totalParsed) ? 0 : totalParsed;
            acceptRanges = true;
        }
        else
        {
            // HEAD 响应, Content-Length 即总大小
            const cl = res.headers['content-length'];
            const clParsed = cl ? parseInt(cl, 10) : 0;
            size = Number.isNaN(clParsed) ? 0 : clParsed;
            acceptRanges = res.headers['accept-ranges'] === 'bytes';
        }

        const contentType = res.headers['content-type'] || 'application/octet-stream';
        const fileName = this._extractFileName(
            res.headers['content-disposition'], finalUrl
        );

        res.resume();

        return {
            size,
            acceptRanges,
            contentType,
            fileName
        };
    }

    /**
     * 创建分段读取器
     * 发起 Range GET 请求, 封装响应流为 SegmentReader
     * @param {Object} opts - { id, start, end, priority?, onProgress? }
     * @returns {Promise<Object>} SegmentReader 实例
     * 注意：调用方必须通过 stream.on('data', ...) 消费数据以触发 onProgress 回调。
     * 使用 stream.read() / stream.pipe() / for await...of / 'readable' 事件等消费模式
     * 不会触发进度回调（bytesLoaded 也不会更新）。
     */
    createSegmentReader(opts)
    {
        const { id, start, end, onProgress } = opts;
        const src = this._source;
        if (!src || !src.value)
        {
            return Promise.reject(this._makeError('invalid-url', 'no source bound'));
        }
        const parsedUrl = this._parseUrl(src.value);

        return new Promise((resolve, reject) =>
        {
            const lib = parsedUrl.protocol === 'https:' ? https : http;
            const req = lib.request({
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.pathname + (parsedUrl.search || ''),
                method: 'GET',
                headers: {
                    Range: `bytes=${start}-${end}`
                }
            }, (res) =>
            {
                if (res.statusCode !== 206 && res.statusCode !== 200)
                {
                    res.resume();
                    this._segments.delete(id);
                    reject(this._classifyStatusError(res.statusCode));
                    return;
                }

                const reader = {
                    id,
                    start,
                    end,
                    stream: res,
                    bytesTotal: end - start + 1,
                    bytesLoaded: 0,
                    abort: () =>
                    {
                        req.destroy();
                    }
                };

                // 延迟挂载 data 监听器, 直到调用方挂载自己的 data 监听器
                // 防止小响应在调用方准备好之前流尽导致 'end' 事件丢失
                let internalAttached = false;
                const attachInternal = () =>
                {
                    if (internalAttached)
                    {
                        return;
                    }
                    internalAttached = true;
                    // 移除 newListener 监听器, 避免后续每次 addListener 触发空检查
                    res.removeListener('newListener', onNewListener);
                    res.prependListener('data', (chunk) =>
                    {
                        reader.bytesLoaded += chunk.length;
                        if (typeof onProgress === 'function')
                        {
                            try
                            {
                                onProgress(reader.bytesLoaded, reader.bytesTotal);
                            }
                            catch (e)
                            {
                                // 回调异常不影响数据流
                            }
                        }
                    });
                };

                const onNewListener = (event) =>
                {
                    if (event === 'data')
                    {
                        attachInternal();
                    }
                };
                res.on('newListener', onNewListener);

                res.on('end', () =>
                {
                    this._segments.delete(id);
                });

                res.on('error', () =>
                {
                    this._segments.delete(id);
                });

                // 更新映射, 包含 reader 引用
                this._segments.set(id, { req, reader });
                resolve(reader);
            });

            req.on('error', (err) =>
            {
                this._segments.delete(id);
                reject(this._classifyError(err));
            });

            // 立即注册, 以便 cancel 在请求建立阶段也能生效
            this._segments.set(id, { req });

            req.end();
        });
    }

    /**
     * 创建分段写入器
     * 委托给 SegmentWriter 类, 等待文件打开后返回
     * @param {Object} opts - { savePath, append? }
     * @returns {Promise<Object>} SegmentWriter 实例
     */
    async createSegmentWriter(opts)
    {
        const writer = new SegmentWriter(opts);
        await writer.ready;
        return writer;
    }

    /**
     * 取消指定分段
     * 中止进行中的读取请求, 未知 segmentId 静默忽略
     * @param {string} segmentId - 分段唯一标识
     * @returns {void}
     */
    cancel(segmentId)
    {
        const seg = this._segments.get(segmentId);
        if (!seg)
        {
            return;
        }
        if (seg.req)
        {
            try
            {
                seg.req.destroy();
            }
            catch (e)
            {
                // 忽略销毁异常
            }
        }
        this._segments.delete(segmentId);
    }

    /**
     * 发起 HTTP/HTTPS 请求并跟随重定向
     * @param {URL} parsedUrl - 已解析的 URL 对象
     * @param {string} method - HTTP 方法 (HEAD/GET)
     * @param {Object} options - { headers }
     * @param {number} [redirectCount=0] - 已重定向次数
     * @returns {Promise<{res: import('http').IncomingMessage, finalUrl: URL}>}
     */
    _request(parsedUrl, method, options, redirectCount = 0)
    {
        if (redirectCount > MAX_REDIRECTS)
        {
            return Promise.reject(
                this._makeError('network', 'too many redirects')
            );
        }
        const lib = parsedUrl.protocol === 'https:' ? https : http;
        return new Promise((resolve, reject) =>
        {
            let req;
            try
            {
                req = lib.request({
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                    path: parsedUrl.pathname + (parsedUrl.search || ''),
                    method,
                    headers: options.headers || {}
                }, (res) =>
                {
                    // 3xx 重定向: 跟随 Location
                    if (res.statusCode >= 300 && res.statusCode < 400
                        && res.headers.location)
                    {
                        let newUrl;
                        try
                        {
                            newUrl = new URL(res.headers.location, parsedUrl);
                        }
                        catch (e)
                        {
                            res.resume();
                            reject(this._makeError(
                                'invalid-url',
                                `bad redirect location: ${res.headers.location}`
                            ));
                            return;
                        }
                        res.resume();
                        this._request(newUrl, method, options, redirectCount + 1)
                            .then(resolve, reject);
                        return;
                    }
                    resolve({ res, finalUrl: parsedUrl });
                });
            }
            catch (err)
            {
                reject(this._classifyError(err));
                return;
            }
            req.on('error', (err) =>
            {
                reject(this._classifyError(err));
            });
            req.end();
        });
    }

    /**
     * 解析并验证 URL
     * @param {string} urlStr - URL 字符串
     * @returns {URL} 解析后的 URL 对象
     * @throws {Error} 无效 URL 或非 http/https 协议时抛出 (errorType='invalid-url')
     */
    _parseUrl(urlStr)
    {
        if (!urlStr || typeof urlStr !== 'string')
        {
            throw this._makeError('invalid-url', 'url is empty or not a string');
        }
        let parsed;
        try
        {
            parsed = new URL(urlStr);
        }
        catch (e)
        {
            throw this._makeError('invalid-url', `invalid url: ${urlStr}`);
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        {
            throw this._makeError(
                'invalid-url',
                `unsupported protocol: ${parsed.protocol}`
            );
        }
        return parsed;
    }

    /**
     * 从 Content-Disposition 头或 URL 路径推断文件名
     * @param {string|undefined} contentDisposition - Content-Disposition 头
     * @param {URL} parsedUrl - 已解析的 URL 对象
     * @returns {string} 文件名
     */
    _extractFileName(contentDisposition, parsedUrl)
    {
        if (contentDisposition)
        {
            const m = /filename="?([^";]+)"?/i.exec(contentDisposition);
            if (m)
            {
                return m[1];
            }
        }
        const base = path.basename(parsedUrl.pathname);
        if (base)
        {
            try
            {
                return decodeURIComponent(base);
            }
            catch (e)
            {
                return base;
            }
        }
        return 'unknown';
    }

    /**
     * 分类 HTTP 状态码错误
     * 416 归 invalid-url, 其他 4xx/5xx 归 server
     * @param {number} statusCode - HTTP 状态码
     * @returns {Error} 带 errorType 的错误对象
     */
    _classifyStatusError(statusCode)
    {
        if (statusCode === 416)
        {
            return this._makeError(
                'invalid-url',
                'HTTP 416 Range Not Satisfiable'
            );
        }
        return this._makeError('server', `HTTP ${statusCode}`);
    }

    /**
     * 分类网络请求错误
     * 请求阶段错误 (连接失败/超时/断开) 统一归为 network
     * @param {Error} err - 原始错误
     * @returns {Error} 带 errorType 的错误对象
     */
    _classifyError(err)
    {
        const code = err && err.code;
        const message = (err && err.message) || String(err);
        return this._makeError('network', message, code);
    }

    /**
     * 构造带 errorType 的错误对象
     * @param {string} errorType - 错误类型 (invalid-url/network/server)
     * @param {string} message - 错误消息
     * @param {string} [code] - 错误代码
     * @returns {Error} 错误实例, 带 errorType 属性
     */
    _makeError(errorType, message, code)
    {
        const err = new Error(message);
        err.errorType = errorType;
        if (code)
        {
            err.code = code;
        }
        return err;
    }
}

module.exports = HttpTransport;
