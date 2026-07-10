// 文件系统模块
const fs = require('fs');
// 事件模块
const EventEmitter = require('events');
// 辅助函数与类
const {
    DEFAULT_ASSUMED_BITRATE,
    makeError,
    createTaskId,
    createSegmentId,
    cleanupPartialSegment,
    pipeSegment,
    ProgressTracker,
    emitQueueChanged,
    completeTask,
    failTask
} = require('./StreamEngineHelpers');

// 分段大小：5MB
const SEGMENT_SIZE = 5 * 1024 * 1024;
// 默认预缓冲目标秒数
const DEFAULT_PREBUFFER_TARGET_SECONDS = 5;

/**
 * 边下边播编排核心
 * 集成 DownloadQueue / SpeedLimiter / ResumeManager / ManifestStore /
 * IntegrityChecker / RetryController / ITransport，对外暴露统一的下载生命周期接口。
 *
 * 事件: progress / state-change / prebuffer / integrity / error / completed / queue-changed
 */
class StreamEngine extends EventEmitter
{
    /** 构造 StreamEngine，opts 含 transportFactory/downloadQueue/speedLimiter/resumeManager/manifestStore/storageManager/integrityChecker/retryController/streamPort/prebufferTarget */
    constructor(opts)
    {
        super();
        const required = ['transportFactory', 'downloadQueue', 'speedLimiter',
            'resumeManager', 'manifestStore', 'storageManager', 'integrityChecker',
            'retryController', 'streamPort'];
        for (const key of required)
        {
            if (!opts || opts[key] === undefined)
            {
                throw new Error(`StreamEngine: ${key} is required`);
            }
        }
        Object.assign(this, {
            transportFactory: opts.transportFactory,
            downloadQueue: opts.downloadQueue,
            speedLimiter: opts.speedLimiter,
            resumeManager: opts.resumeManager,
            manifestStore: opts.manifestStore,
            storageManager: opts.storageManager,
            integrityChecker: opts.integrityChecker,
            retryController: opts.retryController,
            streamPort: opts.streamPort,
            defaultPrebufferTarget: opts.prebufferTarget !== undefined
                ? opts.prebufferTarget : DEFAULT_PREBUFFER_TARGET_SECONDS
        });
        this._activeSegments = new Map();
        // taskId → 唯一 token（Symbol），用于检测 _runTask 实例是否仍为当前实例
        // 防止 pause/resume 后旧 _runTask 与新 _runTask 并发执行同一任务
        this._runningTasks = new Map();
        this._retryBindings = new Map();
        this._taskTransports = new Map();
        this._progress = new ProgressTracker({
            resumeManager: this.resumeManager,
            emitter: this
        });
    }

