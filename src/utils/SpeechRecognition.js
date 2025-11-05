/**
 * 语音识别工具
 * 基于科大讯飞 WebSocket API
 */

export class VoiceRecognizer {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.isReady = false;
    this.wsUrl = 'wss://metastaff-proxy.onrender.com/asr'; // <-- 已修改：请将 your-service-name.onrender.com 替换为您的真实服务地址
    this.state = 'disconnected'; // disconnected, connecting, connected
    this.finalResultTimeout = null;
    this.isListening = false;
    this.result = {
      final: '',
      interim: '',
      confidence: 0,
      alternatives: [],
    };
    // this.wsUrl = 'ws://localhost:3001/asr';
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;
    this.workletNode = null;
    this.audioSource = null; // 音频源节点
    this.isConnected = false;
    this.isSpeaking = false;

    // 识别结果缓存
    this.resultText = '';
    this.resultTextTemp = '';
    this.lastNonPunctText = '';

    this.isFirstFrame = false;

    // 分段控制
    this.segmentResetGapMs = 2000; // 延长分段窗口，减少文本被过早切段
    this.lastResultTs = 0;

    // 音频缓冲
    this.audioBuffer = [];
    // 采样残差，用于更精确地从源采样率转换到16k分片
    this._sampleResidual = 0;

    // 是否启用控制台日志
    this.enableConsoleLog = true;

    // AudioWorklet模块加载状态
    this.workletModuleLoaded = false;

