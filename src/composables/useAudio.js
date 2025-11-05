/**
 * 音频管理 Composable
 * 提供音频播放、语音合成、音效播放等功能
 */
import { useSpeechStore } from '@/stores'

export function useAudio() {
  const speechStore = useSpeechStore()

  const currentAudio = ref(null);
  const isPlaying = ref(false);
  const sfxAudios = ref([]);
  const speechManager = ref(null);
  const eventMgr = ref(null);

  // 注入事件管理器
  const setEventManager = (manager) => {
    eventMgr.value = manager;
  };

  // 派发音频事件
  const dispatchAudioEvent = (eventName) => {
    if (eventMgr.value?.emit) {
      try { eventMgr.value.emit(document, eventName); } catch {}
      try { eventMgr.value.emit(window, eventName); } catch {}
      return;
    }
    const event = new CustomEvent(eventName);
    document.dispatchEvent(event);
  };

  // 停止音频元素
  const stopAudioElement = (audio) => {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (err) {
      console.error('停止音频时出错:', err);
    }
  };

  // 停止当前音频/语音合成
  const stopCurrentAudio = () => {
    speechManager.value?.stop();

    if (currentAudio.value) {
      stopAudioElement(currentAudio.value);
      speechStore.setCurrentAudio(null);
    }

    // 停止页面上所有未暂停的音频
    document.querySelectorAll('audio').forEach(a => {
      if (!a.paused) stopAudioElement(a);
    });

    speechStore.setAudioPlaying(false);
  };

  // 判断是否为音频文件
  const isAudioFile = (input) => /\.(mp3|wav|ogg|m4a|aac)$/i.test(input);

  // 创建并播放音频
  const createAndPlayAudio = (src, onFinish) => {
    try {
      const audio = new Audio(src);

      const handleEnd = () => {
        onFinish?.();
      };

      audio.addEventListener('ended', handleEnd);
      audio.addEventListener('error', (e) => {
        console.error('音频播放错误:', src, e);
        try { audio.pause(); } catch {}
        onFinish?.();
      });

      audio.play()
        .then()
        .catch(err => {
          onFinish?.();
        });

      return audio;
    } catch (err) {
      onFinish?.();
      return null;
    }
  };

  // 使用语音合成播放文本
  const playSpeechSynthesis = (text, callback) => {
    if (!speechManager.value) {
      console.error('SpeechSynthesisManager未初始化');
      callback?.();
      return;
    }

    if (currentAudio.value) {
      stopAudioElement(currentAudio.value);
      speechStore.setCurrentAudio(null);
    }

    const handleEnd = () => {
      callback?.();
      dispatchAudioEvent('speechEnd');
    };

    speechManager.value.speak(text, {
      onStart: () => dispatchAudioEvent('speechStart'),
      onStop: handleEnd,
      onError: handleEnd,
    });
  };

  // 播放自定义音频 - 支持语音合成和传统音频
  const playCustomAudio = (audioPath, callback) => {
    if (!isAudioFile(audioPath)) {
      playSpeechSynthesis(audioPath, callback);
      return;
    }

    stopCurrentAudio();
    dispatchAudioEvent('speechStart');

    currentAudio.value = createAndPlayAudio(audioPath, () => {
      speechStore.setAudioPlaying(false);
      speechStore.setCurrentAudio(null);
      callback?.();
      dispatchAudioEvent('speechEnd');
    });

    speechStore.setAudioPlaying(!!currentAudio.value);
  };

  // 播放首页音频（仅派发事件）
  const playIndexAudio = () => dispatchAudioEvent('playIndexAudio');

  // 检查是否正在播放
  const isCurrentlyPlaying = () => {
    try {
      // 以全局 Store 状态为准：TTS 播放或任意音频播放
      return !!(speechStore.synthesis.isSpeaking || speechStore.audio.isPlaying)
    } catch {
      return false
    }
  }

  // 并行播放动作音效
  const playSfx = (audioPath, callback) => {
    if (!isAudioFile(audioPath)) {
      callback?.();
      return;
    }

    const sfxAudio = createAndPlayAudio(audioPath, () => {
      sfxAudios.value = sfxAudios.value.filter(a => a !== sfxAudio);
      callback?.();
    });

    if (sfxAudio) sfxAudios.value.push(sfxAudio);
  };

  // 设置语音合成管理器
  const setSpeechSynthesisManager = (manager) => {
    speechManager.value = manager;
  };

  // 组件卸载时清理
  onUnmounted(stopCurrentAudio);

  return {
    // 状态
    currentAudio: readonly(currentAudio),
    isPlaying: readonly(isPlaying),
    sfxAudios: readonly(sfxAudios),

    // 方法
    stopCurrentAudio,
    playCustomAudio,
    playSpeechSynthesis,
    playIndexAudio,
    isCurrentlyPlaying,
    playSfx,
    setSpeechSynthesisManager,
    setEventManager,
  };
}
