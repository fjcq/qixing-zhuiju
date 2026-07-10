// @ts-nocheck
const DownloadQueue = require('../../main/modules/streaming/scheduler/DownloadQueue');

describe('DownloadQueue', () => {
    it('低于并发限制时立即激活', () => {
        const q = new DownloadQueue({ maxConcurrent: 3 });
        q.enqueue({ id: 't1', priority: 'normal' });
        expect(q.getActiveTasks()).toHaveLength(1);
    });

    it('超过并发限制时排队等待', () => {
        const q = new DownloadQueue({ maxConcurrent: 2 });
        q.enqueue({ id: 't1', priority: 'normal' });
        q.enqueue({ id: 't2', priority: 'normal' });
        q.enqueue({ id: 't3', priority: 'normal' });
        expect(q.getActiveTasks()).toHaveLength(2);
        expect(q.getQueuedTasks()).toHaveLength(1);
    });

    it('高优先级任务插队到队首', () => {
        const q = new DownloadQueue({ maxConcurrent: 1 });
        q.enqueue({ id: 't1', priority: 'normal' });
        q.enqueue({ id: 't2', priority: 'normal' });
        q.enqueue({ id: 't3', priority: 'high' });
        expect(q.getQueuedTasks()[0].id).toBe('t3');
    });

    it('高优先级抢占低优先级活动任务', () => {
        const q = new DownloadQueue({ maxConcurrent: 1 });
        q.enqueue({ id: 't1', priority: 'low' });
        const result = q.enqueue({ id: 't2', priority: 'high' });
        expect(result.preempted).toBe('t1');
        expect(q.getActiveTasks()[0].id).toBe('t2');
        expect(q.getTask('t1').status).toBe('paused');
    });

    it('完成任务后自动激活下一个', () => {
        const q = new DownloadQueue({ maxConcurrent: 1 });
        q.enqueue({ id: 't1', priority: 'normal' });
        q.enqueue({ id: 't2', priority: 'normal' });
        q.complete('t1');
        expect(q.getActiveTasks()[0].id).toBe('t2');
    });

    it('暂停活动任务释放槽位', () => {
        const q = new DownloadQueue({ maxConcurrent: 1 });
        q.enqueue({ id: 't1', priority: 'normal' });
        q.enqueue({ id: 't2', priority: 'normal' });
        q.pause('t1');
        expect(q.getActiveTasks()[0].id).toBe('t2');
    });

    it('取消任务从队列移除', () => {
        const q = new DownloadQueue({ maxConcurrent: 1 });
        q.enqueue({ id: 't1', priority: 'normal' });
        q.enqueue({ id: 't2', priority: 'normal' });
        q.cancel('t2');
        expect(q.getTask('t2')).toBeUndefined();
    });

    it('调整优先级触发重新排序', () => {
        const q = new DownloadQueue({ maxConcurrent: 1 });
        q.enqueue({ id: 't1', priority: 'normal' });
        q.enqueue({ id: 't2', priority: 'normal' });
        q.enqueue({ id: 't3', priority: 'normal' });
        q.setPriority('t3', 'high');
        expect(q.getQueuedTasks()[0].id).toBe('t3');
    });
});
