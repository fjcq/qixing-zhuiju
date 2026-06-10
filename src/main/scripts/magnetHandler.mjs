/**
 * 磁力链处理脚本
 * 使用系统Node.js运行，避免Electron内置Node 18的限制
 * 使用webtorrent v2.x，通过magnet-runtime独立目录安装
 *
 * 通信协议：通过stdin/stdout JSON消息通信
 * 输入：{ action: 'resolve'|'play', magnetUri, fileName?, infoHash? }
 * 输出：{ type: 'files'|'progress'|'ready'|'error', ... }
 *
 * 注意：ESM的import不使用NODE_PATH，所以webtorrent必须通过createRequire加载
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

// ESM的import不支持NODE_PATH，使用createRequire通过CommonJS加载webtorrent
const require = createRequire(import.meta.url);
const WebTorrentModule = require('webtorrent');
// ESM模块通过require加载时，构造函数在.default属性上
const WebTorrent = WebTorrentModule.default || WebTorrentModule;

// 全局错误处理，防止子进程崩溃
process.on('uncaughtException', err => {
    // 忽略客户端关闭连接导致的流错误
    if (err.message && err.message.includes('Writable stream closed prematurely')) {
        return;
    }
    sendMessage({ type: 'error', error: `未捕获异常: ${err.message}` });
});

process.on('unhandledRejection', err => {
    if (err && err.message && err.message.includes('Writable stream closed prematurely')) {
        return;
    }
    sendMessage({ type: 'error', error: `未处理的Promise拒绝: ${err?.message || err}` });
});

// 全局客户端实例
let client = null;
let currentTorrent = null;
let fileServer = null;
let fileServerPort = 0;

// 临时目录
const TEMP_DIR = path.join(os.tmpdir(), 'qixing-torrents');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * 可靠的tracker列表（已测试验证可达性，按响应速度排序）
 * 优先使用HTTP/HTTPS tracker（国内网络友好），UDP tracker作为备用
 * 数据来源：ngosang/trackerslist + CSDN国内电信测试 + 自测验证
 */
const TRACKER_LIST = [
    // 国内IP直连tracker（响应最快，122-134ms）
    'http://211.75.210.221:6969/announce',
    'http://60.249.37.20:80/announce',
    'http://211.75.205.189:6969/announce',
    // 国际HTTP tracker（已验证可达，444-630ms）
    'http://216.144.239.90:6969/announce',
    'http://95.217.167.10:6969/announce',
    'http://107.189.2.131:1337/announce',
    'http://37.120.182.83:80/announce',
    'http://tracker.dler.org:6969/announce',
    'http://tracker2.dler.org:80/announce',
    'http://tracker.waaa.moe:6969/announce',
    // HTTPS tracker（加密传输，国内更稳定）
    'https://tracker.zhuqiy.com:443/announce',
    'https://tracker.nekomi.cn:443/announce',
    // 国内域名tracker
    'http://tracker.renfei.net:8080/announce',
    'http://tracker1.itzmx.com:8080/announce',
    'http://tracker.zhuqiy.top:80/announce',
    // WSS tracker（WebSocket，可穿透防火墙）
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    // UDP tracker（备用，国内网络可能不稳定）
    'udp://93.158.213.92:1337/announce',
    'udp://216.144.239.90:6969/announce',
    'udp://95.217.167.10:6969/announce',
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://explodie.org:6969/announce',
    'udp://p4p.arenabg.com:1337/announce',
    'udp://tracker.dler.org:6969/announce',
    'udp://exodus.desync.com:6969/announce'
];

/**
 * DHT bootstrap节点（包含国内可达的节点）
 */
const DHT_BOOTSTRAP_NODES = [
    'router.bittorrent.com:6881',
    'router.utorrent.com:6881',
    'dht.transmissionbt.com:6881',
    'dht.aelitis.com:6881',
    'router.silotis.us:6881'
];

