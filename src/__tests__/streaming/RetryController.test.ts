// @ts-nocheck
const RetryController = require('../../main/modules/streaming/RetryController');

describe('RetryController', () =>
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

    describe('默认配置', () =>
    {
        it('默认 delays 为 [5000, 10000, 20000, 40000]', () =>
        {
            const ctrl = new RetryController();
            expect(ctrl.delays).toEqual([5000, 10000, 20000, 40000]);
            ctrl.destroy();
        });

        it('默认 maxRetries 为 4', () =>
        {
            const ctrl = new RetryController();
            expect(ctrl.maxRetries).toBe(4);
            ctrl.destroy();
        });

        it('默认 fatalErrors 含 disk-full/permission-denied/invalid-url', () =>
        {
            const ctrl = new RetryController();
            expect(ctrl.fatalErrors.has('disk-full')).toBe(true);
            expect(ctrl.fatalErrors.has('permission-denied')).toBe(true);
            expect(ctrl.fatalErrors.has('invalid-url')).toBe(true);
            ctrl.destroy();
        });

        it('未传 opts 时不报错', () =>
        {
            const ctrl = new RetryController();
            expect(ctrl.delays).toBeDefined();
            ctrl.destroy();
        });
    });

    describe('reportError - 网络错误重试', () =>
    {
        it('首次网络错误 5s 后 emit retry attempt=1', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'network', message: 'timeout' };
                ctrl.reportError('task-1', error);
                // 立即不应触发
                expect(retryCalls).toHaveLength(0);
                // 推进 4999ms 仍未触发
                jest.advanceTimersByTime(4999);
                expect(retryCalls).toHaveLength(0);
                // 推进到 5000ms 触发
                jest.advanceTimersByTime(1);
                expect(retryCalls).toHaveLength(1);
                expect(retryCalls[0]).toEqual({
                    taskId: 'task-1',
                    attempt: 1,
                    maxRetries: 4
                });
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('指数退避: 第 2 次 10s, 第 3 次 20s, 第 4 次 40s', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'network', message: 'timeout' };

                // 第 1 次: 5s 后 attempt=1
                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(5000);
                expect(retryCalls).toHaveLength(1);
                expect(retryCalls[0].attempt).toBe(1);

                // 第 2 次: 10s 后 attempt=2
                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(9999);
                expect(retryCalls).toHaveLength(1);
                jest.advanceTimersByTime(1);
                expect(retryCalls).toHaveLength(2);
                expect(retryCalls[1].attempt).toBe(2);

                // 第 3 次: 20s 后 attempt=3
                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(19999);
                expect(retryCalls).toHaveLength(2);
                jest.advanceTimersByTime(1);
                expect(retryCalls).toHaveLength(3);
                expect(retryCalls[2].attempt).toBe(3);

                // 第 4 次: 40s 后 attempt=4
                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(39999);
                expect(retryCalls).toHaveLength(3);
                jest.advanceTimersByTime(1);
                expect(retryCalls).toHaveLength(4);
                expect(retryCalls[3].attempt).toBe(4);

                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('4 次重试耗尽后第 5 次错误 emit exhausted', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const exhaustedCalls = collectEvents(ctrl, 'exhausted');
                const error = { errorType: 'network', message: 'timeout' };

                // 完成 4 次重试
                for (let i = 0; i < 4; i++)
                {
                    ctrl.reportError('task-1', error);
                    jest.advanceTimersByTime(ctrl.delays[i]);
                }
                expect(retryCalls).toHaveLength(4);
                expect(exhaustedCalls).toHaveLength(0);

                // 第 5 次错误: exhausted
                const fifthError = { errorType: 'network', message: 'still failing' };
                ctrl.reportError('task-1', fifthError);
                expect(exhaustedCalls).toHaveLength(1);
                expect(retryCalls).toHaveLength(4);
                expect(exhaustedCalls[0]).toEqual({
                    taskId: 'task-1',
                    error: fifthError
                });
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('exhausted 后不再安排定时器', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'network', message: 'timeout' };

                // 完成 4 次重试 + 第 5 次 exhausted
                for (let i = 0; i < 4; i++)
                {
                    ctrl.reportError('task-1', error);
                    jest.advanceTimersByTime(ctrl.delays[i]);
                }
                ctrl.reportError('task-1', error);
                expect(retryCalls).toHaveLength(4);

                // 推进很长时间, 不应再有 retry
                jest.advanceTimersByTime(100000);
                expect(retryCalls).toHaveLength(4);
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });
    });

    describe('reportError - 不可恢复错误', () =>
    {
        it('disk-full 直接 emit fatal 不重试', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const fatalCalls = collectEvents(ctrl, 'fatal');
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'disk-full', message: 'no space' };

                ctrl.reportError('task-1', error);
                expect(fatalCalls).toHaveLength(1);
                expect(fatalCalls[0]).toEqual({
                    taskId: 'task-1',
                    error
                });
                expect(retryCalls).toHaveLength(0);

                // 推进时间, 确认无定时器
                jest.advanceTimersByTime(60000);
                expect(retryCalls).toHaveLength(0);
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('permission-denied 直接 emit fatal', () =>
        {
            const ctrl = new RetryController();
            const fatalCalls = collectEvents(ctrl, 'fatal');
            const error = { errorType: 'permission-denied', message: 'denied' };

            ctrl.reportError('task-1', error);
            expect(fatalCalls).toHaveLength(1);
            expect(fatalCalls[0].error).toBe(error);
            ctrl.destroy();
        });

        it('invalid-url 直接 emit fatal', () =>
        {
            const ctrl = new RetryController();
            const fatalCalls = collectEvents(ctrl, 'fatal');
            const error = { errorType: 'invalid-url', message: 'bad url' };

            ctrl.reportError('task-1', error);
            expect(fatalCalls).toHaveLength(1);
            ctrl.destroy();
        });

        it('非网络错误(如 unknown) emit fatal 不重试', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const fatalCalls = collectEvents(ctrl, 'fatal');
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'unknown', message: 'something' };

                ctrl.reportError('task-1', error);
                expect(fatalCalls).toHaveLength(1);
                expect(fatalCalls[0]).toEqual({
                    taskId: 'task-1',
                    error
                });
                expect(retryCalls).toHaveLength(0);

                jest.advanceTimersByTime(60000);
                expect(retryCalls).toHaveLength(0);
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('自定义 fatalErrors 生效', () =>
        {
            const ctrl = new RetryController({
                fatalErrors: new Set(['custom-fatal'])
            });
            const fatalCalls = collectEvents(ctrl, 'fatal');
            const error = { errorType: 'custom-fatal', message: 'custom' };

            ctrl.reportError('task-1', error);
            expect(fatalCalls).toHaveLength(1);
            // disk-full 不再是 fatal
            const fatalCalls2 = collectEvents(ctrl, 'fatal');
            ctrl.reportError('task-2', { errorType: 'disk-full', message: 'x' });
            // disk-full 现在被当作非网络错误, 仍 emit fatal
            expect(fatalCalls2).toHaveLength(1);
            ctrl.destroy();
        });
    });

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
