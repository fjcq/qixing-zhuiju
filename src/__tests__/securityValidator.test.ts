/**
 * 安全验证模块测试
 */

import {
    isValidUrl,
    validateMediaUrl,
    validateDeviceId,
    validateVideoData,
    validateSearchKeyword,
    validatePagination,
    validateSiteData,
    sanitizeInput
} from '../main/modules/securityValidator';

describe('安全验证模块', () => {
    describe('isValidUrl', () => {
        it('应该正确验证有效的HTTP URL', () => {
            expect(isValidUrl('http://example.com')).toBe(true);
            expect(isValidUrl('http://example.com/path')).toBe(true);
            expect(isValidUrl('http://example.com/path?query=1')).toBe(true);
        });

        it('应该正确验证有效的HTTPS URL', () => {
            expect(isValidUrl('https://example.com')).toBe(true);
            expect(isValidUrl('https://example.com/video.mp4')).toBe(true);
        });

        it('应该拒绝无效的URL', () => {
            expect(isValidUrl('')).toBe(false);
            expect(isValidUrl('not-a-url')).toBe(false);
            expect(isValidUrl('ftp://example.com')).toBe(false);
            expect(isValidUrl('javascript:alert(1)')).toBe(false);
            expect(isValidUrl(null as unknown as string)).toBe(false);
            expect(isValidUrl(undefined as unknown as string)).toBe(false);
            expect(isValidUrl(123 as unknown as string)).toBe(false);
        });

        it('应该拒绝过长的URL', () => {
            const longUrl = 'https://example.com/' + 'a'.repeat(2100);
            expect(isValidUrl(longUrl)).toBe(false);
        });
    });

    describe('validateMediaUrl', () => {
        it('应该接受有效的媒体URL', () => {
            const result = validateMediaUrl('https://example.com/video.mp4');
            expect(result.valid).toBe(true);
        });

        it('应该拒绝空URL', () => {
            const result = validateMediaUrl('');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('空');
        });

        it('应该拒绝危险协议', () => {
            const result = validateMediaUrl('javascript:alert(1)');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('不允许的协议');
        });

        it('应该拒绝data协议', () => {
            const result = validateMediaUrl('data:text/html,<script>alert(1)</script>');
            expect(result.valid).toBe(false);
        });

        it('应该拒绝file协议', () => {
            const result = validateMediaUrl('file:///etc/passwd');
            expect(result.valid).toBe(false);
        });
    });

    describe('validateDeviceId', () => {
        it('应该接受有效的设备ID', () => {
            const result = validateDeviceId('device-123');
            expect(result.valid).toBe(true);
        });

        it('应该接受UUID格式的设备ID', () => {
            const result = validateDeviceId('uuid-abc-123-xyz');
            expect(result.valid).toBe(true);
        });

        it('应该拒绝空设备ID', () => {
            const result = validateDeviceId('');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('空');
        });

        it('应该拒绝包含非法字符的设备ID', () => {
            const result = validateDeviceId('device<script>');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('非法字符');
        });

        it('应该拒绝过长的设备ID', () => {
            const longId = 'a'.repeat(300);
            const result = validateDeviceId(longId);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('超过限制');
        });
    });

    describe('validateVideoData', () => {
        it('应该接受有效的视频数据', () => {
            const result = validateVideoData({
                url: 'https://example.com/video.mp4',
                title: '测试视频'
            });
            expect(result.valid).toBe(true);
            expect(result.sanitized).toBeDefined();
        });

        it('应该拒绝无效的视频URL', () => {
            const result = validateVideoData({
                url: 'javascript:alert(1)'
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('URL无效');
        });

        it('应该拒绝非对象类型的视频数据', () => {
            expect(validateVideoData(null).valid).toBe(false);
            expect(validateVideoData('string').valid).toBe(false);
            expect(validateVideoData(123 as unknown as object).valid).toBe(false);
        });

        it('应该拒绝过长的标题', () => {
            const longTitle = 'a'.repeat(600);
            const result = validateVideoData({
                url: 'https://example.com/video.mp4',
                title: longTitle
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('标题长度超过限制');
        });

        it('应该验证集数索引', () => {
            const validResult = validateVideoData({
                url: 'https://example.com/video.mp4',
                episodeIndex: 5
            });
            expect(validResult.valid).toBe(true);

            const invalidResult = validateVideoData({
                url: 'https://example.com/video.mp4',
                episodeIndex: -1
            });
            expect(invalidResult.valid).toBe(false);
        });
    });

    describe('validateSearchKeyword', () => {
        it('应该接受有效的搜索关键词', () => {
            const result = validateSearchKeyword('复仇者联盟');
            expect(result.valid).toBe(true);
            expect(result.sanitized).toBe('复仇者联盟');
        });

        it('应该处理空关键词', () => {
            const result = validateSearchKeyword('');
            expect(result.valid).toBe(true);
            expect(result.sanitized).toBe('');
        });

        it('应该拒绝过长的关键词', () => {
            const longKeyword = 'a'.repeat(150);
            const result = validateSearchKeyword(longKeyword);
            expect(result.valid).toBe(false);
        });

        it('应该拒绝非字符串类型', () => {
            expect(validateSearchKeyword(123 as unknown as string).valid).toBe(false);
            expect(validateSearchKeyword(null as unknown as string).valid).toBe(true);
        });
    });

    describe('validatePagination', () => {
        it('应该使用默认值', () => {
            const result = validatePagination(undefined, undefined);
            expect(result.valid).toBe(true);
            if (result.sanitized) {
                expect(result.sanitized.page).toBe(1);
                expect(result.sanitized.pageSize).toBe(20);
            }
        });

        it('应该接受有效的分页参数', () => {
            const result = validatePagination(2, 50);
            expect(result.valid).toBe(true);
            if (result.sanitized) {
                expect(result.sanitized.page).toBe(2);
                expect(result.sanitized.pageSize).toBe(50);
            }
        });

        it('应该限制最大页面大小', () => {
            const result = validatePagination(1, 200);
            expect(result.valid).toBe(true);
            if (result.sanitized) {
                expect(result.sanitized.pageSize).toBe(100);
            }
        });

        it('应该拒绝无效的页码', () => {
            expect(validatePagination(0, 20).valid).toBe(false);
            expect(validatePagination(-1, 20).valid).toBe(false);
            expect(validatePagination('abc' as unknown as number, 20).valid).toBe(false);
        });
    });

    describe('validateSiteData', () => {
        it('应该接受有效的站点数据', () => {
            const result = validateSiteData({
                name: '测试站点',
                url: 'https://example.com/api.php/provide/vod/',
                type: 'json'
            });
            expect(result.valid).toBe(true);
            if (result.sanitized && typeof result.sanitized === 'object') {
                const sanitized = result.sanitized as { name?: string };
                expect(sanitized.name).toBe('测试站点');
            }
        });

        it('应该拒绝缺少必要字段的站点数据', () => {
            const result = validateSiteData({});
            expect(result.valid).toBe(false);
            expect(result.error).toContain('站点名称');
            expect(result.error).toContain('站点URL');
        });

        it('应该拒绝无效的站点类型', () => {
            const result = validateSiteData({
                name: '测试站点',
                url: 'https://example.com',
                type: 'invalid'
            });
            expect(result.valid).toBe(false);
            expect(result.error).toContain('站点类型');
        });

        it('应该拒绝无效的站点URL', () => {
            const result = validateSiteData({
                name: '测试站点',
                url: 'not-a-url'
            });
            expect(result.valid).toBe(false);
        });
    });

    describe('sanitizeInput', () => {
        it('应该移除危险的HTML标签', () => {
            expect(sanitizeInput('<script>alert(1)</script>')).toBe('scriptalert(1)/script');
        });

        it('应该移除javascript协议', () => {
            expect(sanitizeInput('javascript:alert(1)')).toBe('alert(1)');
        });

        it('应该移除事件处理器', () => {
            expect(sanitizeInput('onclick=alert(1)')).toBe('alert(1)');
        });

        it('应该处理非字符串输入', () => {
            expect(sanitizeInput(null as unknown as string)).toBe('');
            expect(sanitizeInput(undefined as unknown as string)).toBe('');
            expect(sanitizeInput(123 as unknown as string)).toBe('');
        });

        it('应该保留正常文本', () => {
            expect(sanitizeInput('正常的搜索关键词')).toBe('正常的搜索关键词');
        });
    });
});