/**
 * 当前使用的tracker列表（可动态更新）
 */
let activeTrackers = [...TRACKER_LIST];

/**
 * 从ngosang/trackerslist获取最新tracker列表
 * 每日自动更新，合并到本地列表中
 */
async function fetchLatestTrackers() {
    const urls = [
        'https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best.txt',
        'https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_all_http.txt'
    ];

    const fetched = [];
    for (const url of urls) {
        try {
            const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (resp.ok) {
                const text = await resp.text();
                const trackers = text.split('\n')
                    .map(line => line.trim())
                    .filter(line => line && line.startsWith('http'));
                fetched.push(...trackers);
            }
        } catch (err) {
            sendMessage({ type: 'log', message: `获取tracker列表失败(${url}): ${err.message}` });
        }
    }

    if (fetched.length > 0) {
        // 合并去重，远程tracker排在本地已验证tracker之后
        const existing = new Set(activeTrackers);
        const newTrackers = fetched.filter(t => !existing.has(t));
        activeTrackers = [...TRACKER_LIST, ...newTrackers];
        sendMessage({ type: 'log', message: `tracker列表已更新: 本地${TRACKER_LIST.length}个 + 远程${newTrackers.length}个` });
    }
}

// 启动时异步获取最新tracker列表
fetchLatestTrackers();
// 每6小时更新一次
setInterval(fetchLatestTrackers, 6 * 60 * 60 * 1000);

/**
 * 发送JSON消息到父进程
 */
function sendMessage(msg) {
    process.stdout.write(JSON.stringify(msg) + '\n');
}

/**
 * 获取或创建WebTorrent客户端
 */
function getClient() {
    if (!client) {
        client = new WebTorrent({
            maxConns: 200,
            dht: {
                bootstrap: DHT_BOOTSTRAP_NODES,
                concurrency: 16
            },
            tracker: true,
            utp: true,
            lsd: true
        });
        client.on('error', err => {
            sendMessage({ type: 'error', error: err.message });
        });

        // 监听DHT事件
        client.dht?.on('listening', () => {
            sendMessage({ type: 'log', message: 'DHT正在监听' });
        });
        // peer事件触发频率极高（DHT入网后每秒数十上百个），按"遇错才输出"策略静默
        client.dht?.on('peer', (peer) => {
            // 静默处理，避免日志刷屏
        });
        client.dht?.on('warning', err => {
            sendMessage({ type: 'log', message: `DHT警告: ${err.message}` });
        });
    }
    return client;
}

/**
 * 解析磁力链接，获取文件列表
 * 先尝试HTTP缓存API，再使用P2P
 */
