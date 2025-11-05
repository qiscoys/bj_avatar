import VoiceSynthesizer from '@/utils/SpeechSynthesis.js';
import { useSpeechStore, useAvatarStore } from '@/stores'
import { useConfig } from '@/composables/useConfig'

/**
 * 语音合成 Composable
 */
export function useSpeechSynthesis() {
  const speechStore = useSpeechStore()
  const avatarStore = useAvatarStore()
  const { config } = useConfig()
  
  // 响应式状态
  const voices = ref([]);
  const defaultVoice = ref(null);
  const isPlaying = ref(false);
  
  let synthesizer = null;

  /**
   * 发送自定义事件到 document
   */
  const emitEvent = (eventName) => {
    document.dispatchEvent(new CustomEvent(eventName));
  };

  /**
   * 初始化语音合成器
   */
  const initSynthesizer = async () => {
    if (synthesizer) return true;

    try {
      synthesizer = new VoiceSynthesizer();
      await synthesizer.init();
      
      // 监听开始事件
      synthesizer.on('start', () => {
        speechStore.setSpeakingState(true);
        emitEvent('speechStart');
      });
      
      // 监听结束事件
      synthesizer.on('end', () => {
        speechStore.setSpeakingState(false);
        emitEvent('speechEnd');
      });
      
      // 监听错误事件
      synthesizer.on('error', () => {
        speechStore.setSpeakingState(false);
        emitEvent('speechError');
      });
      
      // 监听打断事件
      document.addEventListener('speechSynthesisInterrupted', async () => {
        await stop()
      });
      
      // 初次加载语音列表
      const voiceList = synthesizer.getVoices();
      loadVoices(voiceList);

      return true;
    } catch (error) {
      return false;
    }
  };

  /**
   * 加载可用的语音列表
   */
  const loadVoices = (voiceList) => {
    voices.value = voiceList || [];
    
    // 科大讯飞默认使用小燕语音
    defaultVoice.value = voices.value.find(v => v.name === 'x4_xiaoyan') || voices.value[0];
  };

  /**
   * 获取当前形象的发音人
   */
  const getCurrentVoiceName = () => {
    const currentAvatarId = avatarStore.currentAvatar;
    const avatarConfig = config.avatars?.[currentAvatarId];
    const voiceName = avatarConfig?.voiceName || 'x4_yezi'; // 默认使用 x4_yezi

    console.log(`当前形象: ${currentAvatarId}, 发音人: ${voiceName}`);
    return voiceName;
  };

  /**
   * 播放文本
   * @param {string} text - 要播放的文本（支持 HTML）
   * @param {Object} options - 播放选项
   */
  const speak = async (text, options = {}) => {
    // 确保合成器已初始化
    if (!synthesizer) {
      const success = await initSynthesizer();
      if (!success) {
        options.onError?.('语音合成器初始化失败');
        return;
      }
    }

    // 获取当前形象的发音人
    const voiceName = getCurrentVoiceName();

    try {
      await synthesizer.speak(text, {
        // volume, rate, pitch 等参数在科大讯飞内部固定配置
        voiceName, // 传入发音人参数
        onStart: options.onStart,
        onEnd: options.onEnd,
        onError: options.onError,
      });
    } catch (error) {
      options.onError?.(error);
    }
  };

  /**
   * 停止当前语音播放
   */
  const stop = async () => {
    if (synthesizer) {
      await synthesizer.stop();
      speechStore.setSpeakingState(false);
      emitEvent('speechEnd');
    }
  };

  /**
   * 解锁语音合成
   * 某些浏览器需要用户交互后才能使用语音合成
   * @returns {Promise<boolean>}
   */
  const unlock = async () => {
    if (!synthesizer) {
      return await initSynthesizer();
    }
    return true;
  };

  /**
   * 组件卸载时清理资源
   */
  onUnmounted(() => {
    if (synthesizer) {
      synthesizer.destroy();
      synthesizer = null;
    }
  });

  // 自动初始化合成器
  initSynthesizer();

  return {
    // 响应式状态（只读）
    voices: readonly(voices),
    defaultVoice: readonly(defaultVoice),
    isPlaying: readonly(isPlaying),
    
    // 核心方法
    speak,
    stop,
    
    // 辅助方法
    unlock,
  };
}