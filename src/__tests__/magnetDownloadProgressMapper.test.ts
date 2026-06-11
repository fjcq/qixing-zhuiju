/**
 * magnetDownloadProgressMapper 单元测试
 * 验证子进程 download progress 事件 → 阶段对象映射逻辑
 */

import { mapMagnetDownloadProgress } from '../renderer/js/utils/magnetDownloadProgressMapper.js';

describe('mapMagnetDownloadProgress', () => {
    test('connecting 状态映射到 P2.1 阶段', () => {
        const result = mapMagnetDownloadProgress({
            status: 'connecting',
            progress: 0,
            numPeers: 0
        });
        expect(result.stageId).toBe('P2.1');
        expect(result.stageText).toContain('连接');
        expect(result.progress).toBe(10);
        expect(result.variant).toBe('info');
    });

    test('downloading 状态映射到 P2.2 阶段,progress 透传', () => {
        const result = mapMagnetDownloadProgress({
            status: 'downloading',
            progress: 45,
            numPeers: 12,
            downloadSpeed: 1024000
        });
        expect(result.stageId).toBe('P2.2');
        expect(result.stageText).toContain('45%');
        expect(result.stageText).toContain('12');
        expect(result.progress).toBe(45);
        expect(result.variant).toBe('info');
    });

    test('no-peers-warning 状态映射到 warning variant', () => {
        const result = mapMagnetDownloadProgress({
            status: 'no-peers-warning',
            progress: 0,
            numPeers: 0
        });
        expect(result.variant).toBe('warning');
        expect(result.stageText).toContain('peer');
    });

    test('slow-warning 状态映射到 warning variant', () => {
        const result = mapMagnetDownloadProgress({
            status: 'slow-warning',
            progress: 5
        });
        expect(result.variant).toBe('warning');
    });

    test('completed 状态映射到 P6 success variant', () => {
        const result = mapMagnetDownloadProgress({
            status: 'completed',
            progress: 100
        });
        expect(result.stageId).toBe('P6');
        expect(result.variant).toBe('success');
    });

    test('未知 status 退回到 info variant 但保留原始状态文本', () => {
        const result = mapMagnetDownloadProgress({
            status: 'some-future-status',
            progress: 50
        });
        expect(result.variant).toBe('info');
        expect(result.progress).toBe(50);
    });

    test('progress 缺省时使用 0,不抛错', () => {
        const result = mapMagnetDownloadProgress({ status: 'connecting' });
        expect(result.progress).toBe(0);
    });

    test('progress 异常值(NaN/负数)被钳制到 0-100', () => {
        expect(mapMagnetDownloadProgress({ status: 'downloading', progress: NaN }).progress).toBe(0);
        expect(mapMagnetDownloadProgress({ status: 'downloading', progress: -10 }).progress).toBe(0);
        expect(mapMagnetDownloadProgress({ status: 'downloading', progress: 150 }).progress).toBe(100);
    });
});