async function resolveMagnet(magnetUri, infoHash) {
    const c = getClient();

    // 检查是否已存在相同infoHash且元数据已就绪的torrent
    const existingTorrent = c.get(infoHash);
    if (existingTorrent && existingTorrent.files && existingTorrent.files.length > 0) {
        sendMessage({ type: 'log', message: '复用已存在的torrent实例' });
        currentTorrent = existingTorrent;
        const files = existingTorrent.files.map(f => ({
            name: f.name,
            length: f.length,
            path: f.path
        }));
        return files;
    }

    // 先尝试HTTP缓存API获取torrent文件
    const torrentBuffer = await fetchTorrentFromCache(infoHash);

    let torrentId = magnetUri;
    if (torrentBuffer) {
        torrentId = torrentBuffer;
        sendMessage({ type: 'log', message: '使用HTTP缓存API获取的torrent文件' });
    }

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('解析磁力链接超时（60秒），请检查网络连接或尝试其他链接'));
        }, 60000);

        try {
            sendMessage({ type: 'log', message: `使用${activeTrackers.length}个tracker: ${activeTrackers.slice(0, 5).join(', ')}...` });

            // 捕获重复添加错误，降级为等待已有torrent
            let addFailed = false;
            try {
                c.add(torrentId, {
                    path: TEMP_DIR,
                    announce: activeTrackers
                }, torrent => {
                    clearTimeout(timeout);
                    currentTorrent = torrent;

                    // 输出torrent使用的所有tracker
                    const trackerUrls = torrent.announce || [];
                    sendMessage({ type: 'log', message: `torrent使用${trackerUrls.length}个tracker` });

                    // 监听torrent事件
                    torrent.on('wire', (wire, addr) => {
                        sendMessage({ type: 'wire', address: addr });
                    });

                    torrent.on('done', () => {
                        sendMessage({ type: 'done' });
                    });

                    torrent.on('warning', err => {
                        sendMessage({ type: 'warning', message: err.message });
                    });

                    torrent.on('error', err => {
                        sendMessage({ type: 'error', error: err.message });
                    });

                    // 返回文件列表
                    const files = torrent.files.map(f => ({
                        name: f.name,
                        length: f.length,
                        path: f.path
                    }));

                    resolve(files);
                });
            } catch (addErr) {
                // 磁力链接已存在（重复添加），尝试获取并等待已有torrent
                if (addErr.message && addErr.message.includes('duplicate')) {
                    addFailed = true;
                    sendMessage({ type: 'log', message: '检测到重复torrent，等待元数据就绪...' });
                } else {
                    throw addErr;
                }
            }

            // 降级方案：等待已存在的torrent完成元数据解析
            if (addFailed) {
                const pendingTorrent = c.get(infoHash);
                if (pendingTorrent && typeof pendingTorrent.on === 'function') {
                    pendingTorrent.on('ready', () => {
                        clearTimeout(timeout);
                        currentTorrent = pendingTorrent;
                        const files = pendingTorrent.files.map(f => ({
                            name: f.name,
                            length: f.length,
                            path: f.path
                        }));
                        resolve(files);
                    });
                    pendingTorrent.on('error', err => {
                        clearTimeout(timeout);
                        reject(err);
                    });
                } else {
                    clearTimeout(timeout);
                    reject(new Error('无法获取已有的torrent实例'));
                }
            }
        } catch (err) {
            clearTimeout(timeout);
            reject(err);
        }

        c.on('error', err => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

/**
 * 验证Buffer是否为有效的torrent文件
 * torrent文件本质上是Bencode编码的字典，必须以'd' (0x64) 开头
 * 缓存服务（如btcache.me）在找不到资源时会返回HTTP 200 + HTML错误页，
 * 必须用此函数过滤，否则后续webtorrent.add()会抛"Invalid torrent identifier"
 * @param {Buffer} buf - 待验证的Buffer
 * @returns {boolean}
 */
function isValidTorrentBuffer(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 2) {
        return false;
    }
    // Bencode字典以'd' (0x64) 开头，其他类型（列表'l'、整数'i'、字符串长度数字）都不合法
    return buf[0] === 0x64;
}

/**
 * 通过HTTP缓存API获取torrent文件
 */
