// @ts-nocheck
const ResumeManager = require('../../main/modules/streaming/scheduler/ResumeManager');

describe('ResumeManager', () => {
    it('空状态返回起始位置 0', () => {
        const rm = new ResumeManager();
        expect(rm.getNextStart('task-1', 1000)).toBe(0);
    });

    it('添加单个 range 后返回结束位置', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        expect(rm.getNextStart('task-1', 1000)).toBe(500);
    });

    it('相邻 range 自动合并', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        rm.addRange('task-1', 500, 1000);
        expect(rm.getRanges('task-1')).toEqual([{ start: 0, end: 1000 }]);
    });

    it('重叠 range 自动合并', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        rm.addRange('task-1', 300, 800);
        expect(rm.getRanges('task-1')).toEqual([{ start: 0, end: 800 }]);
    });

    it('已下载字节累加正确', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        rm.addRange('task-1', 600, 1000);
        expect(rm.getDownloadedBytes('task-1')).toBe(900);
    });

    it('任务间隔离', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        rm.addRange('task-2', 0, 300);
        expect(rm.getDownloadedBytes('task-1')).toBe(500);
        expect(rm.getDownloadedBytes('task-2')).toBe(300);
    });

    it('序列化与反序列化', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        const serialized = rm.serialize('task-1');
        const rm2 = new ResumeManager();
        rm2.deserialize('task-1', serialized);
        expect(rm2.getRanges('task-1')).toEqual([{ start: 0, end: 500 }]);
    });

    it('判断是否已完整下载', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 1000);
        expect(rm.isComplete('task-1', 1000)).toBe(true);
        expect(rm.isComplete('task-1', 1001)).toBe(false);
    });

    it('清除任务数据', () => {
        const rm = new ResumeManager();
        rm.addRange('task-1', 0, 500);
        rm.clear('task-1');
        expect(rm.getRanges('task-1')).toEqual([]);
    });
});
