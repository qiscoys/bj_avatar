<script setup>
import { useManagers } from '@/composables/useManagersProvider';

/* 录音对话按钮，负责语音收集及调用语音相关工具进行识别等，并反馈识别结果到父组件做相应处理 */

// 获取管理器
const { speechRecognition } = useManagers();

// 响应式状态：连接成功且未在播放合成音频时显示recording动画
const isRecordingActive = computed(() => {
  return Boolean(
    speechRecognition.isConnected?.value &&
    !speechRecognition.speechSynthesisActive?.value
  )
})

// 语音合成播放时且支持打断的状态
const isInterruptionMode = computed(() => {
  return Boolean(
    speechRecognition.isConnected?.value &&
    speechRecognition.speechSynthesisActive?.value &&
    speechRecognition.allowInterruption?.value
  )
})

const bars = Array.from({ length: 16 }).map(() => ({
  height: (Math.random() * (0.4 - 0.09) + 0.09).toFixed(3),
  delay: (Math.random() * (1.6 - 0.5) + 0.5).toFixed(2),
}));
</script>

<template>
  <button
    class="btn flex-c record-btn"
    :class="{ 
      recording: isRecordingActive,
      interruption: isInterruptionMode 
    }"
  >
    <div class="voice-wave mgr-10">
      <div
        class="bar"
        :class="'bar' + [index + 1]"
        v-for="(bar, index) in bars"
        :key="index"
        :style="{
          height: bar.height + 'rem',
          animationDuration: bar.delay + 's',
        }"
      ></div>
    </div>
  </button>
</template>

<style lang="scss" scoped>
.record-btn {
  position: fixed;
  right: 0.7rem;
  top: 0.25rem;
  transform: scale(1.38);
  font-size: 0.28rem;
  color: #ffffff;
  height: 0.6rem;
  background: unset;
  margin: 0.1rem;
  padding: unset;
  z-index: 999;
}

.record-btn .voice-wave {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 0.3rem;
  gap: 0.07rem;
}
.record-btn.recording .voice-wave {
  height: 0.2rem;
  gap: 0.07rem;
}

.record-btn .bar {
  width: 0.04rem;
  height: 0.2rem;
  background: #ffffff;
  box-shadow: 0 0.02rem 0.08rem rgba(0, 76, 255, 0.6);
  border-radius: 0.03rem;
  transform-origin: center center;
}
.record-btn.recording .bar {
  width: 0.04rem;
  background: #00ff77;
  box-shadow: 0 0.02rem 0.08rem rgba(194, 250, 205, 0.6);
  transition: all 0.3s;
  animation: barAnim 2s infinite ease-in-out;
}

/* 音频被占用时 */
.record-btn.interruption .bar {
  width: 0.04rem;
  transition: all 0.3s;
  animation: interruptionAnim 1.5s infinite ease-in-out;
  background: #ffffff; 
}

@keyframes barAnim {
  0%,
  100% {
    height: 0.06rem;
  }
  50% {
    height: 0.35rem;
  }
}

@keyframes interruptionAnim {
  0%,
  100% {
    height: 0.08rem;
    opacity: 0.7;
  }
  50% {
    height: 0.25rem;
    opacity: 1;
  }
}
</style>
