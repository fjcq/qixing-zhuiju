// @ts-nocheck
const RetryController = require('../../main/modules/streaming/RetryController');

describe('RetryController - 生命周期与状态管理', () =>
{
    /**
     * 收集事件到数组, 便于断言
     * @param {EventEmitter} emitter - 事件发射器
     * @param {string} event - 事件名
     * @returns {Array<Object>} 事件参数数组
     */
    const collectEvents = (emitter, event) =>
    {
        const calls = [];
        emitter.on(event, (...args) => calls.push(args[0]));
        return calls;
    };

    describe('markSuccess', () =>
    {
        it('清除重试状态并 emit success', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const successCalls = collectEvents(ctrl, 'success');
                const error = { errorType: 'network', message: 'timeout' };

                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(5000);
                // 已触发 1 次 retry
                ctrl.markSuccess('task-1');
                expect(successCalls).toHaveLength(1);
                expect(successCalls[0]).toEqual({ taskId: 'task-1' });
                // 状态应被清除
                expect(ctrl.getRetryState('task-1')).toBeUndefined();
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('markSuccess 取消待执行的定时器', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'network', message: 'timeout' };

                ctrl.reportError('task-1', error);
                // 定时器尚未触发, markSuccess 应取消
                jest.advanceTimersByTime(1000);
                ctrl.markSuccess('task-1');
                // 推进到原定触发时间, 不应触发 retry
                jest.advanceTimersByTime(5000);
                expect(retryCalls).toHaveLength(0);
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('markSuccess 后再次 reportError 重新开始计数 attempt=1', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'network', message: 'timeout' };

                // 第 1 次错误, 5s 后 retry attempt=1
                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(5000);
                expect(retryCalls).toHaveLength(1);
                expect(retryCalls[0].attempt).toBe(1);

                // markSuccess 重置
                ctrl.markSuccess('task-1');

                // 再次错误, 应从 5s 后 attempt=1 重新开始
                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(4999);
                expect(retryCalls).toHaveLength(1);
                jest.advanceTimersByTime(1);
                expect(retryCalls).toHaveLength(2);
                expect(retryCalls[1].attempt).toBe(1);
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('markSuccess 对未知任务也 emit success', () =>
        {
            const ctrl = new RetryController();
            const successCalls = collectEvents(ctrl, 'success');
            ctrl.markSuccess('not-exist');
            expect(successCalls).toHaveLength(1);
            ctrl.destroy();
        });
    });

    describe('clear', () =>
    {
        it('清除状态但不 emit 事件', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const successCalls = collectEvents(ctrl, 'success');
                const exhaustedCalls = collectEvents(ctrl, 'exhausted');
                const fatalCalls = collectEvents(ctrl, 'fatal');
                const error = { errorType: 'network', message: 'timeout' };

                ctrl.reportError('task-1', error);
                ctrl.clear('task-1');
                // 不 emit 任何事件
                expect(retryCalls).toHaveLength(0);
                expect(successCalls).toHaveLength(0);
                expect(exhaustedCalls).toHaveLength(0);
                expect(fatalCalls).toHaveLength(0);
                // 状态被清除
                expect(ctrl.getRetryState('task-1')).toBeUndefined();
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('clear 后定时器不再触发', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'network', message: 'timeout' };

                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(1000);
                ctrl.clear('task-1');
                // 推进到原定触发时间, 不应触发
                jest.advanceTimersByTime(5000);
                expect(retryCalls).toHaveLength(0);
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('clear 后再次 reportError 重新开始计数', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'network', message: 'timeout' };

                // 第 1 次错误, 触发 5s 定时器
                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(5000);
                expect(retryCalls).toHaveLength(1);
                expect(retryCalls[0].attempt).toBe(1);

                // 第 2 次错误, 触发 10s 定时器
                ctrl.reportError('task-1', error);
                // clear 重置
                ctrl.clear('task-1');

                // 再次错误, 应从 5s 后 attempt=1 重新开始
                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(4999);
                expect(retryCalls).toHaveLength(1);
                jest.advanceTimersByTime(1);
                expect(retryCalls).toHaveLength(2);
                expect(retryCalls[1].attempt).toBe(1);
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('clear 未知任务不报错', () =>
        {
            const ctrl = new RetryController();
            expect(() => ctrl.clear('not-exist')).not.toThrow();
            ctrl.destroy();
        });
    });

    describe('getRetryState', () =>
    {
        it('未报告错误返回 undefined', () =>
        {
            const ctrl = new RetryController();
            expect(ctrl.getRetryState('task-1')).toBeUndefined();
            ctrl.destroy();
        });

        it('首次错误后返回 attempt=0 与 nextRetryAt', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const now = Date.now();
                const error = { errorType: 'network', message: 'timeout' };
                ctrl.reportError('task-1', error);

                const state = ctrl.getRetryState('task-1');
                expect(state).toBeDefined();
                expect(state.attempt).toBe(0);
                expect(state.lastError).toBe(error);
                expect(state.nextRetryAt).toBeGreaterThan(now + 4000);
                expect(state.nextRetryAt).toBeLessThanOrEqual(now + 5000);
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('retry 触发后 attempt 递增, nextRetryAt 为 null', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const error = { errorType: 'network', message: 'timeout' };

                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(5000);
                // 第 1 次 retry 已触发
                let state = ctrl.getRetryState('task-1');
                expect(state.attempt).toBe(1);
                expect(state.lastError).toBe(error);
                expect(state.nextRetryAt).toBeNull();

                // 第 2 次错误
                ctrl.reportError('task-1', error);
                state = ctrl.getRetryState('task-1');
                expect(state.attempt).toBe(1);
                expect(state.nextRetryAt).not.toBeNull();

                jest.advanceTimersByTime(10000);
                state = ctrl.getRetryState('task-1');
                expect(state.attempt).toBe(2);
                expect(state.nextRetryAt).toBeNull();
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('exhausted 后状态保留 attempt=maxRetries', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const error = { errorType: 'network', message: 'timeout' };

                for (let i = 0; i < 4; i++)
                {
                    ctrl.reportError('task-1', error);
                    jest.advanceTimersByTime(ctrl.delays[i]);
                }
                const fifthError = { errorType: 'network', message: 'fifth' };
                ctrl.reportError('task-1', fifthError);

                const state = ctrl.getRetryState('task-1');
                expect(state).toBeDefined();
                expect(state.attempt).toBe(4);
                expect(state.lastError).toBe(fifthError);
                expect(state.nextRetryAt).toBeNull();
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('fatal 后 getRetryState 返回 undefined', () =>
        {
            const ctrl = new RetryController();
            const error = { errorType: 'disk-full', message: 'no space' };
            ctrl.reportError('task-1', error);
            // fatal 后状态被清除
            expect(ctrl.getRetryState('task-1')).toBeUndefined();
            ctrl.destroy();
        });
    });

    describe('destroy', () =>
    {
        it('destroy 清理所有定时器', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'network', message: 'timeout' };

                ctrl.reportError('task-1', error);
                ctrl.destroy();
                // 推进时间, 不应触发任何 retry
                jest.advanceTimersByTime(60000);
                expect(retryCalls).toHaveLength(0);
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('destroy 后定时器不再触发', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'network', message: 'timeout' };

                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(1000);
                ctrl.destroy();
                // 推进到原定触发时间及之后, 不应触发
                jest.advanceTimersByTime(100000);
                expect(retryCalls).toHaveLength(0);
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('destroy 清理多个任务的定时器', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'network', message: 'timeout' };

                ctrl.reportError('task-1', error);
                ctrl.reportError('task-2', error);
                ctrl.reportError('task-3', error);
                ctrl.destroy();
                jest.advanceTimersByTime(60000);
                expect(retryCalls).toHaveLength(0);
            }
            finally
            {
                jest.useRealTimers();
            }
        });
    });

    describe('多任务隔离', () =>
    {
        it('不同任务的重试状态相互独立', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'network', message: 'timeout' };

                ctrl.reportError('task-1', error);
                ctrl.reportError('task-2', error);

                // task-1 5s 后 retry
                jest.advanceTimersByTime(5000);
                expect(retryCalls).toHaveLength(2);
                const taskIds = retryCalls.map(c => c.taskId).sort();
                expect(taskIds).toEqual(['task-1', 'task-2']);
                expect(retryCalls[0].attempt).toBe(1);
                expect(retryCalls[1].attempt).toBe(1);

                // task-1 第 2 次错误, task-2 不再错误
                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(10000);
                expect(retryCalls).toHaveLength(3);
                expect(retryCalls[2].taskId).toBe('task-1');
                expect(retryCalls[2].attempt).toBe(2);

                // task-2 状态应为 attempt=1, nextRetryAt=null
                const state2 = ctrl.getRetryState('task-2');
                expect(state2.attempt).toBe(1);
                expect(state2.nextRetryAt).toBeNull();
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('markSuccess 仅清除指定任务', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const error = { errorType: 'network', message: 'timeout' };

                ctrl.reportError('task-1', error);
                ctrl.reportError('task-2', error);

                ctrl.markSuccess('task-1');
                expect(ctrl.getRetryState('task-1')).toBeUndefined();
                expect(ctrl.getRetryState('task-2')).toBeDefined();
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });
    });
});