async function fetchTorrentFromCache(infoHash) {
    if (!infoHash) return null;

    const upperHash = infoHash.toUpperCase();
    const cachePath = path.join(TEMP_DIR, `${infoHash}.torrent`);

    // 如果本地已有缓存，先校验有效性；HTML错误页等无效内容会导致webtorrent解析失败
    if (fs.existsSync(cachePath)) {
        try {
            const cachedBuf = fs.readFileSync(cachePath);
            if (isValidTorrentBuffer(cachedBuf)) {
                sendMessage({ type: 'log', message: '使用本地缓存的torrent文件' });
                return cachedBuf;
            }
            // 缓存内容无效（可能是上次保存的HTML错误页），删除后重新从网络获取
            sendMessage({ type: 'log', message: '本地缓存torrent文件无效（首字节非Bencode字典标识），已删除并重新获取' });
            try { fs.unlinkSync(cachePath); } catch (e) { /* 忽略删除失败 */ }
        } catch (e) {
            sendMessage({ type: 'log', message: `读取本地缓存失败: ${e.message}` });
        }
    }

    const cacheUrls = [
        `https://itorrents.org/torrent/${upperHash}.torrent`,
        `https://btcache.me/torrent/${upperHash}`,
        `https://torrage.info/torrent/${upperHash}.torrent`
    ];

    for (let i = 0; i < cacheUrls.length; i++) {
        try {
            sendMessage({ type: 'log', message: `尝试缓存服务 ${i + 1}/${cacheUrls.length}: ${cacheUrls[i]}` });

            const response = await fetch(cacheUrls[i], {
                signal: AbortSignal.timeout(15000)
            });

            if (response.ok) {
                const buffer = Buffer.from(await response.arrayBuffer());
                if (isValidTorrentBuffer(buffer)) {
                    // 缓存到本地
                    fs.writeFileSync(cachePath, buffer);
                    sendMessage({ type: 'log', message: `缓存服务返回数据, 大小: ${buffer.length} 字节` });
                    return buffer;
                }
                // 内容不是torrent文件（常见于404页面返回HTML），跳过此服务
                const preview = buffer.subarray(0, Math.min(40, buffer.length)).toString('utf8').replace(/[\r\n]/g, ' ');
                sendMessage({ type: 'log', message: `缓存服务 ${i + 1} 返回非torrent内容（首字节0x${buffer[0]?.toString(16) || '00'}，前40字节: "${preview}"），跳过` });
            }
        } catch (err) {
            sendMessage({ type: 'log', message: `缓存服务 ${i + 1} 失败: ${err.message}` });
        }
    }

    return null;
}

/**
 * 播放磁力链接中的指定文件
 * 创建HTTP流服务器，边下载边播放
 * @param {string} magnetUri - 磁力链接
 * @param {string} fileName - 文件名
 * @param {string} infoHash - info hash
 * @param {string} cachedTorrentPath - 主进程resolve阶段已缓存的torrent文件路径（可选）
 */
