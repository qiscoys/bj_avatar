class CameraService {
  constructor() {
    this.video = null;
    this.stream = null;
    this.isDetecting = false;
    this.hasWaved = false; // 是否已经挥过手
    this.callbacks = {};

    // MediaPipe Holistic 相关属性
    this.holistic = null;
    this.camera = null;
    this.waveCount = 0;
    this.lastWaveTime = 0;

    // 挥手检测相关属性
    this.handTracker = {
      prev: { x: null, y: null },
      next: { x: null, y: null },
    };

    // 检测参数
    this.detectionConfig = {
      waveDetectionInterval: 100,
      waveDetectionTimeout: 5000,
      waveThreshold: 0.1,
      minWaveCount: 3,
    };
  }

  // 初始化摄像头
  async initCamera() {
    try {
      // 检查浏览器兼容性
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('浏览器不支持摄像头访问');
      }

      // 创建视频元素
      this.video = document.createElement('video');
      this.video.style.position = 'absolute';
      this.video.style.top = '-9999px';
      this.video.style.left = '-9999px';
      this.video.autoplay = true;
      this.video.playsInline = true;
      this.video.muted = true;
      document.body.appendChild(this.video);

      // 获取摄像头权限
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: 640,
          height: 480,
          facingMode: 'user',
        },
      });

      this.video.srcObject = this.stream;
      await new Promise(resolve => {
        this.video.onloadedmetadata = () => {
          this.video.play();
          resolve();
        };
      });

      // 初始化 MediaPipe Holistic 模型
      this.holistic = new window.Holistic({
        locateFile: file => {
          return `pub-ui/plugin/holistic/${file}`;
        },
      });

      // 设置 Holistic 模型参数
      this.holistic.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      // 设置结果回调
      this.holistic.onResults(this.onHolisticResults.bind(this));

      // 初始化摄像头处理
      this.camera = new window.Camera(this.video, {
        onFrame: async () => {
          if (this.isDetecting && this.holistic) {
            await this.holistic.send({ image: this.video });
          }
        },
        width: 640,
        height: 480,
      });

      return true;
    } catch (error) {
      console.error('摄像头初始化失败:', error);
      throw error;
    }
  }

  // 开始手势检测
  async startDetection() {
    if (!this.video || !this.holistic || !this.camera) {
      console.error('摄像头未初始化');
      return false;
    }

    if (this.isDetecting) {
      console.log('手势检测已在运行');
      return true;
    }

    this.isDetecting = true;
    this.hasWaved = false; // 重置挥手状态

    // 重置手势跟踪器
    this.handTracker = {
      prev: { x: null, y: null },
      next: { x: null, y: null },
    };
    this.waveCount = 0;

    try {
      // 确保视频正在播放
      if (this.video.paused) {
        await this.video.play();
      }

      // 等待视频有有效尺寸
      await new Promise(resolve => {
        const checkVideo = () => {
          if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
            resolve();
          } else {
            setTimeout(checkVideo, 100);
          }
        };
        checkVideo();
      });

      await this.camera.start();
      return true;
    } catch (error) {
      console.error('启动摄像头失败:', error);
      this.isDetecting = false;
      return false;
    }
  }

  // 停止手势检测
  async stopDetection() {
    this.isDetecting = false;

    if (this.camera) {
      try {
        await this.camera.stop();
      } catch (error) {
        console.warn('停止摄像头时出错:', error);
      }
    }

    this.waveCount = 0;
  }

  // 处理 MediaPipe Holistic 检测结果
  onHolisticResults(results) {
    if (!this.isDetecting) return;

    try {
      // 验证结果对象
      if (!results || typeof results !== 'object') {
        console.warn('MediaPipe 返回的结果无效:', results);
        return;
      }

      // 检测挥手手势
      const waveDetected = this.detectWaveGesture(results);

      // 处理挥手检测 - 只要检测到挥手且还没有挥过手就触发
      if (waveDetected && !this.hasWaved) {
        this.hasWaved = true;
        console.log('检测到挥手手势，触发对话');

        if (this.callbacks.onWaveDetected && typeof this.callbacks.onWaveDetected === 'function') {
          try {
            this.callbacks.onWaveDetected();
          } catch (callbackError) {
            console.error('挥手检测回调执行失败:', callbackError);
          }
        }
      }
    } catch (error) {
      console.error('MediaPipe Holistic 结果处理出错:', error);
      console.error('错误堆栈:', error.stack);
    }
  }

  // 检测挥手手势
  detectWaveGesture(results) {
    try {
      // 如果没有检测到手部关键点，直接返回 false
      if (!results.leftHandLandmarks && !results.rightHandLandmarks) {
        return false;
      }

      const now = Date.now();
      let isWaving = false;

      // 检查左手挥手
      if (results.leftHandLandmarks) {
        isWaving = this.checkHandWaveGesture(results.leftHandLandmarks) || isWaving;
      }

      // 检查右手挥手
      if (results.rightHandLandmarks && !isWaving) {
        isWaving = this.checkHandWaveGesture(results.rightHandLandmarks) || isWaving;
      }

      // 如果检测到挥手，更新状态
      if (isWaving) {
        this.waveCount++;
        this.lastWaveTime = now;

        // 连续检测到指定次数以上才确认为挥手
        if (this.waveCount >= this.detectionConfig.minWaveCount) {
          return true;
        }
      } else {
        // 如果超过500ms没有检测到挥手，重置计数
        if (now - this.lastWaveTime > 500) {
          this.waveCount = 0;
        }
      }

      return false;
    } catch (error) {
      console.warn('挥手检测出错:', error);
      return false;
    }
  }

  // 检查手部是否在做挥手动作
  checkHandWaveGesture(handLandmarks) {
    if (!handLandmarks || handLandmarks.length < 9) return false;

    try {
      // 获取拇指尖的位置
      const thumb = handLandmarks[4]; // 拇指尖

      if (!thumb) return false;

      // 计算手势的移动距离
      const currentPos = {
        x: thumb.x * 100,
        y: thumb.y * 100,
      };

      // 更新手部位置跟踪
      this.updateHandTracker(currentPos);

      // 计算移动距离
      if (this.handTracker.prev.x !== null && this.handTracker.next.x !== null) {
        const x_distance = Math.pow(this.handTracker.prev.x - this.handTracker.next.x, 2);
        const y_distance = Math.pow(this.handTracker.prev.y - this.handTracker.next.y, 2);

        // 使用兼容性更好的对数计算方式，避免 Math.log2 兼容性问题
        const x_log = x_distance > 0 ? Math.log(x_distance) / Math.log(2) : 0;
        const y_log = y_distance > 0 ? Math.log(y_distance) / Math.log(2) : 0;

        // 判断是否为挥手动作
        const isHorizontalWave = x_log > this.detectionConfig.waveThreshold;
        const isVerticalWave = y_log > this.detectionConfig.waveThreshold;

        // 挥手主要是水平方向的运动
        return isHorizontalWave || isVerticalWave;
      }

      return false;
    } catch (error) {
      console.warn('手挥手检测出错:', error);
      return false;
    }
  }

  // 更新手部位置跟踪器
  updateHandTracker(currentPos) {
    // 一开始的数据
    if (this.handTracker.prev.x === null && this.handTracker.next.x === null) {
      this.handTracker.prev = JSON.parse(JSON.stringify(currentPos));
      return;
    }

    // 之后的数据
    if (this.handTracker.prev.x !== null && this.handTracker.next.x === null) {
      this.handTracker.next = JSON.parse(JSON.stringify(this.handTracker.prev));
      this.handTracker.prev = JSON.parse(JSON.stringify(currentPos));
      return;
    }

    // 更新数据
    if (this.handTracker.prev.x !== null && this.handTracker.next.x !== null) {
      this.handTracker.prev = JSON.parse(JSON.stringify(this.handTracker.next));
      this.handTracker.next = JSON.parse(JSON.stringify(currentPos));
    }
  }

  // 设置回调函数
  on(event, callback) {
    this.callbacks[event] = callback;
  }

  // 销毁服务
  async destroy() {
    console.log('销毁摄像头服务');

    await this.stopDetection();

    // 停止视频流
    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        track.stop();
      });
      this.stream = null;
    }

    // 移除视频元素
    if (this.video) {
      if (this.video.parentNode) {
        this.video.parentNode.removeChild(this.video);
      }
      this.video = null;
    }

    // 释放资源
    if (this.holistic) {
      this.holistic.close();
    }

    // 重置状态
    this.isDetecting = false;
    this.hasWaved = false;
    this.callbacks = {};

    console.log('摄像头服务已销毁');
  }
}

// 导出单例
export default new CameraService();
