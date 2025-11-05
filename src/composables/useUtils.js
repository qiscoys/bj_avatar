import { ref, reactive, computed, nextTick } from 'vue'
import { useConfig } from './useConfig'
import { useUIStore } from '../stores/ui'
import { useGlobalStore } from '../stores/global'

/**
 * 日志工具函数
 * 仅在开发环境下输出日志
 */
export function log(...rest) {
  if (import.meta.env.DEV) {
    console.log(...rest)
  }
}

/**
 * 工具函数 Composable
 * 提供各种实用工具函数，包括打字机效果、图片预加载、计时器管理、事件管理等
 */
export const useUtils = (options = {}) => {
  const { avatarState, audio } = options
  const { config } = useConfig()
  
  // 获取store实例
  const uiStore = useUIStore()
  const globalStore = useGlobalStore()
  
  // 其他状态
  const typewriterTimeoutId = ref(null)
  const imagePreloadComplete = ref(false)

  /**
   * 打字机效果（通过 store 渲染）
   */
  const typeWriterToStore = (text, options = {}) => {
    // 启动前先停止上一次打字机，避免并行冲突
    try { stopTypewriter() } catch {}
    const defaultOptions = {
      speed: 200,
      callback: null,
      onFinish: null
    }
    const opts = { ...defaultOptions, ...options }

    const raw = String(text)
    const isHtml = opts.renderHtml === true || /<\/?[a-z][\s\S]*>/i.test(raw)
    uiStore.setTyping(true)
    uiStore.setIntroText('')

    if (!isHtml) {
      let i = 0
      let displayText = ''
      function typePlain() {
        if (!uiStore.isTyping) return
        if (i < raw.length) {
          displayText += raw.charAt(i)
          uiStore.setIntroText(displayText)
          if (opts.callback) { try { opts.callback(displayText) } catch {} }
          i++
          typewriterTimeoutId.value = setTimeout(typePlain, config?.typewriter?.speed || opts.speed)
        } else {
          uiStore.setTyping(false)
          typewriterTimeoutId.value = null
          if (opts.onFinish) setTimeout(opts.onFinish, 500)
        }
      }
      typePlain()
      return
    }

    // HTML 渲染
    const tmp = document.createElement('div')
    tmp.innerHTML = raw
    const textNodes = []
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      textNodes.push({ node, full: node.textContent || '' })
    }
    const total = textNodes.reduce((sum, n) => sum + n.full.length, 0)
    let i = 0

    function typeHtml() {
      if (!uiStore.isTyping) return
      if (i <= total) {
        let remaining = i
        for (const tn of textNodes) {
          const take = Math.max(0, Math.min(remaining, tn.full.length))
          tn.node.textContent = tn.full.slice(0, take)
          remaining -= take
        }
        const html = tmp.innerHTML
        uiStore.setIntroText(html)
        if (opts.callback) { try { opts.callback(html) } catch {} }
        i++
        typewriterTimeoutId.value = setTimeout(typeHtml, config?.typewriter?.speed || opts.speed)
      } else {
        // 最终完整 HTML
        uiStore.setIntroText(raw)
        uiStore.setTyping(false)
        typewriterTimeoutId.value = null
        if (opts.onFinish) setTimeout(opts.onFinish, 500)
      }
    }

    typeHtml()
  }

  /**
   * 停止打字机效果
   */
  const stopTypewriter = () => {
    if (typewriterTimeoutId.value) {
      clearTimeout(typewriterTimeoutId.value)
      typewriterTimeoutId.value = null
    }
    uiStore.setTyping(false)
  }

  /**
   * 生成预设问题HTML
   */
  // const generatePresetQuestions = (isVoiceChat = false) => {
  //   const questions = Object.keys(config?.presetQA || {})
  //   const className = isVoiceChat ? 'question-item' : 'question-item-text'
    
  //   return questions
  //     .map((question, index) => 
  //       `<div class="${className}" data-question="${question}">
  //         <p class="flex-1">${question}</p>
  //       </div>`
  //     )
  //     .join('')
  // }

  /**
   * HTML转义
   */
  const escapeHtml = (str) => {
    if (!str) return ''
    return String(str).replace(/[&<>"']/g, function (s) {
      switch (s) {
        case '&': return '&amp;'
        case '<': return '&lt;'
        case '>': return '&gt;'
        case '"': return '&quot;'
        case "'": return '&#39;'
        default: return s
      }
    })
  }

  /**
   * 图片预加载器
   */
  const imagePreloader = reactive({
    images: [],
    loadedCount: 0,
    totalCount: 0,

    init() {
      this.images = config?.imagePreloader?.images || []
      this.totalCount = this.images.length
      this.loadedCount = 0
    },

    preloadImages() {
      this.init()
      
      if (this.totalCount === 0) {
        globalStore.setImagePreloadComplete(true)
        this.onAllImagesLoaded()
        return
      }

      this.images.forEach(src => {
        const img = new Image()
        
        img.onload = () => {
          this.loadedCount++
          if (this.loadedCount === this.totalCount) {
            globalStore.setImagePreloadComplete(true)
            this.onAllImagesLoaded()
          }
        }
        
        img.onerror = () => {
          console.warn('图片加载失败:', src)
          this.loadedCount++
          if (this.loadedCount === this.totalCount) {
            globalStore.setImagePreloadComplete(true)
            this.onAllImagesLoaded()
          }
        }
        
        img.src = src
      })
    },

    onAllImagesLoaded() {
      const pageElement = document.querySelector('.page_human_ani')
      if (pageElement) {
        pageElement.classList.remove('preloading')
        pageElement.classList.add('loaded')
      }
    }
  })

  /**
   * 计时器管理工具
   */
  const timerManager = reactive({
    timers: new Map(),

    setTimer(key, callback, delay) {
      this.clearTimer(key)
      
      const timerId = setTimeout(() => {
        callback()
        this.timers.delete(key)
      }, delay)
      
      this.timers.set(key, timerId)
      return timerId
    },

    clearTimer(key) {
      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key))
        this.timers.delete(key)
        return true
      }
      return false
    },

    clearAllTimers() {
      this.timers.forEach(timerId => clearTimeout(timerId))
      this.timers.clear()
    },

    hasTimer(key) {
      return this.timers.has(key)
    },

    createDebounce(key, callback, delay) {
      return (...args) => {
        this.setTimer(key, () => callback.apply(this, args), delay)
      }
    }
  })

  /**
   * 事件管理器
   */
  const eventManager = reactive({
    listeners: new Map(),
    globalHandlers: new Map(),
    stateCheckers: new Map(),

    init() {
      this.initStateCheckers()
      this.initGlobalHandlers()
      return this
    },

    initStateCheckers() {
      // 这些检查器现在需要适配Vue Composables
      // 在实际使用时，会通过依赖注入获取相应的composable实例
      this.stateCheckers.set('avatarState', {
        exists: () => true, // Vue composable总是存在
        hasMethod: () => true,
        getCurrentState: () => null, // 需要通过参数传入
        isInState: () => false,
        isInBusiness: () => false
      })

      this.stateCheckers.set('audio', {
        exists: () => true,
        hasMethod: () => true,
        isPlaying: () => false
      })

      this.stateCheckers.set('speechRecognition', {
        exists: () => true,
        hasMethod: () => true,
        isRecording: () => false
      })

      this.stateCheckers.set('ui', {
        exists: () => true,
        hasMethod: () => true
      })
    },

    initGlobalHandlers() {
      this.globalHandlers.set('visibilitychange', () => {
        if (document.hidden) {
          this.handlePageHidden()
        } else {
          this.handlePageVisible()
        }
      })

      this.globalHandlers.set('error', event => {
        console.error('全局错误:', event.error)
        this.notifyErrorHandlers(event.error)
      })

      this.globalHandlers.set('unhandledrejection', event => {
        console.error('未处理的Promise拒绝:', event.reason)
        this.notifyErrorHandlers(event.reason)
      })

      this.globalHandlers.set('beforeunload', async () => {
        await this.handlePageUnload()
      })
    },

    on(element, eventType, handler, options = {}) {
      const key = this._getKey(element, eventType, handler)
      
      if (this.listeners.has(key)) {
        this.off(element, eventType, handler)
      }
      
      const targetElement = typeof element === 'string' ? document.querySelector(element) : element
      if (!targetElement) return
      
      if (targetElement.addEventListener) {
        targetElement.addEventListener(eventType, handler, options)
      }
      
      this.listeners.set(key, {
        element: targetElement,
        eventType,
        handler,
        options
      })
    },

    off(element, eventType, handler) {
      const key = this._getKey(element, eventType, handler)
      
      if (this.listeners.has(key)) {
        const listener = this.listeners.get(key)
        if (listener.element.removeEventListener) {
          listener.element.removeEventListener(eventType, handler, listener.options)
        }
        this.listeners.delete(key)
      }
    },

    emit(target, eventType, detail = null) {
      const targetElement = typeof target === 'string' ? document.querySelector(target) : target
      if (targetElement) {
        const event = new CustomEvent(eventType, { detail })
        targetElement.dispatchEvent(event)
      }
    },

    getStateChecker(managerName) {
      return this.stateCheckers.get(managerName)
    },

    safeCall(managerName, methodName, ...args) {
      // 在Vue环境中，这个方法需要通过依赖注入来调用相应的composable方法
      console.warn(`safeCall ${managerName}.${methodName} 需要在组件中通过composable实例调用`)
      return null
    },

    handlePageHidden() {
      console.log('页面隐藏，停止所有活动')
      // 发出页面隐藏事件，让各个composable自行处理
      this.emit(document, 'page-hidden')
    },

    handlePageVisible() {
      console.log('页面显示，恢复活动状态')
      // 发出页面显示事件，让各个composable自行处理
      this.emit(document, 'page-visible')
    },

    async handlePageUnload() {
      console.log('页面即将卸载，清理资源')
      
      // 清理定时器
      timerManager.clearAllTimers()
      
      // 发出页面卸载事件
      this.emit(document, 'page-unload')
    },

    notifyErrorHandlers(error) {
      console.error('系统错误:', error)
      this.emit(document, 'system-error', error)
    },

    initGlobalEvents() {
      this.globalHandlers.forEach((handler, eventType) => {
        this.on(
          eventType === 'error' || eventType === 'unhandledrejection' ? window : document,
          eventType,
          handler
        )
      })
    },

    offAll(element) {
      const keysToRemove = []
      
      this.listeners.forEach((listener, key) => {
        if (listener.element === element) {
          keysToRemove.push(key)
        }
      })
      
      keysToRemove.forEach(key => {
        const listener = this.listeners.get(key)
        this.off(listener.element, listener.eventType, listener.handler)
      })
    },

    offByType(eventType) {
      const keysToRemove = []
      
      this.listeners.forEach((listener, key) => {
        if (listener.eventType === eventType) {
          keysToRemove.push(key)
        }
      })
      
      keysToRemove.forEach(key => {
        const listener = this.listeners.get(key)
        this.off(listener.element, listener.eventType, listener.handler)
      })
    },

    clear() {
      this.listeners.forEach((listener, key) => {
        this.off(listener.element, listener.eventType, listener.handler)
      })
      this.listeners.clear()
    },

    getListenerCount() {
      return this.listeners.size
    },

    hasListener(element, eventType, handler) {
      const key = this._getKey(element, eventType, handler)
      return this.listeners.has(key)
    },

    _getKey(element, eventType, handler) {
      const targetElement = typeof element === 'string' ? document.querySelector(element) : element
      const elementId = targetElement?.id || targetElement?.tagName || 'unknown'
      const handlerStr = handler.toString().substring(0, 50)
      return `${elementId}_${eventType}_${handlerStr}`
    },

    bindEvents(bindings) {
      bindings.forEach(binding => {
        const { element, events } = binding
        
        if (Array.isArray(events)) {
          events.forEach(event => {
            this.on(element, event.type, event.handler, event.options)
          })
        } else {
          Object.keys(events).forEach(eventType => {
            this.on(element, eventType, events[eventType])
          })
        }
      })
    },

    createDebouncedHandler(name, handler, delay = 300) {
      return (...args) => {
        timerManager.setTimer(name, () => {
          handler.apply(this, args)
        }, delay)
      }
    },

    createThrottledHandler(name, handler, delay = 300) {
      let lastExecution = 0
      
      return (...args) => {
        const now = Date.now()
        if (now - lastExecution >= delay) {
          lastExecution = now
          handler.apply(this, args)
        }
      }
    }
  })

  // 初始化事件管理器
  eventManager.init()

  return {
    // 状态
    isTyping: uiStore.isTyping,
    imagePreloadComplete,
    
    // 打字机效果
    typeWriterToStore,
    stopTypewriter,
    
    // 工具函数
    // generatePresetQuestions,
    escapeHtml,
    
    // 管理器
    imagePreloader,
    timerManager,
    eventManager
  }
}

/**
 * 事件管理器 Composable
 * 单独导出事件管理器功能
 */
export function useEventManager() {
  const utils = useUtils()
  return {
    eventManager: utils.eventManager
  }
}