async function playMagnetFile(magnetUri, fileName, infoHash, cachedTorrentPath) {
    const c = getClient();

    // 优先使用主进程已缓存的torrent文件，避免重复网络获取
    let torrentId = magnetUri;

    // 统一使用本地缓存路径读取（主进程传入的cachedTorrentPath本质也是同一个文件）
    const localCachePath = path.join(TEMP_DIR, `${infoHash}.torrent`);
    let usedLocalCache = false;
    if (fs.existsSync(localCachePath)) {
        try {
            const cachedBuf = fs.readFileSync(localCachePath);
            if (isValidTorrentBuffer(cachedBuf)) {
                torrentId = cachedBuf;
                usedLocalCache = true;
                sendMessage({
                    type: 'log', message: cachedTorrentPath === localCachePath
                        ? '使用主进程缓存的torrent文件'
                        : '使用本地缓存的torrent文件'
                });
            } else {
                // 缓存内容无效（HTML错误页等），删除后走网络获取
                sendMessage({ type: 'log', message: '缓存的torrent文件无效（首字节非Bencode字典标识），已删除并重新获取' });
                try { fs.unlinkSync(localCachePath); } catch (e) { /* 忽略删除失败 */ }
            }
        } catch (e) {
            sendMessage({ type: 'log', message: `读取本地缓存失败: ${e.message}` });
        }
    }

    // 没有有效缓存时，最后尝试从网络获取
    if (!usedLocalCache) {
        const torrentBuffer = await fetchTorrentFromCache(infoHash);
        if (torrentBuffer) {
            torrentId = torrentBuffer;
            sendMessage({ type: 'log', message: '使用HTTP缓存API获取的torrent文件' });
        }
    }

    return new Promise((resolve, reject) => {
        let peerCheckInterval = null;
        let noPeerTimeout = null;
        let slowTimeout = null;

        // 总超时：2分钟
        const totalTimeout = setTimeout(() => {
            clearInterval(peerCheckInterval);
            clearTimeout(noPeerTimeout);
            clearTimeout(slowTimeout);
            reject(new Error('连接超时（2分钟），该资源可能无人做种或网络连接受限'));
        }, 120000);

        try {
            // 检查是否已有元数据就绪的torrent可复用
            const reuseTorrent = (currentTorrent && currentTorrent.infoHash === infoHash.toLowerCase())
                ? currentTorrent
                : c.get(infoHash);
            if (reuseTorrent && reuseTorrent.files && reuseTorrent.files.length > 0) {
                sendMessage({ type: 'log', message: '复用已存在的torrent实例' });
                clearTimeout(totalTimeout);
                currentTorrent = reuseTorrent;
                startFileStream(reuseTorrent, fileName, resolve, reject);
                return;
            }

            sendMessage({ type: 'log', message: `播放使用${activeTrackers.length}个tracker` });

            // 发送连接中状态
            sendMessage({
                type: 'progress',
                fileName,
                progress: 0,
                downloaded: 0,
                total: 0,
                wires: 0,
                downloadSpeed: 0,
                numPeers: 0,
                status: 'connecting'
            });

            // 捕获重复添加错误，降级为等待已有torrent
            let addFailed = false;
            try {
                c.add(torrentId, {
                    path: TEMP_DIR,
                    announce: activeTrackers
                }, torrent => {
                    currentTorrent = torrent;

                    // 输出torrent使用的所有tracker
                    const trackerUrls = torrent.announce || [];
                    sendMessage({ type: 'log', message: `torrent使用${trackerUrls.length}个tracker` });

                    // 定期检查peer连接状态
                    peerCheckInterval = setInterval(() => {
                        const numPeers = torrent.numPeers || 0;
                        const wires = torrent.wires ? torrent.wires.length : 0;
                        const speed = Number(torrent.downloadSpeed);

                        if (numPeers === 0 && wires === 0) {
                            sendMessage({
                                type: 'progress',
                                fileName,
                                progress: Math.round(torrent.progress * 100),
                                downloaded: Number(torrent.downloaded),
                                total: Number(torrent.length),
                                wires,
                                downloadSpeed: speed,
                                numPeers,
                                status: 'no-peers'
                            });
                        } else if (wires > 0 && speed === 0) {
                            sendMessage({
                                type: 'progress',
                                fileName,
                                progress: Math.round(torrent.progress * 100),
                                downloaded: Number(torrent.downloaded),
                                total: Number(torrent.length),
                                wires,
                                downloadSpeed: speed,
                                numPeers,
                                status: 'connected-waiting'
                            });
                        } else {
                            // 正常下载中或下载完成：始终发送进度
                            const progressPercent = Math.round(torrent.progress * 100);
                            const isComplete = progressPercent >= 100;
                            sendMessage({
                                type: 'progress',
                                fileName,
                                progress: progressPercent,
                                downloaded: Number(torrent.downloaded),
                                total: Number(torrent.length),
                                wires,
                                downloadSpeed: speed,
                                numPeers,
                                status: isComplete ? 'completed' : 'downloading'
                            });
                        }
                    }, 5000);

                    // 30秒无peer连接警告
                    noPeerTimeout = setTimeout(() => {
                        if (torrent.numPeers === 0 && torrent.wires.length === 0) {
                            sendMessage({
                                type: 'progress',
                                fileName,
                                progress: 0,
                                downloaded: 0,
                                total: Number(torrent.length),
                                wires: 0,
                                downloadSpeed: 0,
                                numPeers: 0,
                                status: 'no-peers-warning'
                            });
                        }
                    }, 30000);

                    // 60秒无下载速度警告
                    slowTimeout = setTimeout(() => {
                        if (torrent.downloadSpeed === 0 && torrent.progress === 0) {
                            sendMessage({
                                type: 'progress',
                                fileName,
                                progress: 0,
                                downloaded: Number(torrent.downloaded),
                                total: Number(torrent.length),
                                wires: torrent.wires.length,
                                downloadSpeed: 0,
                                numPeers: torrent.numPeers,
                                status: 'slow-warning'
                            });
                        }
                    }, 60000);

                    // 监听下载进度（resolve 阶段，用于解析进度条，对应 magnet-progress 事件）
                    // 高频回调但只影响主窗口的外链页面，播放器窗口不监听此事件
                    torrent.on('download', bytes => {
                        const file = torrent.files.find(f => f.name === fileName);
                        if (file) {
                            sendMessage({
                                type: 'progress',
                                fileName: file.name,
                                progress: Math.round(torrent.progress * 100),
                                downloaded: Number(torrent.downloaded),
                                total: Number(torrent.length),
                                wires: torrent.wires.length,
                                downloadSpeed: Number(torrent.downloadSpeed),
                                numPeers: torrent.numPeers,
                                eta: calcEta(torrent),
                                status: 'downloading'
                            });
                        }
                    });

                    torrent.on('done', () => {
                        clearInterval(peerCheckInterval);
                        clearTimeout(noPeerTimeout);
                        clearTimeout(slowTimeout);
                        clearTimeout(totalTimeout);
                        sendMessage({
                            type: 'progress',
                            fileName,
                            progress: 100,
                            downloaded: Number(torrent.length),
                            total: Number(torrent.length),
                            wires: torrent.wires.length,
                            downloadSpeed: 0,
                            numPeers: torrent.numPeers,
                            status: 'done'
                        });
                    });

                    startFileStream(torrent, fileName, resolve, reject);
                });
            } catch (addErr) {
                // 磁力链接已存在（重复添加），尝试获取并等待已有torrent
                if (addErr.message && addErr.message.includes('duplicate')) {
                    addFailed = true;
                    sendMessage({ type: 'log', message: '检测到重复torrent，等待元数据就绪...' });
                } else {
                    throw addErr;
                }
            }

            // 降级方案：等待已存在的torrent完成元数据解析
            if (addFailed) {
                const pendingTorrent = c.get(infoHash);
                if (pendingTorrent && typeof pendingTorrent.on === 'function') {
                    pendingTorrent.on('ready', () => {
                        clearTimeout(totalTimeout);
                        currentTorrent = pendingTorrent;
                        startFileStream(pendingTorrent, fileName, resolve, reject);
                    });
                    pendingTorrent.on('error', err => {
                        clearTimeout(totalTimeout);
                        reject(err);
                    });
                } else {
                    clearTimeout(totalTimeout);
                    reject(new Error('无法获取已有的torrent实例'));
                }
            }
        } catch (err) {
            clearTimeout(totalTimeout);
            clearInterval(peerCheckInterval);
            clearTimeout(noPeerTimeout);
            clearTimeout(slowTimeout);
            reject(err);
        }

        c.on('error', err => {
            clearTimeout(totalTimeout);
            clearInterval(peerCheckInterval);
            clearTimeout(noPeerTimeout);
            clearTimeout(slowTimeout);
            reject(err);
        });
    });
}

