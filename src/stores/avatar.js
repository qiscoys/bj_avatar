import { defineStore } from 'pinia'
import { useConfig } from '@/composables/useConfig'

export const useAvatarStore = defineStore('avatar', () => {
  const { config } = useConfig()
  
  // 状态
  const state = reactive({
    current: config.states?.WELCOME || 'welcome',
    businessFlow: null,
    businessStep: 0,
    isProcessingBusiness: false,
    isSpeaking: false,
    isManualMode: false,
    dialogueIndex: 0,
    dialogueLoopOwner: null,
    action: 'static',
    pendingAction: null,
    isAnimationSwitching: false
  })

  const currentAvatar = ref(config.initAvatar)
  const currentBg = ref(config.initBg)
  const bussDialogueArr = ref([])

  // 计算属性
  const isInWelcomeState = computed(() => state.current === (config.states?.WELCOME || 'welcome'))
  const isInBusinessState = computed(() => state.current === (config.states?.BUSINESS_PROCESSING || 'business'))
  const isProcessingBusinessFlow = computed(() => state.isProcessingBusiness)

  // 动作
  const switchState = (newState, params = {}) => {
    console.log(`状态切换: ${state.current} -> ${newState}`)
    state.current = newState
    
    // 根据状态执行相应处理
    if (newState === (config.states?.WELCOME || 'welcome')) {
      handleWelcomeState()
    } else if (newState === (config.states?.AWAKENED || 'awakened')) {
      handleAwakenedState()
    } else if (newState === (config.states?.BUSINESS_PROCESSING || 'business')) {
      handleBusinessState(params.businessKey)
    }
  }

  const handleWelcomeState = () => {
    state.dialogueIndex = 0
    state.isProcessingBusiness = false
    state.businessFlow = null
    state.businessStep = 0
  }

  const handleAwakenedState = () => {
    state.dialogueIndex = 0
  }

  const handleBusinessState = (businessKey) => {
    if (businessKey) {
      state.businessFlow = businessKey
      state.businessStep = 0
      state.isProcessingBusiness = true
    }
  }

  const setCurrentAvatar = (avatar) => {
    currentAvatar.value = avatar
  }

  const setCurrentBg = (bg) => {
    currentBg.value = bg
  }

  const setAvatarAction = (action) => {
    if (state.isAnimationSwitching) {
      state.pendingAction = action
      return
    }
    
    state.action = action
    state.isAnimationSwitching = true
    
    // 模拟动画切换完成
    setTimeout(() => {
      state.isAnimationSwitching = false
      if (state.pendingAction) {
        const nextAction = state.pendingAction
        state.pendingAction = null
        setAvatarAction(nextAction)
      }
    }, 300)
  }

  const setManualMode = (enabled) => {
    state.isManualMode = enabled
  }

  const setSpeakingState = (isSpeaking) => {
    state.isSpeaking = isSpeaking
  }

  const pushUserDialogue = (text) => {
    bussDialogueArr.value.push({
      type: 'user',
      text: text
    })
  }

  const pushAssistantDialogue = (text) => {
    bussDialogueArr.value.push({
      type: 'assistant',
      text: text
    })
  }

  const clearDialogue = () => {
    bussDialogueArr.value = []
  }

  const exitBusiness = () => {
    state.isProcessingBusiness = false
    state.businessFlow = null
    state.businessStep = 0
    switchState(config.states?.WELCOME || 'welcome')
  }

  const reset = () => {
    Object.assign(state, {
      current: config.states?.WELCOME || 'welcome',
      businessFlow: null,
      businessStep: 0,
      isProcessingBusiness: false,
      isSpeaking: false,
      isManualMode: false,
      dialogueIndex: 0,
      dialogueLoopOwner: null,
      action: 'static',
      pendingAction: null,
      isAnimationSwitching: false
    })
    clearDialogue()
  }

  return {
    // 状态
    state: readonly(state),
    currentAvatar,
    currentBg,
    bussDialogueArr,
    
    // 计算属性
    isInWelcomeState,
    isInBusinessState,
    isProcessingBusinessFlow,
    
    // 动作
    switchState,
    handleWelcomeState,
    handleAwakenedState,
    handleBusinessState,
    setCurrentAvatar,
    setCurrentBg,
    setAvatarAction,
    setManualMode,
    setSpeakingState,
    pushUserDialogue,
    pushAssistantDialogue,
    clearDialogue,
    exitBusiness,
    reset
  }
})