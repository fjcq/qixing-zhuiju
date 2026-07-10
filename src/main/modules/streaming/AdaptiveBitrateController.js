// 事件模块
const EventEmitter = require('events');

// 默认采样窗口: 10 秒（毫秒）
const DEFAULT_SAMPLE_WINDOW_MS = 10000;
// 默认最小码率: 100 kbps（避免 probe 误判触发自适应）
const DEFAULT_MIN_BITRATE_BPS = 100000;
// 默认 / 收敛 / 扩展前瞻缓冲（秒）
const DEFAULT_DEFAULT_PREBUFFER_SEC = 30;
const DEFAULT_EXPANDED_PREBUFFER_SEC = 60;
const DEFAULT_CONVERGED_PREBUFFER_SEC = 30;
// 同一 level 状态防抖窗口: 30 秒（毫秒）
const LEVEL_DEBOUNCE_MS = 30000;
// bitrate 估算延迟: 5 秒（首次 progress 后等待时长）
const BITRATE_ESTIMATE_DELAY_MS = 5000;
// level 标识
const LEVEL_CONVERGED = 'converged';
const LEVEL_EXPANDED = 'expanded';
const LEVEL_INSUFFICIENT = 'insufficient';

/**
 * 自适应码率控制器
 * 监听 StreamEngine 的 progress 事件, 动态调整 prebufferTarget:
 * - 速度 ≥ 码率 1.5× → 前瞻缓冲收敛到 30s (converged)
 * - 速度 ∈ [码率, 码率×1.5) → 前瞻缓冲扩到 60s (expanded)
 * - 速度 < 码率 → emit 'bitrate-warning' (insufficient), 不调整 prebufferTarget
 *
 * 事件:
 * - 'bitrate-warning' { taskId, speed, bitrate, ratio, level, message, action }
 * - 'level-changed' { taskId, from, to, prebufferTarget }
 */
class AdaptiveBitrateController extends EventEmitter
{
    /**
     * 构造自适应码率控制器
     * @param {Object} opts - 配置项
     * @param {Object} opts.streamEngine - StreamEngine 实例（监听 progress + 调用 setPrebufferTarget）
     * @param {number} [opts.sampleWindowMs=10000] - 速度采样窗口（毫秒）
     * @param {number} [opts.minBitrateBps=100000] - 最小码率（bps）
     * @param {number} [opts.defaultPrebufferSec=30] - 默认前瞻缓冲（秒）
     * @param {number} [opts.expandedPrebufferSec=60] - 扩展前瞻缓冲（秒）
     * @param {number} [opts.convergedPrebufferSec=30] - 收敛前瞻缓冲（秒）
     */
    constructor(opts)
    {
        super();
        opts = opts || {};
        this.streamEngine = opts.streamEngine;
        this.sampleWindowMs = opts.sampleWindowMs !== undefined
            ? opts.sampleWindowMs : DEFAULT_SAMPLE_WINDOW_MS;
        this.minBitrateBps = opts.minBitrateBps !== undefined
            ? opts.minBitrateBps : DEFAULT_MIN_BITRATE_BPS;
        this.defaultPrebufferSec = opts.defaultPrebufferSec !== undefined
            ? opts.defaultPrebufferSec : DEFAULT_DEFAULT_PREBUFFER_SEC;
        this.expandedPrebufferSec = opts.expandedPrebufferSec !== undefined
            ? opts.expandedPrebufferSec : DEFAULT_EXPANDED_PREBUFFER_SEC;
        this.convergedPrebufferSec = opts.convergedPrebufferSec !== undefined
            ? opts.convergedPrebufferSec : DEFAULT_CONVERGED_PREBUFFER_SEC;
        // taskId → 采样数组 [{ timestamp, downloadedBytes }]
        this._samples = new Map();
        // taskId → 预期码率（bps）
        this._expectedBitrate = new Map();
        // taskId → { speed, bitrate, ratio, level, prebufferTarget }
        this._status = new Map();
        // taskId → 上次 level 切换时间戳
        this._lastLevelChangeAt = new Map();
        // taskId → { firstSampleAt, firstDownloadedBytes } 用于 bitrate 估算
        this._probe = new Map();
        // taskId → 上次实际调用 setPrebufferTarget 的值（避免重复 DB 写入）
        this._lastSetPrebuffer = new Map();
        this._started = false;
        // 绑定的事件处理器引用, 便于 stop() 精确移除
        this._boundProgress = null;
        this._boundCompleted = null;
        this._boundStateChange = null;
        this._boundError = null;
    }