/**
 * 创建HTTP文件流服务器
 */
function startFileStream(torrent, fileName, resolve, reject) {
    const file = torrent.files.find(f => f.name === fileName);
    if (!file) {
        reject(new Error(`文件不存在: ${fileName}`));
        return;
    }

    // 取消选择其他文件，只下载选中的文件
    torrent.files.forEach(f => {
        if (f.name !== fileName) {
            f.deselect();
        }
    });

    // 创建HTTP流服务器（无论文件是否下载完成，都通过HTTP提供，避免file://协议限制）
    if (fileServer) {
        try { fileServer.close(); } catch (e) { /* 忽略 */ }
    }

    // 检查文件是否已下载完成
    const filePath = path.join(TEMP_DIR, file.path);
    const isDownloaded = fs.existsSync(filePath) && fs.statSync(filePath).size === file.length;
    if (isDownloaded) {
        sendMessage({ type: 'log', message: '文件已下载完成，通过HTTP流服务器播放本地文件' });
        // 文件已下载完成：延迟发送一次 progress（100%），让播放器信息栏显示"已完成"状态
        // 延迟确保播放器窗口 webContents 已就绪
        setTimeout(() => {
            sendMessage({
                type: 'progress',
                fileName,
                progress: 100,
                downloaded: Number(file.length),
                total: Number(file.length),
                wires: 0,
                downloadSpeed: 0,
                numPeers: 0,
                status: 'completed'
            });
        }, 300);
    } else {
        // 文件未下载完成：立即发送一次 connecting 状态，并启动定期检查
        sendMessage({
            type: 'progress',
            fileName,
            progress: Math.round((torrent.progress || 0) * 100),
            downloaded: Number(torrent.downloaded || 0),
            total: Number(file.length),
            wires: torrent.wires ? torrent.wires.length : 0,
            downloadSpeed: Number(torrent.downloadSpeed || 0),
            numPeers: torrent.numPeers || 0,
            eta: calcEta(torrent),
            status: 'downloading'
        });
        // 启动定期进度上报（每 1 秒）
        // 频率比之前 5 秒更平滑，同时控制 IPC 流量在合理范围（每条 ~150B，约 150B/s）
        // 不再用 torrent.on('download') 高频回调，避免刷爆 IPC 通道
        const streamPeerCheckInterval = setInterval(() => {
            const numPeers = torrent.numPeers || 0;
            const wires = torrent.wires ? torrent.wires.length : 0;
            const speed = Number(torrent.downloadSpeed || 0);
            const progressPercent = Math.round((torrent.progress || 0) * 100);
            sendMessage({
                type: 'progress',
                fileName,
                progress: progressPercent,
                downloaded: Number(torrent.downloaded || 0),
                total: Number(file.length),
                wires,
                downloadSpeed: speed,
                numPeers,
                eta: calcEta(torrent),
                status: progressPercent >= 100 ? 'completed' : (wires > 0 ? 'downloading' : 'connecting')
            });
            // 下载完成后停止上报
            if (progressPercent >= 100) {
                clearInterval(streamPeerCheckInterval);
            }
        }, 1000);
    }

    fileServer = http.createServer((req, res) => {
        // 支持Range请求，实现拖动进度条
        const range = req.headers.range;
        const fileSize = file.length;

        // 客户端关闭连接时静默处理，避免FileStream崩溃
        res.on('close', () => {
            // 连接被客户端关闭（正常行为，如seek/暂停/关闭播放器）
        });

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': getContentType(fileName),
                'Access-Control-Allow-Origin': '*'
            });

            if (isDownloaded) {
                // 文件已下载完成，直接从本地文件读取（更快更稳定）
                const readStream = fs.createReadStream(filePath, { start, end });
                readStream.on('error', () => { /* 忽略流错误 */ });
                readStream.pipe(res).on('error', () => { /* 忽略管道错误 */ });
            } else {
                // 文件未下载完成，通过webtorrent流式读取
                const stream = file.createReadStream({ start, end });
                stream.on('error', () => { /* 静默处理流错误 */ });
                stream.pipe(res).on('error', () => { /* 静默处理管道错误 */ });
            }
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': getContentType(fileName),
                'Access-Control-Allow-Origin': '*'
            });

            if (isDownloaded) {
                const readStream = fs.createReadStream(filePath);
                readStream.on('error', () => { /* 忽略流错误 */ });
                readStream.pipe(res).on('error', () => { /* 忽略管道错误 */ });
            } else {
                const stream = file.createReadStream();
                stream.on('error', () => { /* 静默处理流错误 */ });
                stream.pipe(res).on('error', () => { /* 静默处理管道错误 */ });
            }
        }
    });

    fileServer.listen(0, () => {
        fileServerPort = fileServer.address().port;
        const encodedName = encodeURIComponent(fileName);
        const streamUrl = `http://localhost:${fileServerPort}/${encodedName}`;

        sendMessage({ type: 'log', message: `文件流服务器启动: 端口${fileServerPort}` });

        resolve({
            streamUrl,
            isLocal: false
        });
    });

    fileServer.on('error', err => {
        reject(new Error(`文件流服务器启动失败: ${err.message}`));
    });
}