    /**
     * 启动下载任务
     * @param {Object} params - { source, savePath?, priority?, speedLimit?, autoPlay?, mode? }
     * @returns {Promise<{success: boolean, taskId: string, playUrl?: string}>}
     */
    async start({ source, savePath, priority, speedLimit, autoPlay, mode } = {})
    {
        if (!source || !source.type || !source.value)
        {
            throw makeError('invalid-argument', 'source is invalid');
        }
        const finalPriority = autoPlay ? 'high' : (priority || 'normal');
        const finalMode = mode || 'stream';
        const transport = this.transportFactory(source);
        const probe = await transport.probe(source);
        if (!probe.size || probe.size <= 0)
        {
            throw makeError('invalid-source', 'probe returned invalid size');
        }
        const hasSpace = await this.storageManager.checkSpaceAvailable(probe.size);
        if (!hasSpace)
        {
            throw makeError('disk-full',
                `need ${probe.size} bytes, insufficient space`);
        }
        const finalSavePath = savePath
            || await this.storageManager.generateSavePath(probe.fileName);
        const taskId = createTaskId();
        const prebufferTarget = this.defaultPrebufferTarget;
        await this.manifestStore.add({
            id: taskId,
            source,
            savePath: finalSavePath,
            size: probe.size,
            contentType: probe.contentType,
            fileName: probe.fileName,
            bitrate: probe.bitrate,
            acceptRanges: probe.acceptRanges,
            status: 'queued',
            priority: finalPriority,
            autoPlay: !!autoPlay,
            mode: finalMode,
            speedLimit: speedLimit || 0,
            prebufferTarget,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
        this.downloadQueue.enqueue({ id: taskId, priority: finalPriority });
        if (speedLimit && speedLimit > 0)
        {
            this.speedLimiter.setTaskLimit(taskId, speedLimit);
        }
        this._progress.initTask(taskId, prebufferTarget,
            probe.bitrate || DEFAULT_ASSUMED_BITRATE);
        this._attachRetryListeners(taskId);
        // 复用 probe 阶段的 transport，避免 _runTask 重复创建导致 probe transport 泄漏
        this._taskTransports.set(taskId, transport);
        this._runTask(taskId).catch(err =>
        {
            console.error(`[StreamEngine] _runTask ${taskId} failed:`, err);
        });
        const playUrl = finalMode === 'stream'
            ? `http://127.0.0.1:${this.streamPort}/stream/${taskId}` : undefined;
        emitQueueChanged(this);
        return { success: true, taskId, playUrl };
    }

    /** 暂停任务（先更新状态使分段错误回调静默退出） */
    async pause(taskId)
    {
        const task = this.manifestStore.get(taskId);
        if (!task) return;
        const from = task.status;
        await this.manifestStore.update(taskId, { status: 'paused' });
        this.downloadQueue.pause(taskId);
        this._cancelActiveSegments(taskId);
        this._runningTasks.delete(taskId);
        this.emit('state-change', { taskId, from, to: 'paused' });
        emitQueueChanged(this);
    }

    /** 恢复任务 */
    async resume(taskId)
    {
        const task = this.manifestStore.get(taskId);
        if (!task) return;
        const from = task.status;
        this.downloadQueue.resume(taskId);
        await this.manifestStore.update(taskId, { status: 'downloading' });
        this.emit('state-change', { taskId, from, to: 'downloading' });
        this._runTask(taskId).catch(err =>
        {
            console.error(`[StreamEngine] resume _runTask ${taskId} failed:`, err);
        });
    }

    /** 取消任务，removeFiles=true 时删除已下载文件 */
    async cancel(taskId, removeFiles = false)
    {
        const task = this.manifestStore.get(taskId);
        if (!task) return;
        const from = task.status;
        await this.manifestStore.update(taskId, { status: 'cancelled' });
        this._cancelActiveSegments(taskId);
        this._runningTasks.delete(taskId);
        this.downloadQueue.cancel(taskId);
        this.resumeManager.clear(taskId);
        this.retryController.clear(taskId);
        this._detachRetryListeners(taskId);
        this.speedLimiter.clearTaskLimit(taskId);
        this._progress.delete(taskId);
        // 显式销毁 transport 释放底层 HTTP keep-alive 连接，避免 socket 泄漏
        const transport = this._taskTransports.get(taskId);
        if (transport && typeof transport.destroy === 'function')
        {
            try
            {
                transport.destroy();
            }
            catch (e)
            {
                // 忽略 destroy 异常
            }
        }
        this._taskTransports.delete(taskId);
        if (removeFiles)
        {
            try
            {
                await fs.promises.unlink(task.savePath);
            }
            catch (err)
            {
                // 文件可能不存在，忽略
            }
        }
        this.emit('state-change', { taskId, from, to: 'cancelled' });
        emitQueueChanged(this);
    }

    /**
     * 创建读取流（供本地 HTTP 服务器 /stream/<taskId> 调用）
     * 文件不存在的错误通过返回流的 'error' 事件传递，由调用方（HTTP 服务器）处理
     * @param {string} taskId - 任务标识
     * @param {Object} [range] - { start, end } 字节范围（含端点）
     * @returns {import('stream').Readable}
     */
    createReadStream(taskId, { start = 0, end } = {})
    {
        const task = this.manifestStore.get(taskId);
        if (!task)
        {
            const err = new Error(`task not found: ${taskId}`);
            err.code = 'ENOENT';
            throw err;
        }
        // 边下边播场景提升任务优先级，确保下载队列优先调度
        if (task.status === 'downloading' || task.status === 'queued')
        {
            this.downloadQueue.setPriority(taskId, 'high');
        }
        const streamEnd = end !== undefined ? end : task.size - 1;
        // 不使用 fs.existsSync（热路径同步 IO）；ENOENT 等错误由 stream 'error' 事件传递
        return fs.createReadStream(task.savePath, { start, end: streamEnd });
    }

    /** 设置任务预缓冲目标（供 AdaptiveBitrateController 调用） */
    setPrebufferTarget(taskId, seconds)
    {
        this._progress.setPrebufferTarget(taskId, seconds);
        this.manifestStore.update(taskId, { prebufferTarget: seconds })
            .catch(err => console.error(
                `[StreamEngine] setPrebufferTarget ${taskId} failed:`, err));
    }

    /** 校验任务文件完整性，emit 'integrity' 事件并返回结果 */
    async verify(taskId)
    {
        const task = this.manifestStore.get(taskId);
        if (!task)
        {
            return { ok: false, reason: 'task-not-found' };
        }
        const sizeResult = await this.integrityChecker.verifyFileSize(
            task.savePath, task.size);
        let result = sizeResult;
        let actualHash;
        let expectedHash;
        if (sizeResult.ok && task.expectedSha256)
        {
            expectedHash = task.expectedSha256;
            const hashResult = await this.integrityChecker.verifySha256(
                task.savePath, task.expectedSha256);
            actualHash = hashResult.actualSha256;
            result = hashResult;
        }
        this.emit('integrity', { taskId, result, expectedHash, actualHash });
        return result;
    }

    /**
     * 应用启动时恢复：将所有 downloading 状态的任务转为 paused
     * 每个任务独立 try/catch，单任务失败不阻塞其他任务恢复
     */
    async recover()
    {
        const downloadingTasks = this.manifestStore.findByStatus('downloading');
        for (const task of downloadingTasks)
        {
            try
            {
                await this.manifestStore.update(task.id, { status: 'paused' });
                this.emit('state-change', {
                    taskId: task.id,
                    from: 'downloading',
                    to: 'paused',
                    reason: 'recovered'
                });
            }
            catch (err)
            {
                console.error(
                    `[StreamEngine] recover ${task.id} failed:`, err);
            }
        }
    }

    /**
     * 任务执行主循环（顺序下载分段直到完成或被中断）
     * 使用 Symbol token 防止 pause/resume 后旧实例与新实例并发：
     * 仅当 Map 中存储的 token 仍为本实例生成时，循环继续 / finally 清理才生效
     */
    async _runTask(taskId)
    {
        if (this._runningTasks.has(taskId))
        {
            return;
        }
        const token = Symbol(taskId);
        this._runningTasks.set(taskId, token);
        try
        {
            const task = this.manifestStore.get(taskId);
            if (!task || task.status !== 'downloading')
            {
                return;
            }
            let transport = this._taskTransports.get(taskId);
            if (!transport)
            {
                transport = this.transportFactory(task.source);
                this._taskTransports.set(taskId, transport);
            }
            while (this._runningTasks.get(taskId) === token)
            {
                const current = this.manifestStore.get(taskId);
                if (!current || current.status !== 'downloading')
                {
                    return;
                }
                const start = this.resumeManager.getNextStart(
                    taskId, current.size);
                if (start >= current.size)
                {
                    await completeTask(this, taskId);
                    return;
                }
                const end = Math.min(start + SEGMENT_SIZE - 1, current.size - 1);
                if (!await this._downloadSegment(
                    taskId, transport, start, end, current))
                {
                    return;
                }
            }
        }
        catch (err)
        {
            console.error(`[StreamEngine] _runTask ${taskId} exception:`, err);
            await failTask(this, taskId, err);
        }
        finally
        {
            // 仅当 Map 中存的仍是本实例的 token 时才删除
            // 避免误删 resume 后新 _runTask 写入的条目
            if (this._runningTasks.get(taskId) === token)
            {
                this._runningTasks.delete(taskId);
            }
        }
    }

    /** 下载单个分段，成功返回 true，失败（已上报重试控制器）返回 false */
    async _downloadSegment(taskId, transport, start, end, task)
    {
        const segmentId = createSegmentId(taskId);
        let segs = this._activeSegments.get(taskId);
        if (!segs)
        {
            segs = new Set();
            this._activeSegments.set(taskId, segs);
        }
        segs.add(segmentId);
        let reader;
        let writer;
        try
        {
            reader = await transport.createSegmentReader({
                id: segmentId,
                start,
                end,
                priority: task.priority,
                onProgress: (loaded) =>
                    this._progress.onProgress(taskId, loaded, task)
            });
            writer = await transport.createSegmentWriter({
                savePath: task.savePath,
                append: start > 0
            });
            const isRunning = () => this._runningTasks.has(taskId);
            const { ok, error } = await pipeSegment(
                this.speedLimiter, isRunning, taskId, reader, writer);
            if (!ok)
            {
                await cleanupPartialSegment(writer, task.savePath, start);
                segs.delete(segmentId);
                this._reportError(taskId, error);
                return false;
            }
            // ResumeManager 使用 exclusive end 约定，故传 end + 1
            this.resumeManager.addRange(taskId, start, end + 1);
            segs.delete(segmentId);
            return true;
        }
        catch (err)
        {
            // 先中止 reader 释放底层 HTTP 连接，避免 socket 泄漏
            // （createSegmentWriter 抛错时 reader 已建立但尚未进入 pipeSegment）
            if (reader && typeof reader.abort === 'function')
            {
                try
                {
                    reader.abort();
                }
                catch (e)
                {
                    // 忽略 abort 错误
                }
            }
            await cleanupPartialSegment(writer, task.savePath, start);
            segs.delete(segmentId);
            this._reportError(taskId, err);
            return false;
        }
    }

    /** 挂接重试监听器（retry 触发重新下载，fatal/exhausted 触发失败） */
    _attachRetryListeners(taskId)
    {
        if (this._retryBindings.has(taskId)) return;
        const onRetry = (payload) =>
        {
            if (payload.taskId !== taskId) return;
            this._runTask(taskId).catch(err =>
            {
                console.error(
                    `[StreamEngine] retry _runTask ${taskId} failed:`, err);
            });
        };
        const onTerminal = (payload) =>
        {
            if (payload.taskId === taskId)
            {
                failTask(this, taskId, payload.error);
            }
        };
        this.retryController.on('retry', onRetry);
        this.retryController.on('fatal', onTerminal);
        this.retryController.on('exhausted', onTerminal);
        this._retryBindings.set(taskId, { onRetry, onTerminal });
    }

    /** 解绑重试监听器 */
    _detachRetryListeners(taskId)
    {
        const b = this._retryBindings.get(taskId);
        if (!b) return;
        this.retryController.off('retry', b.onRetry);
        this.retryController.off('fatal', b.onTerminal);
        this.retryController.off('exhausted', b.onTerminal);
        this._retryBindings.delete(taskId);
    }

    /** 取消任务的所有活动分段（通过 transport.cancel 中止 HTTP 请求） */
    _cancelActiveSegments(taskId)
    {
        const segs = this._activeSegments.get(taskId);
        if (!segs) return;
        const transport = this._taskTransports.get(taskId);
        for (const segId of segs)
        {
            if (transport)
            {
                try
                {
                    transport.cancel(segId);
                }
                catch (e)
                {
                    // 忽略取消异常
                }
            }
        }
        this._activeSegments.delete(taskId);
    }

    /** 仅当任务仍处于 downloading 状态时上报错误到重试控制器 */
    _reportError(taskId, error)
    {
        if (!error) return;
        const task = this.manifestStore.get(taskId);
        if (!task || task.status !== 'downloading') return;
        this.retryController.reportError(taskId, {
            errorType: error.errorType || 'network',
            message: error.message || String(error)
        });
    }
}

module.exports = StreamEngine;
