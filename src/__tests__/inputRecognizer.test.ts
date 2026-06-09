/**
 * inputRecognizer 单元测试
 * 纯函数：detectInputType(str) → { type, ...payload }
 */

const {
    detectInputType,
    TYPE_URL,
    TYPE_LOCAL,
    TYPE_MAGNET,
    TYPE_UNKNOWN,
    TYPE_EMPTY
} = require('../renderer/js/controllers/inputRecognizer');

describe('detectInputType', () => {
    describe('magnet 识别', () => {
        it('应识别标准 magnet: URI', () => {
            const r = detectInputType('magnet:?xt=urn:btih:abc123def456abc123def456abc123def45678ab');
            expect(r.type).toBe(TYPE_MAGNET);
            expect(r.hash).toBe('abc123def456abc123def456abc123def45678ab');
        });

        it('应自动补全 40 位 hex Info Hash 的 magnet: 前缀', () => {
            const r = detectInputType('ABC123def456abc123def456abc123def45678ab');
            expect(r.type).toBe(TYPE_MAGNET);
            expect(r.hash).toBe('ABC123def456abc123def456abc123def45678ab');
            expect(r.magnetUri).toBe('magnet:?xt=urn:btih:ABC123def456abc123def456abc123def45678ab');
        });

        it('应自动补全 32 位 base32 Info Hash 的 magnet: 前缀', () => {
            const r = detectInputType('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567');
            expect(r.type).toBe(TYPE_MAGNET);
            expect(r.magnetUri).toContain('magnet:?xt=urn:btih:');
        });
    });

    describe('URL 识别', () => {
        it('应识别 .m3u8 https URL', () => {
            const r = detectInputType('https://cdn.example.com/video.m3u8');
            expect(r.type).toBe(TYPE_URL);
            expect(r.subtype).toBe('m3u8');
        });

        it('应识别 .mp4 https URL', () => {
            const r = detectInputType('https://x.com/a.mp4');
            expect(r.type).toBe(TYPE_URL);
            expect(r.subtype).toBe('mp4');
        });

        it('应识别无视频后缀的 https URL（待探测）', () => {
            const r = detectInputType('https://example.com/play?id=123');
            expect(r.type).toBe(TYPE_URL);
        });

        it('应识别 http:// URL', () => {
            const r = detectInputType('http://example.com/a.flv');
            expect(r.type).toBe(TYPE_URL);
        });
    });

    describe('本地文件识别', () => {
        it('应识别 file:// URI', () => {
            const r = detectInputType('file:///C:/movies/a.mp4');
            expect(r.type).toBe(TYPE_LOCAL);
            expect(r.path).toBe('C:\\movies\\a.mp4');
        });

        it('应识别 Windows 盘符路径', () => {
            const r = detectInputType('C:\\movies\\a.mp4');
            expect(r.type).toBe(TYPE_LOCAL);
            expect(r.path).toBe('C:\\movies\\a.mp4');
        });

        it('应识别 UNC 路径', () => {
            const r = detectInputType('\\\\server\\share\\a.mp4');
            expect(r.type).toBe(TYPE_LOCAL);
            expect(r.path).toBe('\\\\server\\share\\a.mp4');
        });

        it('应识别 POSIX 绝对路径', () => {
            const r = detectInputType('/home/user/movie.mp4');
            expect(r.type).toBe(TYPE_LOCAL);
            expect(r.path).toBe('/home/user/movie.mp4');
        });
    });

    describe('未知与空', () => {
        it('应将普通字符串识别为 unknown', () => {
            expect(detectInputType('hello world').type).toBe(TYPE_UNKNOWN);
        });

        it('应将空字符串识别为 empty', () => {
            expect(detectInputType('').type).toBe(TYPE_EMPTY);
        });

        it('应将纯空格识别为 empty', () => {
            expect(detectInputType('   ').type).toBe(TYPE_EMPTY);
        });
    });
});