    /**
     * 启动监听（绑定 StreamEngine 的 progress / completed / state-change / error 事件）
     * 必须在 StreamEngine.start 之前调用
     */
    start()
    {
        if (this._started)
        {
            return;
        }
        if (!this.streamEngine || typeof this.streamEngine.on !== 'function')
        {
            throw new Error('AdaptiveBitrateController: streamEngine 未提供或不支持事件监听');
        }
        this._boundProgress = (p) => this._onProgress(p);
        this._boundCompleted = (p) => this._onCompleted(p);
        this._boundStateChange = (p) => this._onStateChange(p);
        this._boundError = (p) => this._onError(p);
        this.streamEngine.on('progress', this._boundProgress);
        this.streamEngine.on('completed', this._boundCompleted);
        this.streamEngine.on('state-change', this._boundStateChange);
        this.streamEngine.on('error', this._boundError);
        this._started = true;
    }

    /**
     * 停止监听（移除所有事件监听器, 清理状态）
     * 应用退出或 StreamEngine 销毁时调用
     */
    stop()
    {
        if (!this._started)
        {
            return;
        }
        const engine = this.streamEngine;
        const remove = (ev, fn) =>
        {
            if (engine && typeof engine.off === 'function')
            {
                engine.off(ev, fn);
            }
            else if (engine && typeof engine.removeListener === 'function')
            {
                engine.removeListener(ev, fn);
            }
        };
        remove('progress', this._boundProgress);
        remove('completed', this._boundCompleted);
        remove('state-change', this._boundStateChange);
        remove('error', this._boundError);
        this._boundProgress = null;
        this._boundCompleted = null;
        this._boundStateChange = null;
        this._boundError = null;
        this._started = false;
        this._samples.clear();
        this._expectedBitrate.clear();
        this._status.clear();
        this._lastLevelChangeAt.clear();
        this._probe.clear();
        this._lastSetPrebuffer.clear();
    }

    /**
     * 手动设置任务的预期码率（用于 probe 阶段估算后注入）
     * 设置后清除 probe 状态, 不再走估算流程
     * @param {string} taskId - 任务标识
     * @param {number} bitrateBps - 视频码率（bps）
     */
    setExpectedBitrate(taskId, bitrateBps)
    {
        if (!taskId || typeof bitrateBps !== 'number' || bitrateBps <= 0)
        {
            return;
        }
        this._expectedBitrate.set(taskId, bitrateBps);
        this._probe.delete(taskId);
    }

    /**
     * 获取任务当前的自适应状态
     * @param {string} taskId - 任务标识
     * @returns {Object|undefined} { speed, bitrate, ratio, level, prebufferTarget } 或 undefined
     */
    getStatus(taskId)
    {
        const status = this._status.get(taskId);
        return status ? Object.assign({}, status) : undefined;
    }

    /**
     * 清理指定任务的状态（任务完成/取消/出错时调用）
     * @param {string} taskId - 任务标识
     */
    clearTask(taskId)
    {
        this._samples.delete(taskId);
        this._expectedBitrate.delete(taskId);
        this._status.delete(taskId);
        this._lastLevelChangeAt.delete(taskId);
        this._probe.delete(taskId);
        this._lastSetPrebuffer.delete(taskId);
    }

    /**
     * progress 事件处理器: 写入采样 + 触发自适应判定
     * @param {Object} payload - { taskId, downloadedBytes, totalBytes, speed, eta, status }
     */
    _onProgress(payload)
    {
        if (!payload || !payload.taskId)
        {
            return;
        }
        const taskId = payload.taskId;
        const now = Date.now();
        const downloadedBytes = payload.downloadedBytes || 0;
        // 写入采样并清理过期样本
        const samples = this._samples.get(taskId) || [];
        samples.push({ timestamp: now, downloadedBytes });
        const cutoff = now - this.sampleWindowMs;
        while (samples.length > 0 && samples[0].timestamp < cutoff)
        {
            samples.shift();
        }
        this._samples.set(taskId, samples);
        // 未设置 expectedBitrate 时, 走 probe 估算流程
        if (!this._expectedBitrate.has(taskId))
        {
            this._maybeProbe(taskId, downloadedBytes, now);
            return;
        }
        const bitrate = this._expectedBitrate.get(taskId);
        if (!bitrate || bitrate < this.minBitrateBps)
        {
            return;
        }
        const avgSpeed = this._computeAvgSpeed(taskId);
        if (avgSpeed === null)
        {
            return;
        }
        const ratio = avgSpeed / bitrate;
        this._applyAdaptive(taskId, avgSpeed, bitrate, ratio, now);
    }

