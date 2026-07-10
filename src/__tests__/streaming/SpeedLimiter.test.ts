// @ts-nocheck
const SpeedLimiter = require('../../main/modules/streaming/scheduler/SpeedLimiter');

describe('SpeedLimiter', () => {
    it('无限制时立即允许消费', () => {
        const limiter = new SpeedLimiter({ globalBps: 0 });
        expect(limiter.tryConsume(1024)).toBe(true);
    });

    it('全局限速时超额消费被拒', () => {
        const limiter = new SpeedLimiter({ globalBps: 1024 });
        expect(limiter.tryConsume(1024)).toBe(true);
        expect(limiter.tryConsume(1)).toBe(false);
    });

    it('100ms 后桶恢复', (done) => {
        const limiter = new SpeedLimiter({ globalBps: 10240 });
        expect(limiter.tryConsume(10240)).toBe(true);
        expect(limiter.tryConsume(1)).toBe(false);
        setTimeout(() => {
            expect(limiter.tryConsume(1024)).toBe(true);
            done();
        }, 120);
    });

    it('播放优先模式：全局桶降到 50%', () => {
        const limiter = new SpeedLimiter({ globalBps: 10000 });
        expect(limiter.tryConsume(10000)).toBe(true);
        limiter.setPlaybackActive(true);
        limiter._refill();
        expect(limiter.tryConsume(5000)).toBe(true);
        expect(limiter.tryConsume(1)).toBe(false);
    });

    it('单任务限速取小值', () => {
        const limiter = new SpeedLimiter({ globalBps: 100000 });
        limiter.setTaskLimit('task-1', 5000);
        expect(limiter.tryConsume('task-1', 5000)).toBe(true);
        expect(limiter.tryConsume('task-1', 1)).toBe(false);
    });

    it('任务桶有令牌但全局桶不足时不扣减任务桶', () => {
        // globalBps=1000 比 taskLimit=5000 更严格，触发全局先失败的路径
        const limiter = new SpeedLimiter({ globalBps: 1000 });
        limiter.setTaskLimit('task-1', 5000);
        // 第一次消费 1000：全局桶 1000→0，任务桶 5000→4000
        expect(limiter.tryConsume('task-1', 1000)).toBe(true);
        expect(limiter.globalBucket).toBe(0);
        expect(limiter.taskBuckets.get('task-1')).toBe(4000);
        // 第二次立即消费 1000：全局桶 0<1000 应失败，任务桶不应被扣减
        expect(limiter.tryConsume('task-1', 1000)).toBe(false);
        // 关键断言：任务桶应保持 4000，未被失败消费回滚为 3000
        expect(limiter.taskBuckets.get('task-1')).toBe(4000);
        expect(limiter.globalBucket).toBe(0);
    });

    it('clearTaskLimit 后恢复无限制', () => {
        const limiter = new SpeedLimiter({ globalBps: 1000 });
        limiter.setTaskLimit('task-1', 500);
        // 第一次消费 500：全局桶 1000→500，任务桶 500→0
        expect(limiter.tryConsume('task-1', 500)).toBe(true);
        limiter.clearTaskLimit('task-1');
        // 清除后任务桶限制消失，只受全局桶限制（剩余 500）
        expect(limiter.tryConsume('task-1', 500)).toBe(true);
        // 全局桶已耗尽，再消费应失败
        expect(limiter.tryConsume('task-1', 1)).toBe(false);
        // 任务限制确实已被清除
        expect(limiter.taskLimits.has('task-1')).toBe(false);
        expect(limiter.taskBuckets.has('task-1')).toBe(false);
    });

    it('destroy 后定时器停止', () => {
        const limiter = new SpeedLimiter({ globalBps: 1000 });
        expect(limiter.tryConsume(1000)).toBe(true);
        limiter.destroy();
        // destroy 后定时器应停止，_timer 为 null
        expect(limiter._timer).toBeNull();
    });
});
