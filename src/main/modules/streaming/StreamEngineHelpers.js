// 加密模块（生成唯一 ID）
const crypto = require('crypto');
// 事件模块（EventEmitter 基类）
const EventEmitter = require('events');
// 文件系统模块
const fs = require('fs');

// 默认假设码率（probe 未返回 bitrate 时用于预缓冲估算）：2 Mbps
const DEFAULT_ASSUMED_BITRATE = 2_000_000;
// 速度指数移动平均平滑系数
const SPEED_EMA_ALPHA = 0.3;
// 进度事件节流间隔（毫秒）
const PROGRESS_THROTTLE_MS = 200;
// 限速令牌不足时的轮询间隔（毫秒）
const SPEED_LIMIT_POLL_MS = 10;

/**
 * 构造带 errorType 的错误对象
 * @param {string} errorType - 错误类型
 * @param {string} message - 错误消息
 * @returns {Error} 带 errorType 属性的错误实例
 */
function makeError(errorType, message)
{
    const err = new Error(message);
    err.errorType = errorType;
    return err;
}

/**
 * 生成任务唯一标识
 * @returns {string} 任务 ID
 */
function createTaskId()
{
    return `t_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * 生成分段唯一标识
 * @param {string} taskId - 所属任务 ID
 * @returns {string} 分段 ID
 */
function createSegmentId(taskId)
{
    return `seg_${taskId}_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
}

/**
 * 计算预计剩余时间（秒）
 * @param {number} downloadedBytes - 已下载字节数
 * @param {number} totalBytes - 文件总字节数
 * @param {number} speedBps - 当前下载速度（字节/秒）
 * @returns {number} 剩余秒数，速度未知时返回 -1
 */
function computeEta(downloadedBytes, totalBytes, speedBps)
{
    if (speedBps <= 0)
    {
        return -1;
    }
    const remaining = totalBytes - downloadedBytes;
    if (remaining <= 0)
    {
        return 0;
    }
    return Math.max(0, Math.ceil(remaining / speedBps));
}

/**
 * 计算预缓冲目标字节数
 * @param {number} bitrate - 视频码率（bps）
 * @param {number} seconds - 预缓冲秒数
 * @returns {number} 目标字节数
 */
function computePrebufferBytes(bitrate, seconds)
{
    const br = bitrate || DEFAULT_ASSUMED_BITRATE;
    return Math.floor((br / 8) * seconds);
}

/**
 * 计算已下载字节对应的缓冲秒数
 * @param {number} downloadedBytes - 已下载字节数
 * @param {number} bitrate - 视频码率（bps）
 * @returns {number} 缓冲秒数
 */
function computeBufferedSeconds(downloadedBytes, bitrate)
{
    const br = bitrate || DEFAULT_ASSUMED_BITRATE;
    if (br <= 0)
    {
        return 0;
    }
    return (downloadedBytes * 8) / br;
}

/**
 * 速度指数移动平均平滑
 * @param {number} prevSpeed - 上一次平滑后的速度（字节/秒）
 * @param {number} newSampleBps - 本次采样速度（字节/秒）
 * @returns {number} 平滑后的速度
 */
function smoothSpeed(prevSpeed, newSampleBps)
{
    if (prevSpeed <= 0)
    {
        return newSampleBps;
    }
    return prevSpeed * (1 - SPEED_EMA_ALPHA) + newSampleBps * SPEED_EMA_ALPHA;
}

/**
 * 轮询限速器直到获取令牌或任务停止
 * @param {Object} speedLimiter - SpeedLimiter 实例
 * @param {Function} isRunning - () => boolean，任务是否仍在运行
 * @param {string} taskId - 任务标识
 * @param {number} bytes - 待消费字节数
 * @returns {Promise<boolean>} true 获取成功，false 任务已停止
 */
async function acquireTokens(speedLimiter, isRunning, taskId, bytes)
{
    while (isRunning())
    {
        if (speedLimiter.tryConsume(taskId, bytes))
        {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, SPEED_LIMIT_POLL_MS));
    }
    return false;
}

/**
 * 清理失败分段的残留数据：关闭写入器并截断文件到分段起点
 * @param {Object} writer - SegmentWriter 实例
 * @param {string} savePath - 文件保存路径
 * @param {number} segmentStart - 分段起始字节
 */
async function cleanupPartialSegment(writer, savePath, segmentStart)
{
    try
    {
        if (writer && writer.end)
        {
            await writer.end();
        }
    }
    catch (e)
    {
        // 写入器可能已损坏，忽略 end 错误
    }
    try
    {
        await fs.promises.truncate(savePath, segmentStart);
    }
    catch (e)
    {
        // 文件可能不存在（首段未创建），忽略
    }
}

/**
 * 消费 reader 流并写入 writer，应用限速与背压
 * @param {Object} speedLimiter - SpeedLimiter 实例
 * @param {Function} isRunning - () => boolean，任务是否仍在运行
 * @param {string} taskId - 任务标识
 * @param {Object} reader - SegmentReader 实例
 * @param {Object} writer - SegmentWriter 实例
 * @returns {Promise<{ok: boolean, error?: Error}>}
 */