    // VAD (语音活动检测) 相关
    this.silenceThreshold = 0.015;     // 静音阈值（提高以减少误触发）
    this.silenceDuration = 1500;       // 静音持续时间（ms）
    this.lastSpeechTime = 0;           // 最后检测到说话的时间
    this.silenceTimer = null;          // 静音检测定时器
    this.minSpeechDuration = 500;      // 最小说话时长（ms）
    this.speechStartTime = 0;          // 开始说话时间
    this.isSpeechDetected = false;     // 是否检测到说话
    this.waitingForFinalResult = false; // 等待最终结果标志
    this.finalResultTimeout = null;    // 最终结果超时定时器
  }

  async init(config = {}) {
    try {
      // 获取麦克风权限
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      // 创建音频上下文（使用默认采样率，稍后重采样）
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

      this.isReady = true;
      return true;
    } catch (error) {
      throw error;
    }
  }

  async start(options = {}) {
    if (!this.isReady) {
      await this.init(options);
    }

    if (this.isListening) {
      await this.stop();
    }

    // 重置结果
    this._resetResult();

    // 标记状态
    this.isListening = true;
    this.isStreaming = true;
    this.isFirstFrame = true;

    try {
      // 确保音频上下文处于运行态（避免因系统策略或页面切换导致的挂起）
      if (this.audioContext && this.audioContext.state === 'suspended') {
        try { await this.audioContext.resume(); } catch (e) { /* ignore */ }
      }
      // 检查 WebSocket 状态，如果不是 OPEN 或 CONNECTING，则重新连接
      const needNewConnection = !this.ws || 
        (this.ws && (this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING));

      if (needNewConnection) {
        // 先关闭旧连接
        if (this.ws) {
          try {
            this.ws.close();
          } catch (e) { /* ignore */ }
          this.ws = null;
        }
        await this._connectWebSocket();
      } else if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        // 如果正在连接，等待连接完成
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('WebSocket连接超时'));
          }, 5000);

          const checkConnection = () => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              clearTimeout(timeout);
              console.log('语音识别WebSocket连接完成');
              resolve();
            } else if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
              clearTimeout(timeout);
              reject(new Error('WebSocket连接失败'));
            } else {
              setTimeout(checkConnection, 100);
            }
          };
          checkConnection();
        });
      }

      await this._startAudioCapture();
      this._emit('start');
    } catch (error) {
      this.isListening = false;
      this.isStreaming = false;
      throw error;
    }
  }

  async stop() {
    this.isListening = false;
    this.isStreaming = false;
    this.isFirstFrame = false;

    // 清理 VAD 定时器
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.finalResultTimeout) {
      clearTimeout(this.finalResultTimeout);
      this.finalResultTimeout = null;
    }

    this.waitingForFinalResult = false;

    // 停止 AudioWorklet 或 ScriptProcessor
    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: 'stop' });
        this.workletNode.disconnect();
      } catch (e) { /* ignore */ }
      this.workletNode = null;
    }

    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch (e) { /* ignore */ }
      this.processor = null;
    }

    // 断开音频源
    if (this.audioSource) {
      try {
        this.audioSource.disconnect();
      } catch (e) { /* ignore */ }
      this.audioSource = null;
    }

    // 发送剩余缓冲数据
    if (this.audioBuffer.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const remainingData = new Float32Array(this.audioBuffer);
      this.audioBuffer = [];
      const pcmData = this._resampleAndConvert(remainingData, this.audioContext.sampleRate, 16000);
      const base64Data = this._arrayBufferToBase64(pcmData);

      try {
        this.ws.send(JSON.stringify({
          data: {
            status: 1,
            format: 'audio/L16;rate=16000',
            encoding: 'raw',
            audio: base64Data
          }
        }));
      } catch (e) { /* ignore */ }
    }

    // 发送结束帧并主动关闭连接
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          data: {
            status: 2,
            format: 'audio/L16;rate=16000',
            encoding: 'raw',
            audio: ''
          }
        }));

        // 主动关闭连接，不等待服务端关闭
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
        }, 20);
      } catch (e) { /* ignore */ }
    }

    // 清空音频缓冲区
    this.audioBuffer = [];

    // 重置识别结果（为下次识别做准备）
    this.resultText = '';
    this.resultTextTemp = '';
    this.lastNonPunctText = '';
    this.lastResultTs = 0;
  }

  async abort() {
    this.isListening = false;

    // 清理 VAD 定时器
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.finalResultTimeout) {
      clearTimeout(this.finalResultTimeout);
      this.finalResultTimeout = null;
    }

    this.waitingForFinalResult = false;

    // 清理 AudioWorklet
    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: 'stop' });
        this.workletNode.disconnect();
      } catch (e) { /* ignore */ }
      this.workletNode = null;
    }

    // 清理 ScriptProcessor
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch (e) { /* ignore */ }
      this.processor = null;
    }

    // 清理音频源
    if (this.audioSource) {
      try {
        this.audioSource.disconnect();
      } catch (e) { /* ignore */ }
      this.audioSource = null;
    }

    // 关闭 WebSocket
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) { /* ignore */ }
      this.ws = null;
    }

    // 清空缓冲区
    this.audioBuffer = [];
  }

  getResult() {
    return {
      final: this.result.final,
      interim: this.result.interim,
      confidence: this.result.confidence,
      alternatives: this.result.alternatives,
    };
  }

  getState() {
    return {
      isReady: this.isReady,
      isListening: this.isListening,
      isConnected: this.isConnected,
      isSpeaking: this.isSpeaking,
      result: { ...this.result }
    };
  }

  isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /**
   * 启用或禁用控制台日志输出
   * @param {boolean} enabled - true 启用，false 禁用
   */
  setConsoleLog(enabled) {
    this.enableConsoleLog = enabled;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  async destroy() {
    await this.abort();

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    this.listeners.clear();
    this.isReady = false;
  }

  async _connectWebSocket() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this._emit('connected');
        resolve();
      };

      this.ws.onmessage = async (event) => {
        try {
          let data = event.data;

          if (data instanceof Blob) {
            data = await data.text();
          }

          const response = JSON.parse(data);
          this._handleWebSocketMessage(response);
        } catch (error) { /* ignore */ }
      };

      this.ws.onerror = (event) => {
        this.isConnected = false;

        const errorObj = new Error('WebSocket连接失败');
        // 记录更详细的错误信息，辅助定位远端服务问题
        try {
          console.error('ASR WebSocket error', {
            url: this.wsUrl,
            event
          });
        } catch (_) { /* ignore */ }

        this._emit('error', { error: errorObj });
        // 使用标准错误对象而不是原始事件，避免外层出现 Event {...}
        reject(errorObj);
      };

      this.ws.onclose = (evt) => {
        this.isConnected = false;
        this.isListening = false;

        try {
          console.warn('ASR WebSocket closed', { code: evt?.code, reason: evt?.reason });
        } catch (_) { /* ignore */ }

        this._emit('disconnected');

        const result = this.getResult();
        this._emit('end', result);

        // 清空 ws 引用，确保下次 start 时重新连接
        this.ws = null;
      };
    });
  }

  _handleWebSocketMessage(response) {
    if (response.error) {
      const error = new Error(`语音识别错误: ${response.error}`);
      this._emit('error', { error });
      this.callbacks?.onError?.(error);
      return;
    }

    if (!response.data) {
      return;
    }

    const { data } = response;

    if (data.result) {
      const nowTs = Date.now();

      if (this.lastResultTs && (nowTs - this.lastResultTs > this.segmentResetGapMs)) {
        this.resultText = '';
        this.resultTextTemp = '';
        this.lastNonPunctText = '';
      }

      const result = data.result;
      const ws = result.ws || [];
      let str = '';

      for (let i = 0; i < ws.length; i++) {
        if (ws[i].cw && ws[i].cw[0] && ws[i].cw[0].w) {
          str += ws[i].cw[0].w;
        }
      }

      if (!this.resultText) this.resultText = '';
      if (!this.resultTextTemp) this.resultTextTemp = '';

      if (result.pgs) {
        if (result.pgs === 'apd') {
          this.resultText = this.resultTextTemp;
        }
        this.resultTextTemp = this.resultText + str;
      } else {
        this.resultText += str;
      }

      const currentText = (this.resultTextTemp || this.resultText || '').trim();
      // 扩展标点与空白过滤（中英文标点、破折号、省略号等）
      const punctOnlyRegex = /^[\s.,!?;:…，。？！、；：—-]*$/;

      let effectiveText = currentText;
      const isFinalStatus = data.status === 2;

      if (isFinalStatus && (punctOnlyRegex.test(effectiveText) || !effectiveText)) {
        const fallback = this.lastNonPunctText || '';
        if (fallback) {
          effectiveText = fallback;
        }
      }

      const hasEffectiveContent = effectiveText && !punctOnlyRegex.test(effectiveText);

      if (hasEffectiveContent && !isFinalStatus) {
        this.lastNonPunctText = effectiveText;
      }

      if (hasEffectiveContent || (isFinalStatus && this.lastNonPunctText)) {
        if (isFinalStatus) {
          const finalText = hasEffectiveContent ? effectiveText : this.lastNonPunctText;
          this.result.final = finalText;
          this.result.interim = '';

          this._emit('result', {
            final: finalText,
            interim: '',
            isFinal: true,
            confidence: result.confidence || 0,
          });

          this.resultText = '';
          this.resultTextTemp = '';
          this.lastNonPunctText = '';

          // 🔥 收到最终结果后，重置状态准备下一轮
          this._resetAfterFinalResult();

          // 收到 status: 2 最终结果后，主动调用 stop() 触发 end 事件
          setTimeout(() => {
            this.stop();
          }, 50);
        } else {
          this.result.interim = effectiveText;
          this.result.final = '';

          this._emit('result', {
            final: '',
            interim: effectiveText,
            isFinal: false,
            confidence: result.confidence || 0,
          });
      }

      this.lastResultTs = nowTs;
    }
  }
  }

  async _startAudioCapture() {
    // 先清理旧的音频节点
    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: 'stop' });
        this.workletNode.disconnect();
      } catch (e) { /* ignore */ }
      this.workletNode = null;
    }

    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch (e) { /* ignore */ }
      this.processor = null;
    }

    if (this.audioSource) {
      try {
        this.audioSource.disconnect();
      } catch (e) { /* ignore */ }
      this.audioSource = null;
    }

    // 创建新的音频源
    this.audioSource = this.audioContext.createMediaStreamSource(this.mediaStream);

    try {
      // 尝试使用 AudioWorkletNode (推荐的现代API)
      // 只在第一次加载模块
      if (!this.workletModuleLoaded) {
        await this.audioContext.audioWorklet.addModule('/speach/audio-processor.worklet.js');
        this.workletModuleLoaded = true;
      }

      this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');

      // 监听来自 worklet 的消息
      this.workletNode.port.onmessage = (event) => {
        const { type, data } = event.data;

        if (type === 'audiodata' && data) {
          this._processAudioData(data);
        }
      };

      // 连接音频节点
      this.audioSource.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      // 启动 worklet
      this.workletNode.port.postMessage({ type: 'start' });
    } catch (error) {

      // 4096 samples 约 85ms @ 48kHz
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (event) => {
        if (!this.isListening || !this.isConnected) return;

        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);

        this._processAudioData(inputData);
      };

      this.audioSource.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
    }

    this.isFirstFrame = true;
    this.isListening = true;
    this.audioBuffer = [];

    this._emit('start');
  }

  /**
   * 处理音频数据（AudioWorklet 和 ScriptProcessor 共用）
   */
  _processAudioData(inputData) {
    if (!this.isListening || !this.isConnected) return;

    // 🔥 如果正在等待最终结果，跳过 VAD 检测，避免误触发
    if (this.waitingForFinalResult) {
      return;
    }

    // ✅ VAD: 计算音频能量（音量）
    let sum = 0;
    for (let i = 0; i < inputData.length; i++) {
      sum += Math.abs(inputData[i]);
    }
    const avgVolume = sum / inputData.length;

    // ✅ VAD: 语音活动检测
    const isSpeaking = avgVolume > this.silenceThreshold;
    const now = Date.now();

    if (isSpeaking) {
      // 检测到说话
      this.lastSpeechTime = now;

      if (!this.isSpeechDetected) {
        // 说话开始
        this.isSpeechDetected = true;
        this.speechStartTime = now;
      }

      // 清除静音定时器
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    } else if (this.isSpeechDetected) {
      // 检测到静音（但之前有说话）
      if (!this.silenceTimer) {
        // 启动静音检测定时器
        this.silenceTimer = setTimeout(() => {
          const speechDuration = this.lastSpeechTime - this.speechStartTime;

          // 只有说话时长超过最小时长才发送结束帧
          if (speechDuration >= this.minSpeechDuration) {
            this._sendEndFrame();
          }

          this.isSpeechDetected = false;
          this.silenceTimer = null;
        }, this.silenceDuration);
      }
    }

    // 添加到缓冲区
    for (let i = 0; i < inputData.length; i++) {
      this.audioBuffer.push(inputData[i]);
    }

    // 当缓冲区足够大时，处理并发送
    // 640 samples @ 16kHz = 40ms，对应 1280 字节
    const targetSamples = 640; // 16kHz 下 40ms 的采样数
    const sourceSampleRate = this.audioContext.sampleRate;
    const ratio = sourceSampleRate / 16000;

    // 使用采样残差更精确地对齐分片，减少边界误差
    let requiredSourceSamples = Math.floor(targetSamples * ratio + this._sampleResidual);

    while (this.audioBuffer.length >= requiredSourceSamples) {
      // 取出需要的样本数
      const chunk = this.audioBuffer.splice(0, requiredSourceSamples);
      const chunkData = new Float32Array(chunk);

      // 重采样并转换为 16kHz PCM16
      const pcmData = this._resampleAndConvert(chunkData, sourceSampleRate, 16000);
      const base64Data = this._arrayBufferToBase64(pcmData);

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const status = this.isFirstFrame ? 0 : 1;
        try {
          this.ws.send(JSON.stringify({
            data: {
              status,
              format: 'audio/L16;rate=16000',
              encoding: 'raw',
              audio: base64Data
            }
          }));

          if (this.isFirstFrame) {
            this.isFirstFrame = false;
          }
        } catch (e) { /* ignore */ }
      }

      // 更新残差：本次消耗的源样本与理想值之间的差
      const idealSourceSamples = targetSamples * ratio + this._sampleResidual;
      this._sampleResidual = idealSourceSamples - requiredSourceSamples;
      requiredSourceSamples = Math.floor(targetSamples * ratio + this._sampleResidual);
    }
  }

  /**
   * 重采样并转换为 16kHz 的 16位 PCM
   */
  _resampleAndConvert(inputData, fromSampleRate, toSampleRate) {
    let outputData;

    // 如果采样率相同，直接使用
    if (fromSampleRate === toSampleRate) {
      outputData = inputData;
    } else {
      // 线性插值重采样
      const sampleRateRatio = fromSampleRate / toSampleRate;
      const newLength = Math.round(inputData.length / sampleRateRatio);
      outputData = new Float32Array(newLength);

      for (let i = 0; i < newLength; i++) {
        const position = i * sampleRateRatio;
        const index = Math.floor(position);
        const fraction = position - index;

        if (index + 1 < inputData.length) {
          // 线性插值
          outputData[i] = inputData[index] * (1 - fraction) + inputData[index + 1] * fraction;
        } else {
          outputData[i] = inputData[index];
        }
      }
    }

    // 转换为 16位 PCM
    const pcmData = new ArrayBuffer(outputData.length * 2);
    const view = new DataView(pcmData);

    for (let i = 0; i < outputData.length; i++) {
      // 限制范围在 [-1, 1]
      let sample = Math.max(-1, Math.min(1, outputData[i]));
      // 转换为 16位整数
      let intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(i * 2, intSample, true); // little-endian
    }

    return pcmData;
  }

  /**
   * ArrayBuffer转Base64
   */
  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * 发送结束帧并等待最终结果
   */
  _sendEndFrame() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // 如果已经在等待最终结果，避免重复发送
    if (this.waitingForFinalResult) {
      return;
    }

    try {
      // 发送剩余缓冲数据
      if (this.audioBuffer.length > 0) {
        const remainingData = new Float32Array(this.audioBuffer);
        this.audioBuffer = [];
        const pcmData = this._resampleAndConvert(remainingData, this.audioContext.sampleRate, 16000);
        const base64Data = this._arrayBufferToBase64(pcmData);

        this.ws.send(JSON.stringify({
          data: {
            status: 1,
            format: 'audio/L16;rate=16000',
            encoding: 'raw',
            audio: base64Data
          }
        }));
      }

      // 发送结束帧
      this.ws.send(JSON.stringify({
        data: {
          status: 2,  // 结束帧，触发最终结果
          format: 'audio/L16;rate=16000',
          encoding: 'raw',
          audio: ''
        }
      }));

    } catch (e) {
      this.waitingForFinalResult = false;
    }
  }

  /**
   * 收到最终结果后重置状态
   */
  _resetAfterFinalResult() {
    // 清除超时定时器
    if (this.finalResultTimeout) {
      clearTimeout(this.finalResultTimeout);
      this.finalResultTimeout = null;
    }

    // 重置等待标志
    this.waitingForFinalResult = false;

    // 重置识别状态，准备下一轮
    this.isFirstFrame = true;
    this.resultText = '';
    this.resultTextTemp = '';
    this.lastNonPunctText = '';
  }

  /**
   * 重置结果
   */
  _resetResult() {
    this.result = {
      final: '',
      interim: '',
      confidence: 0,
      alternatives: [],
    };
    this.resultText = '';
    this.resultTextTemp = '';
    this.lastNonPunctText = '';
    this.lastResultTs = 0;
    this.audioBuffer = [];
    this._sampleResidual = 0;

    // 重置 VAD 状态
    this.isSpeechDetected = false;
    this.lastSpeechTime = 0;
    this.speechStartTime = 0;
    this.waitingForFinalResult = false;

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    if (this.finalResultTimeout) {
      clearTimeout(this.finalResultTimeout);
      this.finalResultTimeout = null;
    }
  }

  /**
   * 触发事件
   */
  _emit(event, data = {}) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) { /* ignore */ }
      });
    }
  }
}

export default VoiceRecognizer;
