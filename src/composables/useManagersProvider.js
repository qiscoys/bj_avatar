import { useAudio } from './useAudio'
import { useSpeechSynthesis } from './useSpeechSynthesis'
import { useSpeechRecognition } from './useSpeechRecognition'
// import { useAvatarState } from './useAvatarState'
import { useChatState } from './useChatState'
import { useUI } from './useUI'
import { useUtils } from './useUtils'
import { useAvatarStore, useUIStore, useSpeechStore, useGlobalStore } from '@/stores'
import { useConfig } from '@/composables/useConfig'
import cameraService from '@/utils/camera.js'

// 注入键
const MANAGERS_KEY = Symbol('managers')

/**
 * 管理器提供者 Composable
 * 用于在根组件中初始化和提供所有管理器
 */
export function useManagersProvider(options = {}) {
  const { config } = useConfig()

  // 初始化 Pinia stores
  const avatarStore = useAvatarStore()
  const uiStore = useUIStore()
  const speechStore = useSpeechStore()
  const globalStore = useGlobalStore()

  // 初始化所有Composables
  const audio = useAudio()
  const speechSynthesis = useSpeechSynthesis()
  const speechRecognition = useSpeechRecognition()

  // 传递 bussDialogueArr 给 avatarState，同时注入 stores
  const avatarState = useChatState(avatarStore.bussDialogueArr, { avatarStore, uiStore, speechStore })

  const utils = useUtils()

  // 立即设置 window.utils 以确保其他组件可以访问
  window.utils = window.utils || {}
  window.utils.eventManager = utils.eventManager
  window.utils.typeWriter = utils.typeWriter
  // window.utils.typeWriterForChat = utils.typeWriterForChat
  window.utils.stopTypewriter = utils.stopTypewriter
  // window.utils.generatePresetQuestions = utils.generatePresetQuestions
  window.utils.escapeHtml = utils.escapeHtml
  window.utils.imagePreloader = utils.imagePreloader
  window.utils.timerManager = utils.timerManager

  const ui = useUI({ uiStore, avatarStore, speechStore })

  // 使用 Pinia stores 替代本地状态
  const globalState = computed(() => ({
    currentAvatar: avatarStore.currentAvatar,
    isVoiceRecording: speechStore.isVoiceRecording,
    typewriterTimeoutId: uiStore.typewriterTimeoutId,
    isTyping: uiStore.isTyping,
    currentQuestion: globalStore.business.currentQuestion,
    currentAnswerText: globalStore.business.currentAnswerText,
    imagePreloadComplete: globalStore.business.imagePreloadComplete,
    isAnimationSwitching: uiStore.isAnimationSwitching,
    voiceReplyMsgId: speechStore.voiceChat.voiceReplyMsgId,
    lastVoiceReply: speechStore.voiceChat.lastVoiceReply,
    isHangupActive: speechStore.voiceChat.isHangupActive,
    bussDialogueArr: avatarStore.bussDialogueArr
  }))

  // 手势检测状态使用 UI store
  const gestureState = computed(() => uiStore.gestureState)

  /**
   * 设置管理器之间的依赖关系
   */
  const setupManagerDependencies = () => {

    // 设置音频管理器的语音合成依赖
    audio.setSpeechSynthesisManager(speechSynthesis)
    // 注入事件管理器用于派发/监听自定义事件
    audio.setEventManager(utils.eventManager)

    // 设置头像状态管理器的依赖（添加 speechRecognition）
    avatarState.setManagers(audio, ui, utils, speechRecognition)

    // 设置语音识别的依赖（添加 uiStore）
    speechRecognition.setManagers(avatarState, ui, audio, utils, uiStore)

    // 设置UI管理器的依赖
    ui.setManagers(avatarState, audio, speechRecognition, utils)
  }

  /**
   * 初始化全局事件监听
   */
  const initGlobalEvents = () => {
    // 页面可见性变化
    utils.eventManager.on(document, 'visibilitychange', () => {
      if (document.hidden) {
        handlePageHidden()
      } else {
        handlePageVisible()
      }
    })

    // 用户手势解锁事件
    utils.eventManager.on(document, 'userGestureUnlocked', () => {
      speechSynthesis.unlock()
    })

    // 形象切换事件
    utils.eventManager.on(document, 'avatarChanged', ({ detail }) => {
      const { avatar, background } = detail
      console.log('形象已切换:', avatar, '背景已切换:', background)

      avatarState.setCurrentAvatar(avatar)

      const state = avatarState.getCurrentState()
      const inBusiness = avatarState.getCurrentBusinessFlow() !== null
      if (state === config?.states?.WELCOME && !inBusiness) {
        setTimeout(() => audio.playIndexAudio(), 500)
      }
    })

    // 页面卸载清理
    utils.eventManager.on(window, 'beforeunload', () => {
      cleanup()
    })
  }

  /**
   * 页面隐藏处理
   */
  const handlePageHidden = () => {
    console.log('页面隐藏，停止所有活动')
    audio.stopCurrentAudio()
    if (speechRecognition.isRecording()) {
      speechRecognition.stop()
    }
    avatarState.stopDialogueLoop()
  }

  /**
   * 页面显示处理
   */
  const handlePageVisible = () => {
    console.log('页面显示，恢复活动状态')
    const currentState = avatarState.getCurrentState()
    if (currentState === config?.states?.WELCOME && !avatarState.getCurrentBusinessFlow()) {
      avatarState.handleWelcomeState()
    }
  }

  /**
   * 手势检测回调
   */
  const onGestureDetected = async () => {
    if (gestureState.welcomeEntered) return
    gestureState.welcomeEntered = true
    console.log('手势检测到挥手，进入欢迎状态')

    await cameraService.stopDetection()

    // 触发解锁事件
    utils.eventManager.emit(document, 'userGestureUnlocked')

    avatarState.handleWelcomeState()
  }

  /**
   * 启动手势检测
   */
  const startGestureDetection = async () => {
    if (gestureState.gestureDetectionStarted) return
    gestureState.gestureDetectionStarted = true

    try {
      cameraService.on('onWaveDetected', onGestureDetected)
      await cameraService.initCamera()
      await cameraService.startDetection()
      console.log('手势检测已启动，请挥手解锁...')
    } catch (error) {
      console.error('手势检测初始化失败:', error)
    }
  }

  /**
   * 全局动作执行函数
   */
  const executeAction = (action) => {
    console.log('执行动作:', action)

    // 切换动作
    ui.switchAction(action)

    // 更新激活状态
    const actionItems = document.querySelectorAll('.action_list li')
    actionItems.forEach(item => {
      item.classList.remove('active')
      if (item.getAttribute('data-ani') === action) {
        item.classList.add('active')
      }
    })
  }

  /**
   * 初始化所有管理器
   */
  const init = async () => {

    // 设置依赖关系
    setupManagerDependencies()

    // 初始化全局事件
    initGlobalEvents()

    // 初始化UI管理器
    ui.init()

    // 挂载兼容的全局引用（过渡期保留）
    window.audioManager = audio
    window.speechSynthesisManager = speechSynthesis
    window.avatarStateManager = avatarState
    window.uiManager = ui
    window.speechRecognitionManager = speechRecognition

    // 启动手势检测
    if (document.readyState === 'complete') {
      await startGestureDetection()
    } else {
      utils.eventManager.on(window, 'load', startGestureDetection)
    }

    // 暴露全局函数
    window.executeAction = executeAction
  }

  /**
   * 清理资源
   */
  const cleanup = () => {
    cameraService.stopDetection?.()
    utils.eventManager.clear()
    audio.destroy?.()
    speechSynthesis.cleanup?.()
    speechRecognition.destroy?.()
    avatarState.destroy?.()
    ui.cleanup?.()
  }

  // 创建管理器集合
  const managers = {
    audio,
    speechSynthesis,
    speechRecognition,
    avatarState,
    ui,
    utils,
    globalState,
    gestureState,

    // 方法
    init,
    cleanup,
    executeAction,
    handlePageHidden,
    handlePageVisible,
    startGestureDetection,
    onGestureDetected
  }

  // 提供给子组件
  provide(MANAGERS_KEY, managers)

  // 组件挂载时初始化
  onMounted(() => {
    init()
  })

  // 组件卸载时清理
  onUnmounted(() => {
    cleanup()
  })

  return managers
}

/**
 * 管理器消费者 Composable
 * 用于在子组件中注入管理器
 */
export function useManagers() {
  const managers = inject(MANAGERS_KEY)

  if (!managers) {
    throw new Error('useManagers must be used within a component that provides managers')
  }

  return managers
}
