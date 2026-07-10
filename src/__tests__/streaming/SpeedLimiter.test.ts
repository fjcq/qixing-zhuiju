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
});