/**
 * 计算剩余下载时间（秒）
 * 优先用 webtorrent 的 timeRemaining，否则用剩余字节 / 当前速度
 * @param {object} torrent webtorrent 实例
 * @returns {number|null} 剩余秒数；无法计算时返回 null
 */
function calcEta(torrent) {
    if (!torrent) return null;
    if (typeof torrent.timeRemaining === 'number' && isFinite(torrent.timeRemaining) && torrent.timeRemaining > 0) {
        return Math.round(torrent.timeRemaining / 1000);
    }
    const speed = Number(torrent.downloadSpeed || 0);
    const remaining = Number(torrent.length || 0) - Number(torrent.downloaded || 0);
    if (speed > 0 && remaining > 0) {
        return Math.round(remaining / speed);
    }
    return null;
}

/**
 * 根据文件扩展名获取Content-Type
 */
function getContentType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const types = {
        '.mp4': 'video/mp4',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.webm': 'video/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.aac': 'audio/aac'
    };
    return types[ext] || 'application/octet-stream';
}

/**
 * 销毁当前torrent和客户端
 */
function destroy() {
    if (fileServer) {
        try { fileServer.close(); } catch (e) { /* 忽略关闭错误 */ }
        fileServer = null;
    }
    if (currentTorrent) {
        try { currentTorrent.destroy(); } catch (e) { /* 忽略销毁错误 */ }
        currentTorrent = null;
    }
    if (client) {
        try { client.destroy(); } catch (e) { /* 忽略销毁错误 */ }
        client = null;
    }
    sendMessage({ type: 'destroyed' });
}

