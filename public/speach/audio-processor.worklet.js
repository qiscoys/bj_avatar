/**
 * AudioWorklet 音频处理器
 * 用于替代已废弃的 ScriptProcessorNode
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.isListening = false;

    // 监听主线程消息
    this.port.onmessage = (event) => {
      const { type } = event.data;

      if (type === 'start') {
        this.isListening = true;
        this.buffer = [];
      } else if (type === 'stop') {
        this.isListening = false;
        // 发送剩余缓冲数据
        if (this.buffer.length > 0) {
          this.port.postMessage({
            type: 'audiodata',
            data: new Float32Array(this.buffer)
          });
          this.buffer = [];
        }
      } else if (type === 'pause') {
        this.isListening = false;
      } else if (type === 'resume') {
        this.isListening = true;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (!this.isListening || !input || !input[0]) {
      return true;
    }

    const channelData = input[0];

    // 添加到缓冲区
    for (let i = 0; i < channelData.length; i++) {
      this.buffer.push(channelData[i]);
    }

    // 当缓冲区达到一定大小时发送数据
    // 4096 samples，约 85ms @ 48kHz
    if (this.buffer.length >= 4096) {
      this.port.postMessage({
        type: 'audiodata',
        data: new Float32Array(this.buffer)
      });
      this.buffer = [];
    }

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);