    /**
     * bitrate 兜底估算: 首次 progress 记录起点, 5 秒后用 deltaBytes * 8 / deltaSec 估算
     * 估算值 ≥ minBitrateBps 时采纳, 否则重置起点继续观察
     * @param {string} taskId - 任务标识
     * @param {number} downloadedBytes - 当前已下载字节
     * @param {number} now - 当前时间戳
     */
    _maybeProbe(taskId, downloadedBytes, now)
    {
        const probe = this._probe.get(taskId);
        if (!probe)
        {
            this._probe.set(taskId, {
                firstSampleAt: now,
                firstDownloadedBytes: downloadedBytes
            });
            return;
        }
        if (now - probe.firstSampleAt < BITRATE_ESTIMATE_DELAY_MS)
        {
            return;
        }
        const deltaBytes = downloadedBytes - probe.firstDownloadedBytes;
        const deltaSec = (now - probe.firstSampleAt) / 1000;
        if (deltaSec <= 0 || deltaBytes <= 0)
        {
            this._probe.set(taskId, {
                firstSampleAt: now,
                firstDownloadedBytes: downloadedBytes
            });
            return;
        }
        // bitrate = bytes/sec * 8 = bps
        const estimatedBitrate = (deltaBytes / deltaSec) * 8;
        if (estimatedBitrate >= this.minBitrateBps)
        {
            this._expectedBitrate.set(taskId, estimatedBitrate);
            this._probe.delete(taskId);
        }
        else
        {
            // 估算值过低（可能是 probe 误判）, 重置起点继续观察
            this._probe.set(taskId, {
                firstSampleAt: now,
                firstDownloadedBytes: downloadedBytes
            });
        }
    }

    /**
     * 计算滑动窗口内的平均速度（bytes/sec）
     * avgSpeed = (latestBytes - oldestBytes) / (latestTs - oldestTs)
     * @param {string} taskId - 任务标识
     * @returns {number|null} 平均速度, 采样不足或异常时返回 null
     */
    _computeAvgSpeed(taskId)
    {
        const samples = this._samples.get(taskId);
        if (!samples || samples.length < 2)
        {
            return null;
        }
        const oldest = samples[0];
        const latest = samples[samples.length - 1];
        const dtMs = latest.timestamp - oldest.timestamp;
        if (dtMs <= 0)
        {
            return null;
        }
        const deltaBytes = latest.downloadedBytes - oldest.downloadedBytes;
        if (deltaBytes < 0)
        {
            // 任务可能重置（如重新下载）, 返回 null 等待新采样
            return null;
        }
        return (deltaBytes / dtMs) * 1000;
    }

