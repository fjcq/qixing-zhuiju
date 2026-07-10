// 流模块（Transform 基类）
const { Transform } = require('stream');

/**
 * 令牌桶限速 Transform 流
 * 按指定字节/秒速率输出数据, 供 magnetHandler.mjs 通过 createRequire 加载使用
 * MagnetTransport 内部不强制使用（实际限速在 magnetHandler 内部做更高效）
 * magnetHandler.mjs 是 ESM, 可通过 createRequire 加载本 CommonJS 模块
 */
class ThrottleTransform extends Transform
{
    /**
     * 构造限速流
     * @param {Object} [opts] - Transform 选项 + { bytesPerSec }
     * @param {number} [opts.bytesPerSec=0] - 每秒字节数, ≤0 表示不限速
     */
    constructor(opts)
    {
        super(opts);
        const bytesPerSec = (opts && opts.bytesPerSec) || 0;
        if (bytesPerSec <= 0)
        {
            // 不限速: 透传模式
            this._bytesPerSec = 0;
            this._bucket = Infinity;
            this._maxBucket = Infinity;
            this._lastRefillTime = 0;
            return;
        }
        this._bytesPerSec = bytesPerSec;
        // 桶容量 = 1 秒流量, 允许小幅突发
        this._maxBucket = bytesPerSec;
        this._bucket = bytesPerSec;
        this._lastRefillTime = Date.now();
    }

    /**
     * _transform 实现: 按令牌桶可用量分片 push, 剩余部分 setTimeout 延迟
     * @param {Buffer} chunk - 数据块
     * @param {string} encoding - 编码
     * @param {Function} callback - 完成回调
     */
    _transform(chunk, encoding, callback)
    {
        if (this._bytesPerSec === 0)
        {
            this.push(chunk);
            callback();
            return;
        }
        this._processChunk(chunk, callback);
    }

    /**
     * 递归处理 chunk: 补充令牌 → 输出可发送部分 → 剩余部分延迟重试
     * @param {Buffer} remaining - 待处理数据
     * @param {Function} done - 整个 chunk 处理完成回调
     */
    _processChunk(remaining, done)
    {
        if (remaining.length === 0)
        {
            done();
            return;
        }
        // 按时间间隔补充令牌
        const now = Date.now();
        const elapsed = now - this._lastRefillTime;
        if (elapsed > 0)
        {
            const refill = (elapsed / 1000) * this._bytesPerSec;
            this._bucket = Math.min(this._maxBucket, this._bucket + refill);
            this._lastRefillTime = now;
        }
        if (this._bucket <= 0)
        {
            // 桶空: 等 100ms 后重试
            setTimeout(() => this._processChunk(remaining, done), 100);
            return;
        }
        // 输出可发送的部分
        const sendBytes = Math.min(remaining.length, Math.floor(this._bucket));
        const out = remaining.subarray(0, sendBytes);
        this.push(out);
        this._bucket -= sendBytes;
        const rest = remaining.subarray(sendBytes);
        if (rest.length === 0)
        {
            done();
            return;
        }
        // 剩余部分按当前速率延迟
        const delayMs = Math.ceil((rest.length / this._bytesPerSec) * 1000);
        setTimeout(() => this._processChunk(rest, done), delayMs);
    }
}

module.exports = ThrottleTransform;