function pipeSegment(speedLimiter, isRunning, taskId, reader, writer)
{
    return new Promise((resolve) =>
    {
        let settled = false;
        const finish = (ok, err) =>
        {
            if (settled)
            {
                return;
            }
            settled = true;
            reader.stream.removeListener('data', onData);
            reader.stream.removeListener('end', onEnd);
            reader.stream.removeListener('error', onError);
            if (!ok && reader.abort)
            {
                try
                {
                    reader.abort();
                }
                catch (e)
                {
                    // 忽略 abort 异常
                }
            }
            if (!ok)
            {
                // 失败/取消时同时关闭 writer，避免 Promise 悬空导致 writer 永不关闭
                // 选用 end() 而非 abort()：abort() 会删除整个文件，
                // 续传场景下 append 模式写入空文件会导致数据错位
                if (writer && typeof writer.end === 'function')
                {
                    try
                    {
                        // end() 返回 Promise，可能 reject；attach catch 避免未处理拒绝
                        const p = writer.end();
                        if (p && typeof p.catch === 'function')
                        {
                            p.catch(() => {});
                        }
                    }
                    catch (e)
                    {
                        // 忽略 end 错误
                    }
                }
            }
            resolve({ ok, error: err });
        };
        const onData = (chunk) =>
        {
            reader.stream.pause();
            acquireTokens(speedLimiter, isRunning, taskId, chunk.length)
                .then(async (acquired) =>
                {
                    if (!acquired)
                    {
                        finish(false, makeError('aborted', 'task no longer running'));
                        return;
                    }
                    try
                    {
                        await writer.write(chunk);
                        reader.stream.resume();
                    }
                    catch (err)
                    {
                        finish(false, err);
                    }
                })
                .catch(err => finish(false, err));
        };
        const onEnd = async () =>
        {
            try
            {
                await writer.end();
                finish(true);
            }
            catch (err)
            {
                finish(false, err);
            }
        };
        const onError = (err) => finish(false, err);
        reader.stream.on('data', onData);
        reader.stream.on('end', onEnd);
        reader.stream.on('error', onError);
    });
}

/**
 * 进度追踪器
 * 管理每任务的下载进度状态、速度平滑、节流 emit、预缓冲检测
 */
class ProgressTracker
{
    /**
     * 构造进度追踪器
     * @param {Object} opts - 配置项
     * @param {Object} opts.resumeManager - ResumeManager 实例
     * @param {EventEmitter} opts.emitter - 事件发射器（StreamEngine 实例）
     */
    constructor(opts)
    {
        this._resumeManager = opts.resumeManager;
        this._emitter = opts.emitter;
        // taskId → { downloadedBytes, lastEmitAt, lastLoaded, lastTime, speed }
        this._states = new Map();
        // taskId → 已触发 prebuffer 标记
        this._prebufferEmitted = new Set();
        // taskId → { prebufferTarget, bitrate } 运行时配置
        this._taskRuntime = new Map();
    }

    /**
     * 初始化任务的运行时配置
     * @param {string} taskId - 任务标识
     * @param {number} prebufferTarget - 预缓冲秒数
     * @param {number} bitrate - 码率（bps）
     */
    initTask(taskId, prebufferTarget, bitrate)
    {
        this._taskRuntime.set(taskId, { prebufferTarget, bitrate });
    }

    /**
     * 动态调整任务的预缓冲目标
     * @param {string} taskId - 任务标识
     * @param {number} seconds - 预缓冲秒数
     */
    setPrebufferTarget(taskId, seconds)
    {
        const runtime = this._taskRuntime.get(taskId);
        if (runtime)
        {
            runtime.prebufferTarget = seconds;
        }
    }

    /**
     * 分段进度回调：累计字节、计算速度/ETA、节流 emit、检测预缓冲
     * @param {string} taskId - 任务标识
     * @param {number} loaded - 当前分段已加载字节
     * @param {Object} task - 任务快照
     */
    onProgress(taskId, loaded, task)
    {
        let state = this._states.get(taskId);
        if (!state)
        {
            state = {
                downloadedBytes: this._resumeManager.getDownloadedBytes(taskId),
                lastEmitAt: 0,
                lastLoaded: loaded,
                lastTime: Date.now(),
                speed: 0
            };
            this._states.set(taskId, state);
        }
        const baseBytes = this._resumeManager.getDownloadedBytes(taskId);
        state.downloadedBytes = baseBytes + loaded;
        const now = Date.now();
        const dt = now - state.lastTime;
        if (dt > 0)
        {
            const sample = ((loaded - state.lastLoaded) / dt) * 1000;
            state.speed = smoothSpeed(state.speed, sample);
        }
        state.lastLoaded = loaded;
        state.lastTime = now;
        if (now - state.lastEmitAt >= PROGRESS_THROTTLE_MS)
        {
            state.lastEmitAt = now;
            const eta = computeEta(state.downloadedBytes, task.size, state.speed);
            this._emitter.emit('progress', {
                taskId,
                downloadedBytes: state.downloadedBytes,
                totalBytes: task.size,
                speed: state.speed,
                eta,
                status: 'downloading'
            });
        }
        this._maybeEmitPrebuffer(taskId, state.downloadedBytes, task);
    }

