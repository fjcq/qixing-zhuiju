// 事件模块
const EventEmitter = require('events');

// 默认退避延迟数组: 5s / 10s / 20s / 40s
const DEFAULT_DELAYS = [5000, 10000, 20000, 40000];

// 默认最大重试次数
const DEFAULT_MAX_RETRIES = 4;

/**
 * 指数退避重试控制器
 * 监听错误并按指数退避策略自动重试:
 * - network 错误: 按 delays 数组依次延迟后 emit 'retry'
 * - 其他所有 errorType (如 disk-full/permission-denied/invalid-url/unknown):
 *   直接 emit 'fatal', 不重试
 *
 * 事件:
 * - 'retry' { taskId, attempt, maxAttempts, nextRetryIn } 即将重试
 * - 'exhausted' { taskId, error } 重试次数耗尽
 * - 'fatal' { taskId, error } 不可恢复错误
 * - 'success' { taskId } 任务成功
 */
class RetryController extends EventEmitter
{
    /**
     * 构造重试控制器
     * @param {Object} [opts] - 配置项
     * @param {Array<number>} [opts.delays] - 退避延迟数组, 默认 [5000, 10000, 20000, 40000]
     * @param {number} [opts.maxRetries] - 最大重试次数, 默认 4
     */
    constructor(opts)
    {
        super();
        this.delays = (opts && opts.delays) || DEFAULT_DELAYS;
        this.maxRetries = (opts && opts.maxRetries !== undefined)
            ? opts.maxRetries : DEFAULT_MAX_RETRIES;
        // taskId → { attempt, lastError, nextRetryAt, timer } 的映射
        this._states = new Map();
    }

    /**
     * 报告任务错误
     * network 错误启动/继续指数退避重试; 其他所有 errorType 直接 emit 'fatal'
     * @param {string} taskId - 任务标识
     * @param {Object} error - 错误对象 { errorType, message }
     * @returns {void}
     */
    reportError(taskId, error)
    {
        const errorType = error && error.errorType;
        // 非网络错误(disk-full/permission-denied/invalid-url/unknown 等):
        // 直接 emit fatal, 清除状态, 不重试
        if (errorType !== 'network')
        {
            this._clearTask(taskId);
            this.emit('fatal', { taskId, error });
            return;
        }
        // 网络错误: 启动/继续重试流程
        let state = this._states.get(taskId);
        if (!state)
        {
            state = {
                attempt: 0,
                lastError: null,
                nextRetryAt: null,
                timer: null
            };
            this._states.set(taskId, state);
        }
        state.lastError = error;
        // 已达最大重试次数: emit exhausted, 不再安排定时器
        if (state.attempt >= this.maxRetries)
        {
            state.nextRetryAt = null;
            if (state.timer)
            {
                clearTimeout(state.timer);
                state.timer = null;
            }
            this.emit('exhausted', { taskId, error });
            return;
        }
        // 安排指数退避定时器
        const delay = this.delays[state.attempt];
        state.nextRetryAt = Date.now() + delay;
        if (state.timer)
        {
            clearTimeout(state.timer);
        }
        state.timer = setTimeout(() =>
        {
            state.timer = null;
            state.nextRetryAt = null;
            state.attempt += 1;
            this.emit('retry', {
                taskId,
                attempt: state.attempt,
                maxAttempts: this.maxRetries,
                nextRetryIn: delay
            });
        }, delay);
        // 定时器不阻塞进程退出
        if (state.timer.unref)
        {
            state.timer.unref();
        }
    }

    /**
     * 标记任务成功, 清除该任务的重试状态与定时器
     * @param {string} taskId - 任务标识
     * @returns {void}
     */
    markSuccess(taskId)
    {
        this._clearTask(taskId);
        this.emit('success', { taskId });
    }

    /**
     * 清除指定任务的重试状态与定时器 (不 emit 事件)
     * 用于任务被取消或手动重置
     * @param {string} taskId - 任务标识
     * @returns {void}
     */
    clear(taskId)
    {
        this._clearTask(taskId);
    }

    /**
     * 返回指定任务的重试状态
     * @param {string} taskId - 任务标识
     * @returns {Object|undefined} { attempt, lastError, nextRetryAt } 或 undefined
     */
    getRetryState(taskId)
    {
        const state = this._states.get(taskId);
        if (!state)
        {
            return undefined;
        }
        return {
            attempt: state.attempt,
            lastError: state.lastError,
            nextRetryAt: state.nextRetryAt
        };
    }

    /**
     * 销毁控制器, 清理所有定时器与状态
     * 之后调用任何方法行为未定义
     * @returns {void}
     */
    destroy()
    {
        for (const state of this._states.values())
        {
            if (state.timer)
            {
                clearTimeout(state.timer);
                state.timer = null;
            }
        }
        this._states.clear();
    }

    /**
     * 清除指定任务的状态与定时器 (内部方法)
     * @param {string} taskId - 任务标识
     * @returns {void}
     */
    _clearTask(taskId)
    {
        const state = this._states.get(taskId);
        if (!state)
        {
            return;
        }
        if (state.timer)
        {
            clearTimeout(state.timer);
            state.timer = null;
        }
        this._states.delete(taskId);
    }
}

module.exports = RetryController;
