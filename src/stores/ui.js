import { defineStore } from 'pinia'

export const useUIStore = defineStore('ui', () => {
  // UI 状态
  const isAnimationSwitching = ref(false)
  const actionStatus = ref(false)
  const currentAction = ref('')
  const selectedAvatar = ref('')
  const selectedBackground = ref('')
  const actionImagesPreloaded = ref(false)
  const isHangupActive = ref(false)

  // Intro 文本（通过模板展示，不直接操作 DOM）
  const introText = ref('')

  // 动作库文本轮播相关状态
  const actionTextTimer = ref(null)
  const actionTextIndex = ref(0)
  const actionTextList = ref([])

  // 页面状态
  const currentPage = ref('main') // main, voice, action
  const isLoading = ref(false)
  const isTyping = ref(false)
  const typewriterTimeoutId = ref(null)

  // 弹窗状态
  const showIntroPopup = ref(false)
  const showActionList = ref(false)
  const showQRCode = ref(false)
  const showSuccessStatus = ref(false)

  // 手势检测状态
  const gestureState = reactive({
    gestureDetectionStarted: false,
    welcomeEntered: false
  })

  // 缓存常用DOM元素
  const domCache = reactive({
    $introPopup: null,
    // 不再直接操作 introText 的 DOM，保留字段以兼容旧逻辑
    // $introText: null,
    $actionList: null
  })

  // 计算属性
  const isActionLibraryVisible = computed(() => actionStatus.value)
  const canSwitchAction = computed(() => !isAnimationSwitching.value)

  // 动作
  const setAnimationSwitching = (switching) => {
    isAnimationSwitching.value = switching
  }

  const setActionStatus = (status) => {
    actionStatus.value = status
  }

  const setCurrentAction = (action) => {
    if (canSwitchAction.value) {
      currentAction.value = action
    }
  }

  // 强制设置当前动作（忽略动画切换中的限制）
  const forceSetCurrentAction = (action) => {
    currentAction.value = action
  }

  const setSelectedAvatar = (avatar) => {
    selectedAvatar.value = avatar
  }

  const setSelectedBackground = (bg) => {
    selectedBackground.value = bg
  }

  const setActionImagesPreloaded = (preloaded) => {
    actionImagesPreloaded.value = preloaded
  }

  const setHangupActive = (active) => {
    isHangupActive.value = active
  }

  const setCurrentPage = (page) => {
    currentPage.value = page
  }

  const setLoading = (loading) => {
    isLoading.value = loading
  }

  const setTyping = (typing) => {
    isTyping.value = typing
  }

  const setTypewriterTimeoutId = (id) => {
    typewriterTimeoutId.value = id
  }

  // 新增setter方法
  const setActionTextList = (textList) => {
    actionTextList.value = textList
  }

  const setActionTextIndex = (index) => {
    actionTextIndex.value = index
  }

  const setActionTextTimer = (timer) => {
    actionTextTimer.value = timer
  }

  const showPopup = (popupType) => {
    switch (popupType) {
      case 'intro':
        showIntroPopup.value = true
        break
      case 'actionList':
        showActionList.value = true
        break
      case 'qrCode':
        showQRCode.value = true
        break
      case 'success':
        showSuccessStatus.value = true
        break
    }
  }

  const hidePopup = (popupType) => {
    switch (popupType) {
      case 'intro':
        showIntroPopup.value = false
        break
      case 'actionList':
        showActionList.value = false
        break
      case 'qrCode':
        showQRCode.value = false
        break
      case 'success':
        showSuccessStatus.value = false
        break
    }
  }

  const hideAllPopups = () => {
    showIntroPopup.value = false
    showActionList.value = false
    showQRCode.value = false
    showSuccessStatus.value = false
  }

  // 设置/清空 Intro 文本
  const setIntroText = (text) => {
    introText.value = (text || '').toString()
  }
  const clearIntroText = () => {
    introText.value = ''
  }

  // 动作库文本轮播
  const startActionTextRotation = (textList) => {
    setActionTextList(textList)
    setActionTextIndex(0)
    
    if (actionTextTimer.value) {
      clearInterval(actionTextTimer.value)
    }
    
    setActionTextTimer(setInterval(() => {
      setActionTextIndex((actionTextIndex.value + 1) % textList.length)
    }, 3000))
  }

  const stopActionTextRotation = () => {
    if (actionTextTimer.value) {
      clearInterval(actionTextTimer.value)
      setActionTextTimer(null)
    }
    setActionTextList([])
    setActionTextIndex(0)
  }

  // 手势检测
  const setGestureDetectionStarted = (started) => {
    gestureState.gestureDetectionStarted = started
  }

  const setWelcomeEntered = (entered) => {
    gestureState.welcomeEntered = entered
  }

  // DOM 缓存管理
  const cacheDOMElement = (key, element) => {
    domCache[key] = element
  }

  const getCachedDOMElement = (key) => {
    return domCache[key]
  }

  const clearDOMCache = () => {
    Object.keys(domCache).forEach(key => {
      domCache[key] = null
    })
  }

  // 页面切换
  const switchToMainPage = () => {
    setCurrentPage('main')
    hideAllPopups()
  }

  const switchToVoicePage = () => {
    setCurrentPage('voice')
  }


  // 重置状态
  const reset = () => {
    setAnimationSwitching(false)
    setActionStatus(false)
    setCurrentAction('static')
    setActionImagesPreloaded(false)
    setHangupActive(false)
    setCurrentPage('main')
    setLoading(false)
    setTyping(false)
    setTypewriterTimeoutId(null)
    hideAllPopups()
    stopActionTextRotation()
    gestureState.gestureDetectionStarted = false
    gestureState.welcomeEntered = false
    clearDOMCache()
  }

  // 清理资源
  const cleanup = () => {
    stopActionTextRotation()
    if (typewriterTimeoutId.value) {
      clearTimeout(typewriterTimeoutId.value)
    }
    clearDOMCache()
  }

  return {
    // 状态
    isAnimationSwitching,
    actionStatus,
    currentAction,
    selectedAvatar,
    selectedBackground,
    actionImagesPreloaded,
    isHangupActive,
    introText,
    actionTextTimer,
    actionTextIndex,
    actionTextList,
    currentPage,
    isLoading,
    isTyping,
    typewriterTimeoutId,
    showIntroPopup,
    showActionList,
    showQRCode,
    showSuccessStatus,
    gestureState: readonly(gestureState),
    domCache: readonly(domCache),
    
    // 计算属性
    isActionLibraryVisible,
    canSwitchAction,
    
    // 动作
    setAnimationSwitching,
    setActionStatus,
    setCurrentAction,
    forceSetCurrentAction,
    setSelectedAvatar,
    setSelectedBackground,
    setActionImagesPreloaded,
    setHangupActive,
    setCurrentPage,
    setLoading,
    setTyping,
    setTypewriterTimeoutId,
    setActionTextList,
    setActionTextIndex,
    setActionTextTimer,
    showPopup,
    hidePopup,
    hideAllPopups,
    setIntroText,
    clearIntroText,
    startActionTextRotation,
    stopActionTextRotation,
    setGestureDetectionStarted,
    setWelcomeEntered,
    cacheDOMElement,
    getCachedDOMElement,
    clearDOMCache,
    switchToMainPage,
    switchToVoicePage,
    reset,
    cleanup
  }
})