    /**
     * 自适应判定核心: 根据 ratio 决定 level, 应用防抖与 insufficient 锁定
     * @param {string} taskId - 任务标识
     * @param {number} speed - 当前平均速度（bytes/sec）
     * @param {number} bitrate - 预期码率（bps）
     * @param {number} ratio - speed / bitrate
     * @param {number} now - 当前时间戳
     */
    _applyAdaptive(taskId, speed, bitrate, ratio, now)
    {
        let newLevel;
        let newPrebuffer = null;
        if (ratio >= 1.5)
        {
            newLevel = LEVEL_CONVERGED;
            newPrebuffer = this.convergedPrebufferSec;
        }
        else if (ratio >= 1.0)
        {
            newLevel = LEVEL_EXPANDED;
            newPrebuffer = this.expandedPrebufferSec;
        }
        else
        {
            newLevel = LEVEL_INSUFFICIENT;
            // insufficient: 不调整 prebufferTarget（保留当前值, 由用户决策）
        }
        const prevStatus = this._status.get(taskId);
        const prevLevel = prevStatus ? prevStatus.level : null;
        const lastChangeAt = this._lastLevelChangeAt.get(taskId) || 0;
        // insufficient 锁定: 进入 insufficient 后 30 秒内不切回其他 level
        if (prevLevel === LEVEL_INSUFFICIENT
            && (now - lastChangeAt) < LEVEL_DEBOUNCE_MS
            && newLevel !== LEVEL_INSUFFICIENT)
        {
            this._status.set(taskId, {
                speed, bitrate, ratio,
                level: LEVEL_INSUFFICIENT,
                prebufferTarget: prevStatus.prebufferTarget
            });
            return;
        }
        // 同 level: 不 emit 事件, 但更新 status（speed/ratio 可能变化）
        if (newLevel === prevLevel)
        {
            const prebufferTarget = newPrebuffer !== null
                ? newPrebuffer : prevStatus.prebufferTarget;
            this._status.set(taskId, {
                speed, bitrate, ratio, level: newLevel, prebufferTarget
            });
            // 仍可调用 setPrebufferTarget（成本较低, idempotent）, 仅当目标变化时调用
            this._maybeSetPrebuffer(taskId, newPrebuffer);
            return;
        }
        // level 切换: 检查 30 秒防抖（首次切换 prevLevel=null 不防抖）
        if (prevLevel !== null && (now - lastChangeAt) < LEVEL_DEBOUNCE_MS)
        {
            this._status.set(taskId, {
                speed, bitrate, ratio,
                level: prevLevel,
                prebufferTarget: prevStatus.prebufferTarget
            });
            return;
        }
        // 正式切换 level
        const prebufferTarget = newPrebuffer !== null
            ? newPrebuffer
            : (prevStatus ? prevStatus.prebufferTarget : this.defaultPrebufferSec);
        this._status.set(taskId, {
            speed, bitrate, ratio, level: newLevel, prebufferTarget
        });
        this._lastLevelChangeAt.set(taskId, now);
        // 应用 setPrebufferTarget（insufficient 不调用, 保留进入前的值）
        if (newLevel !== LEVEL_INSUFFICIENT)
        {
            this._maybeSetPrebuffer(taskId, newPrebuffer);
        }
        // emit level-changed（无论方向）
        this.emit('level-changed', {
            taskId, from: prevLevel, to: newLevel, prebufferTarget
        });
        // insufficient 时 emit bitrate-warning
        if (newLevel === LEVEL_INSUFFICIENT)
        {
            this.emit('bitrate-warning', {
                taskId, speed, bitrate, ratio,
                level: LEVEL_INSUFFICIENT,
                message: '网速不足以支撑边下边播，建议先下载再观看',
                action: 'switch-to-download'
            });
        }
    }

    /**
     * 调用 streamEngine.setPrebufferTarget（仅当目标值变化时, 避免重复 DB 写入）
     * @param {string} taskId - 任务标识
     * @param {number|null} seconds - 前瞻缓冲秒数, null 时不调用
     */
    _maybeSetPrebuffer(taskId, seconds)
    {
        if (seconds === null || seconds === undefined)
        {
            return;
        }
        const lastSet = this._lastSetPrebuffer.get(taskId);
        if (lastSet === seconds)
        {
            return;
        }
        if (this.streamEngine
            && typeof this.streamEngine.setPrebufferTarget === 'function')
        {
            this.streamEngine.setPrebufferTarget(taskId, seconds);
            this._lastSetPrebuffer.set(taskId, seconds);
        }
    }

    /**
     * completed 事件处理器: 任务完成, 清理状态
     * @param {Object} payload - { taskId, name, size }
     */
    _onCompleted(payload)
    {
        if (!payload || !payload.taskId)
        {
            return;
        }
        this.clearTask(payload.taskId);
    }

    /**
     * state-change 事件处理器: cancelled 时清理状态
     * 注: paused/downloading 不清理（任务可能恢复）
     * @param {Object} payload - { taskId, from, to, reason? }
     */
    _onStateChange(payload)
    {
        if (!payload || !payload.taskId)
        {
            return;
        }
        if (payload.to === 'cancelled')
        {
            this.clearTask(payload.taskId);
        }
    }

    /**
     * error 事件处理器: 不可恢复错误时清理状态
     * 可恢复错误（network）不清理, 因为 RetryController 可能重试后恢复 progress
     * @param {Object} payload - { taskId, errorType, message, recoverable, actions }
     */
    _onError(payload)
    {
        if (!payload || !payload.taskId)
        {
            return;
        }
        if (payload.recoverable)
        {
            return;
        }
        this.clearTask(payload.taskId);
    }
}

module.exports = AdaptiveBitrateController;
