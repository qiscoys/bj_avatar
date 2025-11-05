import { defineStore } from 'pinia'
import { useConfig } from '@/composables/useConfig'

export const useGlobalStore = defineStore('global', () => {
  const { config } = useConfig()
  
  // 全局应用状态
  const app = reactive({
    isInitialized: false,
    isLoading: false,
    error: null,
    version: '1.0.0',
    environment: import.meta.env.MODE || 'development'
  })

  // 用户状态
  const user = reactive({
    id: null,
    name: '',
    avatar: '',
    preferences: {
      language: 'zh-CN',
      theme: 'light',
      volume: 1,
      autoPlay: true
    }
  })

  // 设备信息
  const device = reactive({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    userAgent: '',
    platform: '',
    screenWidth: 0,
    screenHeight: 0,
    orientation: 'landscape'
  })

  // 网络状态
  const network = reactive({
    isOnline: navigator.onLine,
    connectionType: 'unknown',
    effectiveType: 'unknown',
    downlink: 0,
    rtt: 0
  })

  // 性能监控
  const performance = reactive({
    loadTime: 0,
    renderTime: 0,
    memoryUsage: 0,
    fps: 0,
    errors: []
  })

  // 业务数据
  const business = reactive({
    currentQuestion: null,
    currentAnswerText: '',
    imagePreloadComplete: false,
    presetQuestions: [],
    businessData: {
      recharge: {
        phone: '',
        amount: 0,
        step: 'info_input'
      },
      dataQuery: {
        phone: '',
        balance: 0,
        step: 'confirmation'
      }
    }
  })

  // 计算属性
  const isMobileDevice = computed(() => device.isMobile || device.isTablet)
  const isOnlineAndReady = computed(() => network.isOnline && app.isInitialized)
  const hasErrors = computed(() => performance.errors.length > 0)
  const currentBusinessData = computed(() => {
    const currentFlow = business.currentQuestion?.businessKey
    return currentFlow ? business.businessData[currentFlow] : null
  })

  // 应用状态动作
  const setInitialized = (initialized) => {
    app.isInitialized = initialized
  }

  const setLoading = (loading) => {
    app.isLoading = loading
  }

  const setError = (error) => {
    app.error = error
    if (error) {
      performance.errors.push({
        message: error.message || error,
        timestamp: Date.now(),
        stack: error.stack
      })
    }
  }

  const clearError = () => {
    app.error = null
  }

  // 用户状态动作
  const setUser = (userData) => {
    Object.assign(user, userData)
  }

  const updateUserPreferences = (preferences) => {
    Object.assign(user.preferences, preferences)
  }

  const setUserLanguage = (language) => {
    user.preferences.language = language
  }

  const setUserTheme = (theme) => {
    user.preferences.theme = theme
  }

  const setUserVolume = (volume) => {
    user.preferences.volume = Math.max(0, Math.min(1, volume))
  }

  const setAutoPlay = (autoPlay) => {
    user.preferences.autoPlay = autoPlay
  }

  // 设备信息动作
  const updateDeviceInfo = () => {
    const ua = navigator.userAgent
    device.userAgent = ua
    device.platform = navigator.platform
    device.screenWidth = window.screen.width
    device.screenHeight = window.screen.height
    device.orientation = window.screen.width > window.screen.height ? 'landscape' : 'portrait'
    
    // 简单的设备检测
    device.isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
    device.isTablet = /iPad|Android(?!.*Mobile)/i.test(ua)
    device.isDesktop = !device.isMobile && !device.isTablet
  }

  // 网络状态动作
  const updateNetworkStatus = () => {
    network.isOnline = navigator.onLine
    
    if ('connection' in navigator) {
      const connection = navigator.connection
      network.connectionType = connection.type || 'unknown'
      network.effectiveType = connection.effectiveType || 'unknown'
      network.downlink = connection.downlink || 0
      network.rtt = connection.rtt || 0
    }
  }

  // 性能监控动作
  const recordLoadTime = (time) => {
    performance.loadTime = time
  }

  const recordRenderTime = (time) => {
    performance.renderTime = time
  }

  const updateMemoryUsage = () => {
    if ('memory' in performance) {
      performance.memoryUsage = performance.memory.usedJSHeapSize || 0
    }
  }

  const recordError = (error) => {
    performance.errors.push({
      message: error.message || error,
      timestamp: Date.now(),
      stack: error.stack,
      url: window.location.href
    })
  }

  const clearErrors = () => {
    performance.errors = []
  }

  // 业务数据动作
  const setCurrentQuestion = (question) => {
    business.currentQuestion = question
  }

  const setCurrentAnswerText = (text) => {
    business.currentAnswerText = text
  }

  const setImagePreloadComplete = (complete) => {
    business.imagePreloadComplete = complete
  }

  const setPresetQuestions = (questions) => {
    business.presetQuestions = questions
  }

  const updateBusinessData = (businessKey, data) => {
    if (business.businessData[businessKey]) {
      Object.assign(business.businessData[businessKey], data)
    }
  }

  const resetBusinessData = (businessKey) => {
    if (businessKey && business.businessData[businessKey]) {
      if (businessKey === 'recharge') {
        Object.assign(business.businessData.recharge, {
          phone: '',
          amount: 0,
          step: 'info_input'
        })
      } else if (businessKey === 'dataQuery') {
        Object.assign(business.businessData.dataQuery, {
          phone: '',
          balance: 0,
          step: 'confirmation'
        })
      }
    }
  }

  // 初始化
  const initialize = async () => {
    try {
      setLoading(true)
      updateDeviceInfo()
      updateNetworkStatus()
      
      // 监听网络状态变化
      window.addEventListener('online', updateNetworkStatus)
      window.addEventListener('offline', updateNetworkStatus)
      
      // 监听窗口大小变化
      window.addEventListener('resize', updateDeviceInfo)
      
      setInitialized(true)
    } catch (error) {
      setError(error)
    } finally {
      setLoading(false)
    }
  }

  // 清理资源
  const cleanup = () => {
    window.removeEventListener('online', updateNetworkStatus)
    window.removeEventListener('offline', updateNetworkStatus)
    window.removeEventListener('resize', updateDeviceInfo)
  }

  // 重置所有状态
  const reset = () => {
    Object.assign(app, {
      isInitialized: false,
      isLoading: false,
      error: null
    })
    
    Object.assign(user, {
      id: null,
      name: '',
      avatar: '',
      preferences: {
        language: 'zh-CN',
        theme: 'light',
        volume: 1,
        autoPlay: true
      }
    })
    
    Object.assign(business, {
      currentQuestion: null,
      currentAnswerText: '',
      imagePreloadComplete: false,
      presetQuestions: [],
      businessData: {
        recharge: {
          phone: '',
          amount: 0,
          step: 'info_input'
        },
        dataQuery: {
          phone: '',
          balance: 0,
          step: 'confirmation'
        }
      }
    })
    
    clearErrors()
  }

  return {
    // 状态
    app: readonly(app),
    user: readonly(user),
    device: readonly(device),
    network: readonly(network),
    performance: readonly(performance),
    business: readonly(business),
    
    // 计算属性
    isMobileDevice,
    isOnlineAndReady,
    hasErrors,
    currentBusinessData,
    
    // 应用状态动作
    setInitialized,
    setLoading,
    setError,
    clearError,
    
    // 用户状态动作
    setUser,
    updateUserPreferences,
    setUserLanguage,
    setUserTheme,
    setUserVolume,
    setAutoPlay,
    
    // 设备信息动作
    updateDeviceInfo,
    
    // 网络状态动作
    updateNetworkStatus,
    
    // 性能监控动作
    recordLoadTime,
    recordRenderTime,
    updateMemoryUsage,
    recordError,
    clearErrors,
    
    // 业务数据动作
    setCurrentQuestion,
    setCurrentAnswerText,
    setImagePreloadComplete,
    setPresetQuestions,
    updateBusinessData,
    resetBusinessData,
    
    // 生命周期
    initialize,
    cleanup,
    reset
  }
})