/**
 * 处理stdin消息
 */
process.stdin.setEncoding('utf8');
let inputBuffer = '';

process.stdin.on('data', chunk => {
    inputBuffer += chunk;
    const lines = inputBuffer.split('\n');
    inputBuffer = lines.pop(); // 保留未完成的行

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const msg = JSON.parse(line);

            switch (msg.action) {
                case 'resolve':
                    resolveMagnet(msg.magnetUri, msg.infoHash)
                        .then(files => {
                            sendMessage({ id: msg.id, type: 'files', files });
                        })
                        .catch(err => {
                            sendMessage({ id: msg.id, type: 'error', error: err.message });
                        });
                    break;

                case 'play':
                    playMagnetFile(msg.magnetUri, msg.fileName, msg.infoHash, msg.cachedTorrentPath)
                        .then(result => {
                            sendMessage({ id: msg.id, type: 'ready', streamUrl: result.streamUrl, isLocal: result.isLocal });
                        })
                        .catch(err => {
                            sendMessage({ id: msg.id, type: 'error', error: err.message });
                        });
                    break;

                case 'destroy':
                    destroy();
                    break;

                default:
                    sendMessage({ id: msg.id, type: 'error', error: `未知操作: ${msg.action}` });
            }
        } catch (err) {
            sendMessage({ type: 'error', error: `消息解析失败: ${err.message}` });
        }
    }
});

process.stdin.on('end', () => {
    destroy();
});

// 进程退出时清理
process.on('exit', () => {
    destroy();
});

process.on('SIGINT', () => {
    destroy();
    process.exit(0);
});

sendMessage({ type: 'ready', message: '磁力链处理脚本已启动' });
