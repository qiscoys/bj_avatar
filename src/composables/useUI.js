import { log } from '@/composables/useUtils'
import { useConfig } from '@/composables/useConfig'
import { useUIStore } from '@/stores'

export function useUI(options = {}) {
  const { avatarStore, speechStore } = options
  const uiStore = useUIStore()
  const { config } = useConfig()
  
  // 通过 setManagers 注入依赖，避免在 provide 之前调用 inject
  let avatarState
  let audio
  let utils
  let speechRecognition
  // 初始化状态标记，避免在依赖未注入时过早初始化
  let isInitialized = false
  
  // 使用 Pinia stores 替代本地状态
  const isHangupActive = computed(() => speechStore?.voiceChat.isHangupActive || false)
  const isAnimationSwitching = computed(() => uiStore?.isAnimationSwitching || false)
  const actionStatus = computed(() => uiStore?.actionStatus || false)
  const currentAction = computed(() => uiStore?.currentAction || 'static')
  const selectedAvatar = computed(() => uiStore?.selectedAvatar || avatarStore?.currentAvatar)
  const selectedBackground = computed(() => uiStore?.selectedBackground || avatarStore?.currentBg)
  const actionImagesPreloaded = computed(() => uiStore?.actionImagesPreloaded || false)
  
  // 动作库文本轮播相关状态
  const actionTextTimer = computed(() => uiStore?.actionTextTimer)
  const actionTextIndex = computed(() => uiStore?.actionTextIndex || 0)
  const actionTextList = computed(() => uiStore?.actionTextList || [])

  // 缓存常用DOM元素
  const domCache = computed(() => uiStore?.domCache || {
    $introPopup: null,
    // $introText: null,
    $actionList: null,
  })

  // 初始化DOM缓存
  const initDOMCache = () => {
    domCache.$introPopup = document.getElementById('introPopup')
    domCache.$actionList = document.querySelector('.action_list')
  }

  // 初始化
  const init = () => {
    if (!utils?.eventManager) {
      return
    }
    if (isInitialized) return
    const humanAni = document.querySelector('.page_human_ani')
    if (humanAni) humanAni.classList.add('preloading')
    
    if (utils?.imagePreloader) {
      utils.imagePreloader.preloadImages()
    }
    
    bindEvents()
    preloadActionImages()

    try { avatarState?.setCurrentAvatar(selectedAvatar.value) } catch {}

    // if (domCache.$introPopup) domCache.$introPopup.style.display = 'none'
    // if (domCache.$introText) domCache.$introText.textContent = ''

    // 标记已完成初始化，避免重复执行
    isInitialized = true
  }

  // 绑定所有事件
  const bindEvents = () => {
    const eventManager = utils?.eventManager
    if (!eventManager) {
      console.error('EventManager未找到，事件绑定失败')
      return
    }

    eventManager.on(document, 'click', e => {
      const t = e.target
      // if (t.matches('.exitBtn')) return returnToMain()
      if (t.matches('.page_return')) return returnToMain()
    })

    // touch 事件通用处理
    eventManager.on(document, 'touchstart', e => toggleTouchActive(e, true))
    eventManager.on(document, 'touchend', e => toggleTouchActive(e, false))
  }

  // Touch激活样式
  const toggleTouchActive = (e, active) => {
    const t = e.target
    if (t.matches('.icon-change, #closeBtn, .tab-btn, .option-item, #confirmBtn')) {
      t.classList.toggle('touch-active', active)
    }
  }

  // 关闭弹窗
  const closeModal = () => {
    const modal = document.getElementById('changeModal')
    if (modal) {
      modal.classList.remove('show')
    }
  }

  // 更新选中状态
  const updateSelectedStates = () => {
    document.querySelectorAll('#avatarOptions .option-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.value === selectedAvatar.value)
    })
    document.querySelectorAll('#backgroundOptions .option-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.value === selectedBackground.value)
    })
  }

  // 应用更改
  const applyChanges = () => {
    const humanAni = document.getElementById('voiceAvatar')
    if (humanAni) {
      humanAni.classList.remove('human2', 'human3', 'human4')
      if (selectedAvatar.value !== config.initAvatar) {
        humanAni.classList.add(selectedAvatar.value)
      }
    }
    const pageContainer = document.querySelector('.page_contaner')
    if (pageContainer) {
      pageContainer.classList.remove('bg-style1', 'bg-style2', 'bg-style3')
      if (selectedBackground.value !== config.initBg) {
        pageContainer.classList.add(`bg-${selectedBackground.value}`)
      }
    }
    
    // 更新全局状态
    avatarStore?.setCurrentAvatar(selectedAvatar.value)
    avatarStore?.setCurrentBg(selectedBackground.value)
    try { avatarState?.setCurrentAvatar(selectedAvatar.value) } catch {}
    refreshActionsForCurrentAvatar()
    closeModal()
    showSuccessMessage()
  }

  // 生成动作列表
  const generateActionList = () => {
    const avatar = config?.avatars?.[selectedAvatar.value]
    if (!avatar || !domCache.$actionList) return
    domCache.$actionList.innerHTML = ''

    const categories = {
      常规动作: ['action', 'sayHi', 'welcome', 'speak', 'listen', 'dance'],
      情绪: ['finishing', 'heart', 'happy', 'disappointed'],
      业务动作: ['submitInvoice', 'queryData', 'introduceProd', 'tel', 'telConfirm'],
    }

    Object.entries(categories).forEach(([cat, acts]) => {
      const visibleActs = acts.filter(k => avatar.actions?.[k]?.actionShow)
      if (!visibleActs.length) return
      
      const p = document.createElement('p')
      p.textContent = String(cat)
      domCache.$actionList.appendChild(p)
      visibleActs.forEach(k => {
        const li = createActionListItem(k, avatar.actions[k])
        if (li) domCache.$actionList.appendChild(li)
      })
    })
    const lis = domCache.$actionList.querySelectorAll('li')
    lis.forEach(li => li.classList.remove('active'))
    if (lis.length) lis[0].classList.add('active')
  }

  // 创建动作列表项
  const createActionListItem = (key, cfg) => {
    const li = document.createElement('li')
    li.dataset.ani = String(key)
    li.textContent = String(cfg?.name ?? key)
    const imgs = {
      finishing: 'sh.gif',
      heart: 'heart.gif',
      happy: 'happy.gif',
      disappointed: 'disappointed.gif',
      submitInvoice: 'submitInvoice.gif',
      queryData: 'queryData.gif',
      introduceProd: 'introduceProd.png',
    }
    
    if (imgs[key]) {
      const img = document.createElement('img')
      img.className = String(key)
      img.src = `pub-ui/images/action/${imgs[key]}`
      img.alt = ''
      li.appendChild(img)
    }
    
    if (key === 'tel' || key === 'telConfirm') {
      const p = document.createElement('p')
      p.className = 'telNum'
      p.id = key === 'tel' ? 'telNum' : 'telNum2'
      li.appendChild(p)
    }
    
    return li
  }

  // 预加载动作图片
  const preloadActionImages = () => {
    if (actionImagesPreloaded.value) return
    
    const actionMapping = getActionMapping()
    const container = document.createElement('div')
    container.id = 'action-preload-container'
    container.style.display = 'none'
    document.body.appendChild(container)
    
    Object.values(actionMapping).forEach(cfg => {
      const src = typeof cfg === 'string' 
        ? `pub-ui/humanConfigStatic/human1/action/${cfg}` 
        : cfg?.apng
      if (src) {
        const img = document.createElement('img')
        img.src = src
        container.appendChild(img)
      }
    })
    
    uiStore.setActionImagesPreloaded(true)
  }

  // 切换动作
  const switchAction = (action) => {
    if (!action || isAnimationSwitching.value) return
    
    const actionCfg = getActionMapping()[action]
    if (!actionCfg) return console.warn(`未找到动作 ${action}`)

    const dds = document.querySelectorAll('.action_list dd')
    dds.forEach(dd => dd.classList.remove('active'))
    const target = document.querySelector(`.action_list dd[data-ani="${action}"]`)
    if (target) target.classList.add('active')

    uiStore.setCurrentAction(action)
    try { avatarState.setAvatarAction(action) } catch {}
    try { audio.stopCurrentAudio() } catch {}

    setTimeout(() => {
      const text = getTextMapping()[action] || ''
      try { audio.playCustomAudio(text) } catch {}
      // 使用打字机效果通过 store 渲染
      utils?.typeWriterToStore?.(text)

      if (action === 'tel') {
        utils?.typeWriterToStore(text)
      }
      if (action === 'telConfirm') {
        utils?.typeWriterToStore('18952254781')
      }
    }, 300)
  }

  // 返回主页
  const returnToMain = () => {
    // 切换到主页面
    try { uiStore.setCurrentPage('main') } catch {}
    uiStore.setActionStatus(false)
    resetActionToDefault()
    resetVoiceChatState()
    try { avatarState.disableManualActionMode?.() } catch {}
    try { avatarState.handleWelcomeState?.() } catch {}
  }

  // 重置动作为默认
  const resetActionToDefault = () => {
    if (isAnimationSwitching.value) return
    
    try { audio.stopCurrentAudio() } catch {}
    
    const lis = document.querySelectorAll('.action_list li')
    lis.forEach(li => li.classList.remove('active'))
    const defaultLi = Array.from(lis).find(li => li.dataset.ani === 'action')
    if (defaultLi) defaultLi.classList.add('active')
    
    uiStore.setCurrentAction('welcome')
    uiStore.setActionStatus(false) // 确保重置时也更新状态
  }

  // 重置语音聊天状态
  const resetVoiceChatState = () => {
    speechStore.setHangupActive(false)
    
    utils?.stopTypewriter()
    
    try { speechRecognition.stop() } catch {}
  }

  // 获取文本映射
  const getTextMapping = () => {
    return {
      action: '嗨，你可以通过语音切换我的动作',
      sayHi: '嗨~你好',
      welcome: '你好~ 欢迎来到朝阳门营业厅',
      speak: '中国电信集团有限公司是中国特大型通信运营企业',
      listen: '小翼没有听清',
      dance: '',
      finishing: '成功了！',
      heart: '比心',
      happy: '',
      disappointed: '哎',
      submitInvoice: '发票已开具，请查收',
      queryData: '正在查询，请稍等',
      introduceProd: '天翼数字生活公司重磅发布新一代AI中台开启美好数字生活新纪元',
      tel: '18922565478',
      telConfirm: '好的，充值号码是18952254781，机主姓名是刘*闲，充值50元，请您确认',
    }
  }

  // 获取动作映射
  const getActionMapping = () => {
    return config?.avatars?.[selectedAvatar.value]?.actions || {}
  }

  // 设置静态图片
  const setStaticImage = () => {
    try {
      // 仅设置为真正的静止态，避免覆盖欢迎动作
      avatarState?.setAvatarAction('static')
    } catch (e) {}
  }

  // 刷新当前数字人的动作
  const refreshActionsForCurrentAvatar = () => {
    try {
      setStaticImage()
    } catch {}
    uiStore.setActionImagesPreloaded(false)
    preloadActionImages()
    generateActionList()
  }

  // 显示成功消息
  const showSuccessMessage = () => {
    const msg = document.createElement('div')
    msg.className = 'success-message'
    Object.assign(msg.style, {
      position: 'fixed', top: '20px', right: '20px',
      background: '#0067f8', color: 'white', padding: '12px 20px',
      borderRadius: '4px', zIndex: '10000', animation: 'slideInRight 0.3s ease'
    })
    msg.textContent = '切换成功'
    document.body.appendChild(msg)
    setTimeout(() => {
      msg.style.animation = 'fadeOut 0.3s ease'
      setTimeout(() => msg.remove(), 300)
    }, 3000)
  }

  // 处理动作变更
  const handleActionChange = () => {
    uiStore.setActionStatus(true) // 使用store方法更新状态
    pauseWelcomeActivities()
    try { avatarState.enableManualActionMode() } catch {}
    switchAction('action')
  }

  // 暂停欢迎活动
  const pauseWelcomeActivities = () => {
    try { avatarState.stopDialogueLoop?.() } catch {}
    try { audio.stopCurrentAudio?.() } catch {}
    try { utils.stopTypewriter?.() } catch {}
  }

  // 构建动作库文本列表
  const buildActionTextList = () => {
    const texts = getTextMapping()
    const actions = Object.keys(getActionMapping() || {})
    const list = []
    if (texts.action) list.push(texts.action)
    actions.forEach(a => {
      const t = texts[a]
      if (t && typeof t === 'string' && t.trim().length > 0) list.push(t)
    })
    return list.length ? list : ['这里是动作库，您可以说“切换到打招呼”等指令']
  }

  // 切换语言
  const toggleLanguage = (target) => {
    if (!target.classList.contains('active')) {
      document.querySelectorAll('.language_btn li').forEach(li => li.classList.remove('active'))
      target.classList.add('active')
    }
  }

  // 组件挂载时初始化
  onMounted(() => {
    initDOMCache()
    init()
  })

  // 设置管理器依赖
  const setManagers = (avatarStateManager, audioManager, speechRecognitionManager, injectedUtils) => {
    avatarState = avatarStateManager
    audio = audioManager
    speechRecognition = speechRecognitionManager
    utils = injectedUtils || utils
    if (!isInitialized && utils?.eventManager) {
      init()
    }
  }

  // 组件卸载时清理
  onUnmounted(() => {
    const eventManager = utils?.eventManager
    if (eventManager) {
    }
  })

  return {
    // 状态
    isAnimationSwitching,
    actionStatus,
    currentAction,
    selectedAvatar,
    selectedBackground,
    actionImagesPreloaded,
    
    // 方法
    init,
    bindEvents,
    switchAction,
    returnToMain,
    resetActionToDefault,
    resetVoiceChatState,
    getTextMapping,
    getActionMapping,
    setStaticImage,
    refreshActionsForCurrentAvatar,
    showSuccessMessage,
    handleActionChange,
    pauseWelcomeActivities,
    toggleLanguage,
    setManagers,
    isHangupActive,
    setActionStatus: (status) => uiStore.setActionStatus(status), // 导出store方法
    
    // 内部方法（可选暴露）
    closeModal,
    updateSelectedStates,
    applyChanges,
    generateActionList,
    preloadActionImages,
    toggleTouchActive
  }
}