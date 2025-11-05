/**
 * 语音合成工具
 * 科大讯飞WebSocket实现
 */

export class VoiceSynthesizer {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.isReady = false;
    this.isPlaying = false;
    this.isPaused = false;
    this.currentText = '';
    this.wsUrl = 'wss://metastaff-proxy.onrender.com/tts-ws'; // <-- 已修改：请将 your-service-name.onrender.com 替换为您的真实服务地址

    // 使用AudioPlayer
    this.audioPlayer = null;
    this.audioPlayerPath = './TTS';
    this.currentOptions = null;
    
    // 流式播放状态
    this.streamEnded = false;
  }

  async init() {
    this.isReady = true;
    return true;
  }

  async speak(text, options = {}) {
    if (!this.isReady) await this.init();

    const {
      onStart = null,
      onStop = null,
      onError = null,
      voiceName = 'x4_yezi', // 默认发音人
    } = options;

    // 1.停止当前播放
    this.stop();

    // 2.清理文本，去除空白字符等
    const cleanText = this._cleanText(text);
    if (!cleanText.trim()) {
      onStop?.();
      return;
    }

    this.currentText = cleanText;
    this.currentOptions = { onStart, onStop, onError, voiceName };

    try {
        // 3.发起合成请求
      await this._speakWithWebSocket(cleanText, { onStart, onStop, onError, voiceName });
    } catch (error) {
      console.error('语音合成错误:', error);
      this._emit('error', { error, text: cleanText });
      onError?.(error);
    }
  }

  async _speakWithWebSocket(text, options = {}) {
    return new Promise((resolve, reject) => {
      // 重置状态
      this.streamEnded = false;

      // 初始化AudioPlayer
      if (!this.audioPlayer) {
        this.audioPlayer = new window.AudioPlayer(this.audioPlayerPath);
      }

      // 设置AudioPlayer回调
      this.audioPlayer.onPlay = () => {
        this.isPlaying = true;
        this._emit('start', { text: this.currentText });
        options.onStart?.();
      };

      this.audioPlayer.onStop = () => {
        this.isPlaying = false;
        const text = this.currentText;
        this.currentText = '';
        this._emit('end', { text });
        options.onStop?.();
      };

      // 启动AudioPlayer
      this.audioPlayer.start({
        autoPlay: true,
        sampleRate: 16000,
        resumePlayDuration: 1000
      });
    // 连接WebSocket服务器，发送连接请求并等待响应
      this.socket = new WebSocket(this.wsUrl);

      this.socket.onopen = () => {
        // 使用轮询等待 WebSocket 完全就绪
        const waitForReady = (retries = 0) => {
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            try {
              this.socket.send(JSON.stringify({ action: 'connect' }));
            } catch (e) {
              console.error('TTS 发送连接消息失败:', e);
              reject(e);
            }
          } else if (retries < 10) {
            setTimeout(() => waitForReady(retries + 1), 20);
          } else {
            console.error('TTS WebSocket 连接超时，当前状态:', this.socket?.readyState);
            reject(new Error('WebSocket 连接超时'));
          }
        };
        waitForReady();
      };

      this.socket.onmessage = (event) => {
        try {
          let response;
          if (typeof event.data === 'string') {
            response = JSON.parse(event.data);
          } else {
            return;
          }

          if (response.error) {
            reject(new Error(response.error));
            return;
          }

          if (response.status === 'connected') {
            // 确保 WebSocket 状态就绪后再发送
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
              this._sendTTSRequest(text, options.voiceName);
            } else {
              console.warn('TTS 收到 connected 响应，但 socket 未就绪');
            }
            return;
          }

          if (response.status === 'closed') {
            this._handleStreamEnd();
            resolve();
            return;
          }

          // 处理讯飞返回的音频数据
          if (response.type === 'audio' && response.data) {
            // 将音频数据传递给AudioPlayer
            this.audioPlayer.postMessage({
              type: 'base64',
              data: response.data,
              isLastData: response.status === 2
            });

            if (response.status === 2) {
              this._handleStreamEnd();
              this.socket.close();
              resolve();
            }
            return;
          }

          // 处理原始讯飞格式的响应
          if (response.code === 0 && response.data && response.data.audio) {
            this.audioPlayer.postMessage({
              type: 'base64',
              data: response.data.audio,
              isLastData: response.data.status === 2
            });

            if (response.data.status === 2) {
              this._handleStreamEnd();
              this.socket.close();
              resolve();
            }
            return;
          }

          if (response.code && response.code !== 0) {
            reject(new Error(response.message || '合成失败'));
          }
        } catch (error) {
          reject(error);
        }
      };

      this.socket.onclose = () => {
        this._handleStreamEnd();
      };

      this.socket.onerror = (error) => {
        console.error('WebSocket错误:', error);
        reject(new Error('WebSocket连接失败'));
      };
    });
  }

  /**
   * 处理流结束
   */
  _handleStreamEnd() {
    this.streamEnded = true;
    // AudioPlayer会自动处理结束逻辑
  }

  _sendTTSRequest(text, voiceName = 'x4_yezi') {
    if (!text || text.trim() === '') {
      console.error('错误: 合成文本不能为空');
      return;
    }

    // 检查 WebSocket 状态，确保已连接
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('TTS WebSocket 未就绪，当前状态:', this.socket?.readyState, '期望状态:', WebSocket.OPEN);
      return;
    }

    const encodedText = btoa(unescape(encodeURIComponent(text)));

    const fullFrame = {
      common: {
        app_id: '130cba7b'
      },
      business: {
        aue: 'raw',    // 音频格式为原始PCM
        auf: 'audio/L16;rate=16000',   // 音频编码格式为L16，采样率为16000Hz
        vcn: voiceName,   // 发音人
        speed: 70,  // 语速，范围0-100
        volume: 50,   // 音量，范围0-100
        pitch: 50,   // 音高，范围0-100
        tte: 'utf8',   // 文本编码格式为utf8
        sfl: 1   // 是否流式返回音频，1为流式返回
      },
      data: {
        status: 2,
        text: encodedText
      }
    };

    try {
      this.socket.send(JSON.stringify(fullFrame));
    } catch (e) {
      console.error('TTS 发送请求失败:', e);
    }
  }

  stop() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }

    // 停止AudioPlayer
    if (this.audioPlayer) {
      this.audioPlayer.stop();
    }

    this.isPlaying = false;
    this.currentText = '';
    this.streamEnded = false;
  }

  /**
   * 检查是否真正在播放
   */
  isActuallyPlaying() {
    return this.isPlaying && this.audioPlayer && this.audioPlayer.status === 'play';
  }

  pause() {
    // AudioPlayer不直接支持暂停，可以通过stop实现
    if (this.isPlaying && this.audioPlayer) {
      console.warn('AudioPlayer不支持暂停，将停止播放');
      this.stop();
    }
  }

  resume() {
    // AudioPlayer不支持恢复，需要重新播放
    console.warn('AudioPlayer不支持恢复播放');
  }

  getVoices() {
    return [
      { name: 'x4_xiaoyan', lang: 'zh-CN', localService: false, voiceURI: 'x4_xiaoyan' },
      { name: 'x4_xiaofeng', lang: 'zh-CN', localService: false, voiceURI: 'x4_xiaofeng' },
      { name: 'x4_xiaoqian', lang: 'zh-CN', localService: false, voiceURI: 'x4_xiaoqian' },
      { name: 'x4_yezi', lang: 'zh-CN', localService: false, voiceURI: 'x4_yezi' }
    ];
  }

  getState() {
    return {
      speaking: this.isPlaying,
      paused: this.isPaused,
      pending: false,
      isReady: this.isReady,
      voicesCount: this.getVoices().length,
    };
  }

  isSupported() {
    return typeof WebSocket !== 'undefined' && typeof window.AudioPlayer !== 'undefined';
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) callbacks.splice(index, 1);
  }

  destroy() {
    this.stop();
    
    // 重置AudioPlayer
    if (this.audioPlayer) {
      this.audioPlayer.reset();
      this.audioPlayer = null;
    }
    
    this.listeners.clear();
    this.isReady = false;
    this.currentOptions = null;
  }

  _cleanText(html) {
    if (typeof html !== 'string') return '';
    const text = html.replace(/<[^>]*>/g, '');
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value.trim();
  }

  _emit(event, data) {
    if (!this.listeners.has(event)) return;
    this.listeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in ${event} listener:`, error);
      }
    });
  }

  /**
   * 设置AudioPlayer资源路径
   */
  setAudioPlayerPath(path) {
    this.audioPlayerPath = path;
  }

  /**
   * 获取音频数据Blob（支持PCM和WAV格式）
   */
  getAudioDataBlob(format = 'wav') {
    if (!this.audioPlayer) {
      return null;
    }
    return this.audioPlayer.getAudioDataBlob(format);
  }
}

export default VoiceSynthesizer;