// @ts-nocheck
const RetryController = require('../../main/modules/streaming/RetryController');

describe('RetryController - 非网络错误直接 emit fatal', () =>
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

    describe('非网络错误直接 emit fatal', () =>
    {
        it('disk-full (非网络错误) 直接 emit fatal 不重试', () =>
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

        it('permission-denied (非网络错误) 直接 emit fatal', () =>
        {
            const ctrl = new RetryController();
            const fatalCalls = collectEvents(ctrl, 'fatal');
            const error = { errorType: 'permission-denied', message: 'denied' };

            ctrl.reportError('task-1', error);
            expect(fatalCalls).toHaveLength(1);
            expect(fatalCalls[0].error).toBe(error);
            ctrl.destroy();
        });

        it('invalid-url (非网络错误) 直接 emit fatal', () =>
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

        it('fatal 事件后任务状态被清除', () =>
        {
            const ctrl = new RetryController();
            const error = { errorType: 'disk-full', message: 'no space' };
            ctrl.reportError('task-1', error);
            // fatal 后状态被清除
            expect(ctrl.getRetryState('task-1')).toBeUndefined();
            ctrl.destroy();
        });

        it('fatal 后再次 reportError 同任务仍 emit fatal', () =>
        {
            const ctrl = new RetryController();
            const fatalCalls = collectEvents(ctrl, 'fatal');
            const error1 = { errorType: 'disk-full', message: 'first' };
            const error2 = { errorType: 'invalid-url', message: 'second' };

            ctrl.reportError('task-1', error1);
            expect(fatalCalls).toHaveLength(1);
            // 再次报告不同非网络错误, 仍 emit fatal
            ctrl.reportError('task-1', error2);
            expect(fatalCalls).toHaveLength(2);
            expect(fatalCalls[1].error).toBe(error2);
            ctrl.destroy();
        });

        it('网络错误重试期间收到非网络错误立即 emit fatal', () =>
        {
            jest.useFakeTimers();
            try
            {
                const ctrl = new RetryController();
                const fatalCalls = collectEvents(ctrl, 'fatal');
                const retryCalls = collectEvents(ctrl, 'retry');
                const networkError = { errorType: 'network', message: 'timeout' };
                const diskError = { errorType: 'disk-full', message: 'no space' };

                // 先触发一次网络错误, 进入重试流程
                ctrl.reportError('task-1', networkError);
                expect(retryCalls).toHaveLength(0);

                // 重试期间收到非网络错误: 立即 emit fatal, 取消定时器
                ctrl.reportError('task-1', diskError);
                expect(fatalCalls).toHaveLength(1);
                expect(fatalCalls[0].error).toBe(diskError);

                // 推进到原定重试时间, 不应触发 retry
                jest.advanceTimersByTime(60000);
                expect(retryCalls).toHaveLength(0);
                ctrl.destroy();
            }
            finally
            {
                jest.useRealTimers();
            }
        });
    });
});