    /**
     * 预缓冲达标检测（仅 autoPlay 任务触发一次）
     * @param {string} taskId - 任务标识
     * @param {number} downloadedBytes - 已下载字节
     * @param {Object} task - 任务快照
     */
    _maybeEmitPrebuffer(taskId, downloadedBytes, task)
    {
        if (this._prebufferEmitted.has(taskId) || !task.autoPlay)
        {
            return;
        }
        const runtime = this._taskRuntime.get(taskId);
        if (!runtime)
        {
            return;
        }
        const targetBytes = computePrebufferBytes(
            runtime.bitrate, runtime.prebufferTarget);
        if (downloadedBytes >= targetBytes)
        {
            this._prebufferEmitted.add(taskId);
            const bufferedSeconds = computeBufferedSeconds(
                downloadedBytes, runtime.bitrate);
            this._emitter.emit('prebuffer', {
                taskId,
                bufferedSeconds,
                target: runtime.prebufferTarget,
                ready: true
            });
        }
    }

    /**
     * 清除指定任务的进度状态
     * @param {string} taskId - 任务标识
     */
    delete(taskId)
    {
        this._states.delete(taskId);
        this._prebufferEmitted.delete(taskId);
        this._taskRuntime.delete(taskId);
    }
}

/**
 * 发出 queue-changed 事件（聚合 active/queued/paused 计数）
 * @param {Object} engine - StreamEngine 实例
 */
function emitQueueChanged(engine)
{
    engine.emit('queue-changed', {
        active: engine.downloadQueue.getActiveTasks().length,
        queued: engine.downloadQueue.getQueuedTasks().length,
        paused: engine.manifestStore.findByStatus('paused').length
    });
}

/**
 * 任务完成处理：标记完成、emit completed、异步触发完整性校验
 * manifest.update 失败时仅记录日志，不阻塞后续事件 emit 与清理
 * @param {Object} engine - StreamEngine 实例
 * @param {string} taskId - 任务标识
 */
async function completeTask(engine, taskId)
{
    const task = engine.manifestStore.get(taskId);
    if (!task) return;
    engine.downloadQueue.complete(taskId);
    engine.retryController.markSuccess(taskId);
    try
    {
        await engine.manifestStore.update(taskId, {
            status: 'completed',
            completedAt: Date.now()
        });
    }
    catch (err)
    {
        console.error(
            `[StreamEngine] manifest update failed for ${taskId}:`, err);
    }
    engine.emit('completed', { taskId, name: task.fileName, size: task.size });
    emitQueueChanged(engine);
    // 清理 retry 监听器与 ProgressTracker 状态，避免内存泄漏
    engine._detachRetryListeners(taskId);
    engine._progress.delete(taskId);
    engine.verify(taskId).catch(err =>
    {
        console.error(`[StreamEngine] verify ${taskId} failed:`, err);
    });
}

/**
 * 任务失败处理：标记错误、emit error（含 recoverable/actions）
 * manifest.update 失败时仅记录日志，不阻塞后续事件 emit 与清理
 * @param {Object} engine - StreamEngine 实例
 * @param {string} taskId - 任务标识
 * @param {Error} error - 错误对象
 */
async function failTask(engine, taskId, error)
{
    const task = engine.manifestStore.get(taskId);
    if (!task) return;
    const errorType = (error && error.errorType) || 'unknown';
    engine.downloadQueue.markError(taskId, error);
    try
    {
        await engine.manifestStore.update(taskId, {
            status: 'error',
            error: { errorType, message: error.message || String(error) }
        });
    }
    catch (err)
    {
        console.error(
            `[StreamEngine] manifest update failed for ${taskId}:`, err);
    }
    engine.emit('error', {
        taskId,
        errorType,
        message: error.message || String(error),
        recoverable: errorType === 'network',
        actions: errorType === 'network' ? ['retry'] : []
    });
    emitQueueChanged(engine);
    // 清理 retry 监听器与 ProgressTracker 状态，避免内存泄漏
    engine._detachRetryListeners(taskId);
    engine._progress.delete(taskId);
}

module.exports = {
    DEFAULT_ASSUMED_BITRATE, PROGRESS_THROTTLE_MS, SPEED_LIMIT_POLL_MS,
    makeError, createTaskId, createSegmentId, computeEta,
    computePrebufferBytes, computeBufferedSeconds, smoothSpeed,
    acquireTokens, cleanupPartialSegment, pipeSegment, ProgressTracker,
    emitQueueChanged, completeTask, failTask
};
