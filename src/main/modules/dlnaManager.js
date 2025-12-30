// DLNA管理器 - 处理DLNA设备发现和投屏功能
const DLNAClient = require('../../dlna/dlna-client');
const fs = require('fs');
const path = require('path');

class DLNAManager {
    constructor(isDev) {
        this.dlnaClient = new DLNAClient({ isDev });
        this.discoveredDevices = [];
        this.currentVideoUrl = null;
        this.deviceCache = [];
        this.cacheFile = path.join(require('os').homedir(), '.qixing-zhuiju', 'device-cache.json');
        this.cacheExpiry = 300000; // 缓存过期时间：5分钟
        this.lastDiscoveryTime = 0;
        this.isDev = isDev;

        // 初始化设备缓存目录和文件
        this.initCache();
    }

    // 初始化设备缓存
    initCache() {
        try {
            const cacheDir = path.dirname(this.cacheFile);
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }

            if (fs.existsSync(this.cacheFile)) {
                const cacheData = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
                if (cacheData.devices && Array.isArray(cacheData.devices)) {
                    this.deviceCache = cacheData.devices;
                    this.lastDiscoveryTime = cacheData.timestamp || 0;
                    console.log(`[MAIN] 已加载设备缓存，共 ${this.deviceCache.length} 个设备`);
                    console.log(`[MAIN] 缓存时间戳: ${new Date(this.lastDiscoveryTime).toLocaleString()}`);
                }
            }
        } catch (error) {
            console.warn('[MAIN] 初始化设备缓存失败:', error.message);
            this.deviceCache = [];
        }
    }

    // 保存设备缓存到文件
    saveCache() {
        try {
            const cacheData = {
                devices: this.discoveredDevices,
                timestamp: Date.now()
            };
            fs.writeFileSync(this.cacheFile, JSON.stringify(cacheData, null, 2), 'utf8');
            console.log('[MAIN] 设备缓存已保存到文件');
        } catch (error) {
            console.warn('[MAIN] 保存设备缓存失败:', error.message);
        }
    }

    // 检查设备缓存是否过期
    isCacheExpired() {
        return (Date.now() - this.lastDiscoveryTime) > this.cacheExpiry;
    }

    // 发现DLNA设备（带缓存功能）
    async discoverCastDevices() {
        console.log('[MAIN] 开始DLNA设备发现...');

        // 如果缓存未过期，直接返回缓存设备，同时后台刷新
        if (!this.isCacheExpired() && this.discoveredDevices.length > 0) {
            console.log('[MAIN] 返回缓存设备，同时后台刷新设备列表');
            // 后台刷新设备列表，不阻塞返回
            this.refreshDevicesInBackground();
            return this.discoveredDevices;
        }

        try {
            // 清空之前的设备列表
            this.discoveredDevices = [];

            // 先加载并返回缓存设备
            if (this.deviceCache.length > 0) {
                this.discoveredDevices = [...this.deviceCache];
                console.log(`[MAIN] 先返回缓存的 ${this.discoveredDevices.length} 个设备`);
            }

            // 设置DLNA客户端事件监听
            this.dlnaClient.removeAllListeners(); // 清除之前的监听器
            console.log('[MAIN] 已清除旧的事件监听器');

            this.dlnaClient.on('deviceFound', (device) => {
                console.log('[MAIN] 发现DLNA设备:', device.name, 'IP:', device.address);

                // 检查是否已存在相同设备（基于ID去重）
                const existingDeviceIndex = this.discoveredDevices.findIndex(d => d.id === device.id);

                // 转换为统一的设备格式
                const formattedDevice = {
                    id: device.id,
                    name: device.name,
                    type: device.type,
                    icon: device.icon,
                    status: 'available',
                    protocol: device.protocol,
                    address: device.address,
                    manufacturer: device.manufacturer,
                    modelName: device.modelName,
                    supportedServices: device.supportedServices ? Array.from(device.supportedServices) : [],
                    lastSeen: Date.now(),
                    originalDevice: device // 保存原始设备对象
                };

                if (existingDeviceIndex >= 0) {
                    // 更新已存在的设备信息
                    this.discoveredDevices[existingDeviceIndex] = formattedDevice;
                    console.log(`[MAIN] 设备信息已更新: ${device.name} (${device.address})`);
                } else {
                    // 添加新设备
                    this.discoveredDevices.push(formattedDevice);
                    console.log(`[MAIN] 设备已添加到列表: ${device.name} (${device.address})`);
                }

                console.log(`[MAIN] 当前设备列表总数: ${this.discoveredDevices.length}`);
            });

            this.dlnaClient.on('discoveryComplete', (devices) => {
                console.log(`[MAIN] DLNA设备发现完成事件触发，传入设备数量: ${devices.length}`);
                console.log(`[MAIN] 当前发现设备列表长度: ${this.discoveredDevices.length}`);

                // 更新设备的在线状态
                this.updateDeviceStatus();
                // 保存缓存
                this.saveCache();
            });

            console.log('[MAIN] 事件监听器已设置，开始设备发现...');

            // 开始设备发现
            const startResult = await this.dlnaClient.startDiscovery(5000); // 5秒超时
            console.log('[MAIN] startDiscovery 返回结果:', startResult);

            // 等待发现过程完成
            console.log('[MAIN] 等待设备发现完成...');
            await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    console.log('[MAIN] 设备发现超时，强制结束');
                    // 更新设备的在线状态
                    this.updateDeviceStatus();
                    // 保存缓存
                    this.saveCache();
                    resolve();
                }, 6000); // 6秒超时，给DLNA客户端足够时间

                this.dlnaClient.once('discoveryComplete', () => {
                    console.log('[MAIN] 收到 discoveryComplete 事件，结束等待');
                    clearTimeout(timeout);
                    resolve();
                });

                // 添加额外的检查
                setTimeout(() => {
                    console.log(`[MAIN] 中途检查：当前发现设备数量 ${this.discoveredDevices.length}`);
                }, 2500);
            });

            // 更新最后发现时间
            this.lastDiscoveryTime = Date.now();

            // 保存设备到缓存
            this.deviceCache = [...this.discoveredDevices];
            this.saveCache();

            console.log(`[MAIN] 最终发现 ${this.discoveredDevices.length} 个DLNA设备`);
            return this.discoveredDevices;

        } catch (error) {
            console.error('[MAIN] DLNA设备发现失败:', error);
            // 如果发现失败，返回缓存设备
            if (this.deviceCache.length > 0) {
                console.log('[MAIN] 发现失败，返回缓存设备');
                return this.deviceCache;
            }
            return this.discoveredDevices; // 返回已发现的设备
        }
    }

    // 后台刷新设备列表
    async refreshDevicesInBackground() {
        console.log('[MAIN] 后台刷新设备列表...');
        try {
            await this.discoverCastDevices();
            console.log('[MAIN] 后台设备刷新完成');
        } catch (error) {
            console.error('[MAIN] 后台设备刷新失败:', error);
        }
    }

    // 更新设备的在线状态
    updateDeviceStatus() {
        // 标记所有设备为离线
        this.deviceCache.forEach(device => {
            device.status = 'offline';
        });

        // 标记当前发现的设备为在线
        this.discoveredDevices.forEach(device => {
            const cacheDeviceIndex = this.deviceCache.findIndex(d => d.id === device.id);
            if (cacheDeviceIndex >= 0) {
                this.deviceCache[cacheDeviceIndex].status = 'available';
            }
        });
    }

    // DLNA投屏到设备
    async castToDLNADevice(deviceId, mediaUrl, metadata) {
        console.log('[MAIN] 开始DLNA投屏: ${deviceId}');

        try {
            // 查找设备
            const device = this.discoveredDevices.find(d => d.id === deviceId);
            if (!device) {
                throw new Error('设备不存在或已离线');
            }

            console.log(`[MAIN] 投屏到设备: ${device.name} (${device.address})`);

            // 使用DLNA客户端进行投屏
            const result = await this.dlnaClient.castToDevice(deviceId, mediaUrl, {
                title: metadata.title || '七星追剧',
                artist: metadata.artist || '未知',
                album: metadata.album || '影视剧集'
            });

            if (result.success) {
                console.log(`[MAIN] DLNA投屏成功: ${device.name}`);
                return {
                    success: true,
                    message: `已投屏到 ${device.name}`,
                    device: device
                };
            } else {
                // 详细的错误处理
                const errorMsg = result.error || '投屏失败';
                console.error(`[MAIN] DLNA投屏失败: ${errorMsg}`);
                console.error(`[MAIN] 设备信息: ${device.name} (${device.address})`);
                console.error(`[MAIN] 媒体URL: ${mediaUrl}`);

                // 根据错误类型提供更有帮助的错误信息
                if (errorMsg.includes('UPnP错误码: 501')) {
                    throw new Error('投屏失败：媒体URL为空或无效，请确保视频正在播放且使用直接视频链接（非网页播放器）');
                } else if (errorMsg.includes('SOAP错误')) {
                    throw new Error(`设备不支持此操作或媒体格式不兼容: ${errorMsg}`);
                } else if (errorMsg.includes('网络')) {
                    throw new Error(`网络连接问题: ${errorMsg}`);
                } else if (errorMsg.includes('超时')) {
                    throw new Error(`设备响应超时，请检查设备状态: ${errorMsg}`);
                } else {
                    throw new Error(`投屏失败: ${errorMsg}`);
                }
            }

        } catch (error) {
            console.error('[MAIN] DLNA投屏失败:', error);
            throw error;
        }
    }

    // 暂停DLNA投屏
    async pauseDLNACasting(deviceId) {
        console.log(`[MAIN] 暂停DLNA投屏: ${deviceId}`);

        try {
            // 查找设备
            const device = this.discoveredDevices.find(d => d.id === deviceId);
            if (!device) {
                return {
                    success: false,
                    message: '设备不存在或已离线，请刷新设备列表后重试'
                };
            }

            console.log(`[MAIN] 暂停投屏到设备: ${device.name} (${device.address})`);

            // 使用DLNA客户端进行暂停
            const result = await this.dlnaClient.pause(deviceId);

            if (result.success) {
                console.log(`[MAIN] DLNA投屏暂停成功: ${device.name}`);
                return {
                    success: true,
                    message: `已暂停 ${device.name} 上的投屏`
                };
            } else {
                console.error(`[MAIN] DLNA投屏暂停失败: ${result.error}`);
                return {
                    success: false,
                    message: result.error
                };
            }

        } catch (error) {
            console.error('[MAIN] 暂停DLNA投屏失败:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    // 停止DLNA投屏
    async stopDLNACasting(deviceId) {
        console.log(`[MAIN] 停止DLNA投屏: ${deviceId}`);

        try {
            // 查找设备
            const device = this.discoveredDevices.find(d => d.id === deviceId);
            if (!device) {
                return {
                    success: false,
                    message: '设备不存在或已离线，请刷新设备列表后重试'
                };
            }

            console.log(`[MAIN] 停止投屏到设备: ${device.name} (${device.address})`);

            // 使用DLNA客户端进行停止
            const result = await this.dlnaClient.stop(deviceId);

            if (result.success) {
                console.log(`[MAIN] DLNA投屏停止成功: ${device.name}`);
                return {
                    success: true,
                    message: `已停止 ${device.name} 上的投屏`
                };
            } else {
                console.error(`[MAIN] DLNA投屏停止失败: ${result.error}`);
                return {
                    success: false,
                    message: result.error
                };
            }

        } catch (error) {
            console.error('[MAIN] 停止DLNA投屏失败:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    // 跳转到指定位置
    async seekDLNACasting(deviceId, position) {
        console.log(`[MAIN] 跳转到位置 ${position}，设备: ${deviceId}`);

        try {
            // 查找设备
            const device = this.discoveredDevices.find(d => d.id === deviceId);
            if (!device) {
                return {
                    success: false,
                    message: '设备不存在或已离线，请刷新设备列表后重试'
                };
            }

            console.log(`[MAIN] 跳转到位置 ${position} 秒，设备: ${device.name} (${device.address})`);

            // 使用DLNA客户端进行跳转
            const result = await this.dlnaClient.seek(deviceId, position);

            if (result.success) {
                console.log(`[MAIN] DLNA投屏跳转成功: ${device.name}`);
                return {
                    success: true,
                    message: `已跳转到指定位置`
                };
            } else {
                console.error(`[MAIN] DLNA投屏跳转失败: ${result.error}`);
                return {
                    success: false,
                    message: result.error
                };
            }

        } catch (error) {
            console.error('[MAIN] 跳转DLNA投屏失败:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    // 设置音量
    async setVolumeDLNACasting(deviceId, volume) {
        console.log(`[MAIN] 设置音量为 ${volume}，设备: ${deviceId}`);

        try {
            // 查找设备
            const device = this.discoveredDevices.find(d => d.id === deviceId);
            if (!device) {
                return {
                    success: false,
                    message: '设备不存在或已离线，请刷新设备列表后重试'
                };
            }

            console.log(`[MAIN] 设置音量为 ${volume}，设备: ${device.name} (${device.address})`);

            // 使用DLNA客户端设置音量
            const result = await this.dlnaClient.setVolume(deviceId, volume);

            if (result.success) {
                console.log(`[MAIN] DLNA投屏音量设置成功: ${device.name}`);
                return {
                    success: true,
                    message: `已设置音量为 ${volume}`
                };
            } else {
                console.error(`[MAIN] DLNA投屏音量设置失败: ${result.error}`);
                return {
                    success: false,
                    message: result.error
                };
            }

        } catch (error) {
            console.error('[MAIN] 设置DLNA投屏音量失败:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    // 获取当前播放位置和时长
    async getDLNAPositionInfo(deviceId) {
        console.log(`[MAIN] 获取当前播放位置，设备: ${deviceId}`);

        try {
            // 查找设备
            const device = this.discoveredDevices.find(d => d.id === deviceId);
            if (!device) {
                return {
                    success: false,
                    message: '设备不存在或已离线，请刷新设备列表后重试'
                };
            }

            console.log(`[MAIN] 获取当前播放位置，设备: ${device.name} (${device.address})`);

            // 使用DLNA客户端获取位置信息
            const result = await this.dlnaClient.getPositionInfo(deviceId);

            if (result.success) {
                console.log(`[MAIN] 获取DLNA投屏位置信息成功: ${device.name}`);
                return {
                    success: true,
                    positionInfo: result.positionInfo
                };
            } else {
                console.error(`[MAIN] 获取DLNA投屏位置信息失败: ${result.error}`);
                return {
                    success: false,
                    message: result.error
                };
            }

        } catch (error) {
            console.error('[MAIN] 获取DLNA投屏位置信息失败:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    // 获取当前传输状态
    async getDLNATransportInfo(deviceId) {
        console.log(`[MAIN] 获取当前传输状态，设备: ${deviceId}`);

        try {
            // 查找设备
            const device = this.discoveredDevices.find(d => d.id === deviceId);
            if (!device) {
                return {
                    success: false,
                    message: '设备不存在或已离线，请刷新设备列表后重试'
                };
            }

            console.log(`[MAIN] 获取当前传输状态，设备: ${device.name} (${device.address})`);

            // 使用DLNA客户端获取传输状态
            const result = await this.dlnaClient.getTransportInfo(deviceId);

            if (result.success) {
                console.log(`[MAIN] 获取DLNA投屏传输状态成功: ${device.name}`);
                return {
                    success: true,
                    transportInfo: result.transportInfo
                };
            } else {
                console.error(`[MAIN] 获取DLNA投屏传输状态失败: ${result.error}`);
                return {
                    success: false,
                    message: result.error
                };
            }

        } catch (error) {
            console.error('[MAIN] 获取DLNA投屏传输状态失败:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    // 设置当前视频URL
    setCurrentVideoUrl(url) {
        this.currentVideoUrl = url;
    }

    // 获取当前视频URL
    getCurrentVideoUrl() {
        return this.currentVideoUrl;
    }
}

module.exports = DLNAManager;
