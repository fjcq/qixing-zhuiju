// 直接的UPnP设备发现工具
const dgram = require('dgram');

class SimpleUPnPDiscovery {
    constructor() {
        this.devices = [];
    }

    async discover() {
        console.log('开始简单UPnP设备发现...');

        return new Promise((resolve) => {
            const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

            socket.on('message', (msg, rinfo) => {
                const message = msg.toString();
                console.log(`\n收到来自 ${rinfo.address}:${rinfo.port} 的响应:`);
                console.log('-'.repeat(50));
                console.log(message);
                console.log('-'.repeat(50));

                // 解析响应头
                const headers = this.parseHeaders(message);

                if (headers.location) {
                    const device = {
                        address: rinfo.address,
                        port: rinfo.port,
                        location: headers.location,
                        st: headers.st || headers.nt || 'unknown',
                        usn: headers.usn,
                        server: headers.server,
                        raw: message
                    };

                    // 检查是否已存在
                    const exists = this.devices.some(d =>
                        d.address === device.address && d.location === device.location
                    );

                    if (!exists) {
                        this.devices.push(device);
                        console.log(`新设备: ${device.address} - ${device.st}`);
                    }
                }
            });

            socket.on('error', (error) => {
                console.error('套接字错误:', error);
            });

            socket.bind(0, () => {
                console.log('开始发送UPnP搜索请求...');

                // 发送多种搜索请求
                const searches = [
                    'upnp:rootdevice',
                    'ssdp:all',
                    'urn:schemas-upnp-org:device:MediaRenderer:1',
                    'urn:schemas-upnp-org:device:MediaServer:1'
                ];

                searches.forEach(st => {
                    const message = [
                        'M-SEARCH * HTTP/1.1',
                        'HOST: 239.255.255.250:1900',
                        'MAN: "ssdp:discover"',
                        'MX: 3',
                        `ST: ${st}`,
                        'USER-AGENT: SimpleDiscovery/1.0',
                        '',
                        ''
                    ].join('\r\n');

                    socket.send(Buffer.from(message), 1900, '239.255.255.250', (error) => {
                        if (error) {
                            console.error(`发送搜索失败 (${st}):`, error);
                        } else {
                            console.log(`搜索请求已发送: ${st}`);
                        }
                    });
                });

                // 等待响应
                setTimeout(() => {
                    console.log(`\n发现 ${this.devices.length} 个UPnP设备:`);
                    this.devices.forEach((device, index) => {
                        console.log(`${index + 1}. ${device.address} - ${device.st}`);
                        console.log(`   位置: ${device.location}`);
                        if (device.server) {
                            console.log(`   服务器: ${device.server}`);
                        }
                    });

                    socket.close();
                    resolve(this.devices);
                }, 5000);
            });
        });
    }

    parseHeaders(message) {
        const headers = {};
        const lines = message.split('\r\n');

        lines.forEach(line => {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).toLowerCase().trim();
                const value = line.substring(colonIndex + 1).trim();
                headers[key] = value;
            }
        });

        return headers;
    }
}

// 运行发现
const discovery = new SimpleUPnPDiscovery();
discovery.discover().then(devices => {
    console.log('\n=== 发现总结 ===');
    if (devices.length > 0) {
        console.log(`共发现 ${devices.length} 个设备`);

        // 尝试获取设备描述
        devices.forEach(async (device, index) => {
            console.log(`\n正在获取设备 ${index + 1} 的详细信息...`);
            try {
                const http = require('http');
                const url = new URL(device.location);

                const options = {
                    hostname: url.hostname,
                    port: url.port || 80,
                    path: url.pathname,
                    method: 'GET',
                    timeout: 5000
                };

                const req = http.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        console.log(`设备 ${device.address} 描述获取成功`);

                        // 提取友好名称
                        const friendlyNameMatch = data.match(/<friendlyName[^>]*>([^<]+)<\/friendlyName>/i);
                        if (friendlyNameMatch) {
                            console.log(`  名称: ${friendlyNameMatch[1]}`);
                        }

                        // 提取制造商
                        const manufacturerMatch = data.match(/<manufacturer[^>]*>([^<]+)<\/manufacturer>/i);
                        if (manufacturerMatch) {
                            console.log(`  制造商: ${manufacturerMatch[1]}`);
                        }

                        // 提取型号
                        const modelMatch = data.match(/<modelName[^>]*>([^<]+)<\/modelName>/i);
                        if (modelMatch) {
                            console.log(`  型号: ${modelMatch[1]}`);
                        }
                    });
                });

                req.on('error', (error) => {
                    console.log(`设备 ${device.address} 描述获取失败: ${error.message}`);
                });

                req.end();
            } catch (error) {
                console.log(`设备 ${device.address} 描述获取出错: ${error.message}`);
            }
        });
    } else {
        console.log('未发现任何UPnP设备');
        console.log('\n可能的原因:');
        console.log('1. 网络中没有DLNA/UPnP设备');
        console.log('2. 设备未开启DLNA功能');
        console.log('3. 防火墙阻止了UDP多播');
        console.log('4. 路由器禁用了多播功能');
    }

    process.exit(0);
}).catch(error => {
    console.error('发现过程出错:', error);
    process.exit(1);
});
