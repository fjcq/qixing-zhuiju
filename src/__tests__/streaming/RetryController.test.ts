// @ts-nocheck
const RetryController = require('../../main/modules/streaming/RetryController');

describe('RetryController - 核心重试逻辑', () =>
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
                    maxAttempts: 4,
                    nextRetryIn: 5000
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
                expect(retryCalls[0].nextRetryIn).toBe(5000);

                // 第 2 次: 10s 后 attempt=2
                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(9999);
                expect(retryCalls).toHaveLength(1);
                jest.advanceTimersByTime(1);
                expect(retryCalls).toHaveLength(2);
                expect(retryCalls[1].attempt).toBe(2);
                expect(retryCalls[1].nextRetryIn).toBe(10000);

                // 第 3 次: 20s 后 attempt=3
                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(19999);
                expect(retryCalls).toHaveLength(2);
                jest.advanceTimersByTime(1);
                expect(retryCalls).toHaveLength(3);
                expect(retryCalls[2].attempt).toBe(3);
                expect(retryCalls[2].nextRetryIn).toBe(20000);

                // 第 4 次: 40s 后 attempt=4
                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(39999);
                expect(retryCalls).toHaveLength(3);
                jest.advanceTimersByTime(1);
                expect(retryCalls).toHaveLength(4);
                expect(retryCalls[3].attempt).toBe(4);
                expect(retryCalls[3].nextRetryIn).toBe(40000);

                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });

        it('retry 事件 payload 包含 maxAttempts 字段', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController({ maxRetries: 3 });
                const retryCalls = collectEvents(ctrl, 'retry');
                const error = { errorType: 'network', message: 'timeout' };

                ctrl.reportError('task-1', error);
                jest.advanceTimersByTime(5000);
                expect(retryCalls).toHaveLength(1);
                expect(retryCalls[0].maxAttempts).toBe(3);
                expect(retryCalls[0]).not.toHaveProperty('maxRetries');
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
});
