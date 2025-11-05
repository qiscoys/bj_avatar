import { useConfig } from '@/composables/useConfig'

export function useAvatarState(bussDialogueArr, options = {}) {
  const { avatarStore, uiStore, speechStore } = options
  const { config } = useConfig()

  const { dialogues, intervals, businessFlows, audios, states } = config

  // 本地可写状态（避免直接写入 Pinia 的只读 state）
  const state = ref({
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

  const businessData = reactive({
    recharge: { phone: null, amount: null },
    dataQuery: { phone: null },
    invoice: { phone: null }
  })

  const timers = reactive({
    dialogue: null,
    speaking: null,
    qrAdvance: null,
    dialogueStartDelay: null,
  })

  const managers = reactive({ audio: null, ui: null, utils: null })

  // 用户消息推送去重/节流（2秒窗口，按规范化文本比较）
  let lastUserPush = { normText: '', ts: 0 }

  // 确保全局状态已初始化
  if (!avatarStore?.currentAvatar) {
    avatarStore?.setCurrentAvatar(config.initAvatar)
  }

  // ============ 工具函数 ============

  const clearTimer = (type) => {
    if (timers[type]) {
      clearInterval(timers[type])
      timers[type] = null
    }
  }


  const ensureShown = (el) => {
    if (!el) return
    ;['hidden', 'd-none', 'dn'].forEach(c => el.classList?.remove(c))
    el.style.removeProperty('display')
    if (getComputedStyle(el).display === 'none') {
      el.style.display = 'block'
    }
  }

  const updateUI = (updates) => {
    Object.entries(updates).forEach(([selector, { action, duration = 300 }]) => {
      const el = document.querySelector(selector)
      if (!el) return
      switch (action) {
        case 'show':
          ensureShown(el)
          break
        case 'hide':
          el.style.display = 'none'
          break
        default:
          // 对非常规 action，尝试作为类名切换或忽略
          try {
            el.classList[action]?.(duration)
          } catch {}
      }
    })
  }

  const checkKeywords = (text, keywords) =>
    keywords.some(word => text.includes(word.replace(/\s/g, '')))

  const findBusinessKeyword = (text) => {
    for (const [key, business] of Object.entries(businessFlows)) {
      if (business.keywords?.some(kw => text.includes(kw))) return key
    }
    return null
  }

  // 解析工具
  const normalizeDigits = (text) => {
    const map = {
      '０':'0','１':'1','２':'2','３':'3','４':'4','５':'5','６':'6','７':'7','８':'8','９':'9',
      '零':'0','〇':'0','○':'0',
      '一':'1','幺':'1',
      '二':'2','两':'2',
      '三':'3',
      '四':'4',
      '五':'5',
      '六':'6',
      '七':'7',
      '八':'8',
      '九':'9'
    }
    return String(text || '').split('').map(ch => map[ch] ?? ch).join('')
  }
  const parsePhone = (text) => {
    const normalized = normalizeDigits(text)
    const digits = normalized.replace(/\D/g, '')
    return digits.length >= 11 ? digits.slice(0, 11) : null
  }

  const parseChineseNumber = (str) => {
    const numMap = { 零:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 }
    const unitMap = { 十:10, 百:100, 千:1000, 万:10000 }
    let total = 0, section = 0, number = 0

    for (const ch of String(str)) {
      if (ch in numMap) {
        number = numMap[ch]
      } else if (ch in unitMap) {
        if (number === 0 && ch === '十') number = 1
        section += number * unitMap[ch]
        number = 0
      }
    }
    return total + section + number
  }

  const parseAmount = (text) => {
    const cleaned = text.replace(/[\s元块圆RMB人民币￥]/g, '')
    const match = cleaned.match(/(\d+(?:\.\d{1,2})?)/)
    if (match) return Number(match[1])
    const chineseVal = parseChineseNumber(cleaned)
    return chineseVal > 0 ? chineseVal : null
  }

  // ============ 事件处理 ============
  const handleSpeakingStart = () => {
    if (state.value.isManualMode) return
    state.value.isSpeaking = true
    try { avatarStore?.setSpeakingState?.(true) } catch {}
    clearTimer('speaking')

    const actionMap = {
      [states.WELCOME || 'welcome']: 'welcome',
      [states.AWAKENED || 'awakened']: 'speak',
      [states.BUSINESS_PROCESSING || 'business']: getCurrentBusinessAction(),
    }

    const targetAction = actionMap[state.value.current] || 'speak'
    setAvatarAction(targetAction)
  }

  const handleSpeakingEnd = () => {
    if (state.value.isManualMode) return

    state.value.isSpeaking = false
    try { avatarStore?.setSpeakingState?.(false) } catch {}
    clearTimer('speaking')

    // ✅ 音频结束时，强制重置动画切换状态
    // 确保立即停止说话动作，不延迟
    state.value.isAnimationSwitching = false
    if (state.value.pendingAction) {
      state.value.pendingAction = null
    }

    // ✅ 立即切换到静态动作
    setAvatarAction('static')
  }

  // 初始化事件监听
  const initEventListeners = () => {
    const events = ['speechStart', 'speechEnd', 'forceStaticRestore']
    const handlers = {
      speechStart: handleSpeakingStart,
      speechEnd: handleSpeakingEnd,
      forceStaticRestore: () => setStatic()
    }

    events.forEach(event => {
      const handler = handlers[event]
      document.addEventListener(event, handler)
    })

    // eventManager 支持（可选）
    const eventManager = managers.utils?.eventManager
    if (eventManager) {
      Object.entries(handlers).forEach(([event, handler]) => {
        eventManager.on(document, event, handler)
      })
    }
  }

  // ============ 状态管理 ============
  const stopDialogueLoop = () => {
    clearTimer('dialogue')
    if (timers.dialogueStartDelay) {
      clearTimeout(timers.dialogueStartDelay)
      timers.dialogueStartDelay = null
    }
    state.value.dialogueLoopOwner = null
  }

  const switchState = (newState, params = {}) => {
    console.log(`状态切换: ${state.value.current} -> ${newState}`)

    // 防重复：若已在目标状态则直接返回（兼容本地与 store 状态）
    if (state.value.current === newState || avatarStore?.state?.current === newState) {
      return
    }

    // 通过 avatarStore 更新状态
    if (avatarStore?.switchState) {
      avatarStore.switchState(newState, params)
    } else {
      // 如果 avatarStore 不可用，直接更新本地状态
      state.value.current = newState
    }
    // 若使用 store，则同步本地值，以便旧逻辑读取（避免重复写入）
    if (avatarStore?.state?.current) {
      state.value.current = avatarStore.state.current
    }

    // 根据状态执行相应处理
    if (newState === (states.WELCOME || 'welcome')) {
      handleWelcomeState()
    } else if (newState === (states.AWAKENED || 'awakened')) {
      handleAwakenedState()
    } else if (newState === (states.BUSINESS_PROCESSING || 'business')) {
      handleBusinessState(params.businessKey)
    }
  }

  const handleWelcomeState = () => {
    state.value.dialogueIndex = 0
    // 进入欢迎状态前，先停止任何现有的对话轮播，避免串场
    stopDialogueLoop()
    if (!state.value.isManualMode) {
      // 若动作库正在激活，跳过欢迎轮播，避免与动作库打架
      if (uiStore?.actionStatus?.value) return
      setAvatarAction('welcome')
      startDialogueLoop(dialogues.welcome, intervals.welcomeLoop)
    }
  }

  const handleAwakenedState = () => {
    // 页面显隐交由模板通过 uiStore.currentPage 控制
    // 此处仅确保字幕容器可见（如需）
    try { updateUI({ '#introPopup': { action: 'show' } }) } catch {}
    // 切换当前页面到语音聊天页
    try { uiStore?.setCurrentPage?.('voice') } catch {}

    state.value.dialogueIndex = 0
    // 进入唤醒状态前，先停止任何现有的欢迎/唤醒轮播，确保干净切换
    stopDialogueLoop()
    if (!state.value.isManualMode) {
      // 若动作库正在激活，跳过唤醒轮播
      if (uiStore?.actionStatus?.value) return
      setAvatarAction('speak')
      const awakeningDialogues = dialogues.awakening
      if (awakeningDialogues?.length > 0) {
        // 先播放首句，等待音频结束后再启动轮播，避免打断
        playDialogue(awakeningDialogues[0], () => {
          // 再次确认动作库是否激活，激活则不启动轮播
          if (uiStore?.actionStatus?.value) return
          // 下一轮从第二条开始，避免首句在轮播开始时再次播放
          state.value.dialogueIndex = awakeningDialogues.length > 1 ? 1 : 0
          startDialogueLoop(dialogues.awakening, intervals.awakenedLoop)
        })
      }
    }
  }

  const handleBusinessState = (businessKey) => {
    // 清理任何欢迎/唤醒轮播，确保业务对话可正确写入 bussDialogueArr
    stopDialogueLoop()

    Object.assign(state.value, {
      businessFlow: businessKey,
      businessStep: 0,
      isProcessingBusiness: true,
    })

    processCurrentBusinessStep()
  }

  // ============ 形象和动作 ============
  const setCurrentAvatar = (avatar) => {
    avatarStore?.setCurrentAvatar(avatar)
    console.log('设置数字人形象:', avatar)
  }

  const setAvatarAction = (actionName) => {
    const currentAvatar = avatarStore?.currentAvatar || config.initAvatar
    const actionConfig = config.avatars?.[currentAvatar]?.actions?.[actionName]

    if (!actionConfig) {
      return
    }

    // ✅ 如果要切换到 static，清除动画切换状态和待处理动作
    if (actionName === 'static') {
      state.value.isAnimationSwitching = false
      state.value.pendingAction = null
    }

    // 统一由组件渲染：只同步 UI store 当前动作
    try { uiStore?.forceSetCurrentAction?.(actionName) } catch {}
    state.value.action = actionName

    // 可选音频联动：在业务流程中不通过主语音通道播放，避免打断说话
    const isInBusiness = state.value.current === (states.BUSINESS_PROCESSING || 'business') && state.value.isProcessingBusiness
    if (!isInBusiness && audios[actionName]) {
      managers.audio?.playCustomAudio?.(audios[actionName])
    }
  }


  // ============ 对话管理 ============
  const getDialogueArray = () => {
    const candidates = [
      bussDialogueArr,
      bussDialogueArr?.value,
      bussDialogueArr?.value?.value,
      avatarStore?.bussDialogueArr?.value,
    ]
    for (const c of candidates) {
      if (Array.isArray(c)) return c
    }
    return null
  }

  const pushDialogueItem = (item) => {
    const arr = getDialogueArray()
    if (arr) return arr.push(item)
    console.error('bussDialogueArr 无效，无法写入对话：', bussDialogueArr)
  }
  const startDialogueLoop = (dialogues, interval) => {
    if (state.value.isManualMode || !dialogues?.length) return

    state.value.dialogueLoopOwner = state.value.current

    const safePlay = () => {
      if (state.value.dialogueLoopOwner !== state.value.current) {
        clearTimer('dialogue')
        return false
      }
      return true
    }

    const playCurrentAndSchedule = () => {
      if (!safePlay()) return
      const idx = state.value.dialogueIndex
      // 在音频结束后再调度到下一条，并保证最小间隔
      playDialogue(dialogues[idx], () => {
        if (!safePlay()) return
        timers.dialogue = setTimeout(() => {
          state.value.dialogueIndex = (state.value.dialogueIndex + 1) % dialogues.length
          playCurrentAndSchedule()
        }, interval)
      })
    }

    const isInBusiness = state.value.current === (states.BUSINESS_PROCESSING || 'business') && state.value.isProcessingBusiness
    const shouldContinue = !isInBusiness &&
      (state.value.dialogueLoopOwner === state.value.current || !state.value.dialogueLoopOwner)

    if (shouldContinue) {
      playCurrentAndSchedule()
    }
  }

  const playDialogue = (dialogue, afterAudioCallback) => {
    if (!dialogue) return

    const isInBusiness = state.value.current === (states.BUSINESS_PROCESSING || 'business') && state.value.isProcessingBusiness
    const isValidForBusinessDialogue = isInBusiness &&
      (state.value.dialogueLoopOwner === state.value.current || !state.value.dialogueLoopOwner)

    // 文字显示
    if (isValidForBusinessDialogue && bussDialogueArr) {
      pushDialogueItem({
        type: 'assistant',
        text: dialogue.text,
      })
    } else if (managers.utils?.typeWriterToStore) {
      managers.utils.typeWriterToStore(dialogue.text || '')
    } else {
      uiStore?.setIntroText?.(dialogue.text || '')
    }

    // 语音播放
    if (dialogue.audio && managers.audio?.playCustomAudio) {
      managers.audio.playCustomAudio(dialogue.audio, afterAudioCallback)
    } else {
      afterAudioCallback?.()
    }
  }

  const pushUserDialogue = (text) => {
    if (!bussDialogueArr) {
      console.warn('bussDialogueArr 未定义')
      return
    }
    const now = Date.now()
    const normText = String(text || '')
      .trim()
      .replace(/\s+/g, '')

    // 2秒内相同内容不重复推送
    if (normText && normText === lastUserPush.normText && (now - lastUserPush.ts) < 2000) {
      return
    }
    lastUserPush = { normText, ts: now }

    pushDialogueItem({ type: 'user', text })
  }

  // ============ 语音输入处理 ============
  const handleVoiceInput = (transcript) => {
    const cleanText = transcript.toLowerCase().replace(/[,。!?\s]/g, '')

    // 唤醒词检测
    if (checkKeywords(cleanText, config.wakeWords || [])) {
      switchState(states.AWAKENED || 'awakened')
      return true
    }

    // 业务关键词检测
    if ([states.AWAKENED, states.WELCOME].includes(state.value.current)) {
      const businessKey = findBusinessKeyword(cleanText)
      if (businessKey) {
        switchState(states.BUSINESS_PROCESSING || 'business', { businessKey })
        return true
      }
    }

    // 业务流程输入处理
    return state.value.current === (states.BUSINESS_PROCESSING || 'business')
      ? handleBusinessInput(cleanText)
      : false
  }

  const handleBusinessInput = (text) => {
    if (!state.value.businessFlow) return false

    const confirmWords = ['确认', '确定', '对', '是的', '好的', '没问题', '嗯', '嗯嗯', '恩', '对的', '好']
    const cancelWords = ['取消', '退出', '返回']

    const business = businessFlows[state.value.businessFlow]
    const step = business?.steps?.[state.value.businessStep]
    const stepId = step?.id

    // 充值流程
    if (state.value.businessFlow === 'recharge') {
      if (stepId === 'request') {
        const phone = parsePhone(text)
        const amount = parseAmount(text)
        if (phone) businessData.recharge.phone = phone
        if (amount) businessData.recharge.amount = amount

        if (businessData.recharge.phone && businessData.recharge.amount) {
          nextBusinessStep()
          return true
        }
        return false
      }
      if (stepId === 'info_input' && confirmWords.some(w => text.includes(w))) {
        nextBusinessStep()
        return true
      }
      if (stepId === 'confirmation' && cancelWords.some(w => text.includes(w))) {
        exitBusiness()
        return true
      }
    }

    // 查话费流程
    if (state.value.businessFlow === 'dataQuery' && stepId === 'request') {
      const phone = parsePhone(text)
      if (phone) {
        businessData.dataQuery.phone = phone
        nextBusinessStep()
        return true
      }
    }

    // 开发票流程
    if (state.value.businessFlow === 'invoice') {
      if (stepId === 'request') {
        const phone = parsePhone(text)
        if (phone) {
          businessData.invoice.phone = phone
          nextBusinessStep()
          return true
        }
      }
      if (stepId === 'requestInvoice') {
        const proceedWords = ['打印发票', '好的打印发票', '开票', '打印']
        if (proceedWords.some(w => text.includes(w))) {
          nextBusinessStep()
          return true
        }
      }
      if (stepId === 'confirmation' && confirmWords.some(w => text.includes(w))) {
        nextBusinessStep()
        return true
      }
    }

    if (cancelWords.some(w => text.includes(w))) {
      exitBusiness()
      return true
    }
    return false
  }

  // ============ 业务流程处理 ============
  const processCurrentBusinessStep = () => {
    // 业务步骤开始：清空并隐藏字幕容器，停止打字机效果
    try { managers.utils?.stopTypewriter?.() } catch {}
    try { uiStore?.clearIntroText?.() } catch {}
    updateUI({ '#introPopup': { action: 'hide' } })

    const business = businessFlows[state.value.businessFlow]
    const step = business?.steps?.[state.value.businessStep]

    if (!step) {
      console.warn('未找到业务步骤配置')
      exitBusiness()
      return
    }

    const action = step.actions?.[0] || 'static'
    setAvatarAction(action)

    // 播放动作音效 - 但要避免在发票流程的前几步播放submitInvoice音效
    const avatar = avatarStore?.currentAvatar
    const actionCfg = config.avatars[avatar]?.actions?.[action]
    let actionAudio = actionCfg?.audio || audios[action]

    const isAudioPath = s => typeof s === 'string' &&
      ['.mp3', '.wav', '.ogg', '.m4a', '.aac'].some(ext => s.toLowerCase().includes(ext))

    if (typeof actionAudio === 'string' && !isAudioPath(actionAudio) && audios[actionAudio]) {
      actionAudio = audios[actionAudio]
    }

    // 在发票流程的非最后步骤中，不播放submitInvoice动作音效，避免音频冲突
    const shouldPlayActionAudio = !(
      state.value.businessFlow === 'invoice' &&
      action === 'submitInvoice' &&
      step.id !== 'result'
    )

    if (actionAudio && managers.audio?.playSfx && shouldPlayActionAudio) {
      managers.audio.playSfx(actionAudio)
    }

    playDialogue({ text: step.text, audio: step.audio })

    // 特殊业务处理
    const businessHandlers = {
      recharge: () => handleRechargeStep(step),
      dataQuery: () => handleDataQueryStep(step),
      invoice: () => handleTicketStep(step),
    }
    businessHandlers[state.value.businessFlow]?.()
  }

  const handleRechargeStep = (step) => {
    const stepHandlers = {
      info_input: () => showPhoneNumber(),
      confirmation: () => setTimeout(() => showQRCode(), 3000),
      success: () => setTimeout(() => showSuccessStatus(), 1000),
    }
    stepHandlers[step.id]?.()
  }

  const handleDataQueryStep = (step) => {
    if (step.id === 'confirmation') {
      setTimeout(() => showQueryResult(), 3000)
      setTimeout(() => nextBusinessStep(), 8000)
    }
  }

  const handleTicketStep = (step) => {
    const stepHandlers = {
      requestInvoice: () => setTimeout(() => showInvoiceList(), 2000),
      confirmation: () => setTimeout(() => showInvoiceConfirm(), 3000),
      processing: () => setTimeout(() => showInvoiceProcessing(), 3000),
      result: () => setTimeout(() => showInvoiceResult(), 3000),
    }
    stepHandlers[step.id]?.()
  }

  const pushBusinessCardToDialogue = (cardData) => {
    pushDialogueItem({ type: 'card', ...cardData })
  }

  const showPhoneNumber = () => {
    pushBusinessCardToDialogue({
      cardType: 'phone',
      phone:businessData.recharge.phone,
      name: '用户',
      price: 50,
    })
  }

  const showQRCode = () => {
    pushBusinessCardToDialogue({
      cardType: 'qrcode',
      image: '@/assets/images/BJ/code2.png',
    })

    if (timers.qrAdvance) clearTimeout(timers.qrAdvance)
    timers.qrAdvance = setTimeout(() => {
      const business = businessFlows[state.value.businessFlow]
      const step = business?.steps?.[state.value.businessStep]
      if (step?.id === 'confirmation') nextBusinessStep()
      timers.qrAdvance = null
    }, 6000)
  }

  const showSuccessStatus = () => {
    const amt = businessData.recharge.amount
    pushBusinessCardToDialogue({
      cardType: 'success',
      text: '充值成功',
      amount: '50.00',
      telNum: businessData.recharge.phone || '18952254781',
    })

    const flow = businessFlows.recharge
    if (flow?.autoExitAfterSuccessMs > 0) {
      setTimeout(() => exitBusiness(), flow.autoExitAfterSuccessMs)
    }
  }

  const showQueryResult = () => {
    pushBusinessCardToDialogue({
      cardType: 'query_result',
      text: '查询成功,当前余额',
      amount: '9.9',
      phone: businessData.dataQuery.phone || '18952254781',
    })
    setTimeout(() => {
      const el = document.querySelector('.charge-qr-container')
      if (el) el.classList.remove('active')
    }, 3000)
  }

  const showInvoiceList = () => {
    pushBusinessCardToDialogue({
      cardType: 'invoice_list',
      text: '2025年',
      totalAmount: '¥240',
      invoices: [
        { amount: '¥10', period: '2025年08月' },
        { amount: '¥70', period: '2025年08月' },
        { amount: '¥80', period: '2025年08月' },
        { amount: '¥80', period: '2025年08月' },
      ],
    })
  }

  const showInvoiceConfirm = () => {
    pushBusinessCardToDialogue({
      cardType: 'invoice_confirm',
      title: '发票信息确认',
      invoiceInfo: {
        title: '刘*闲',
        amount: '¥240',
        email: '18952254781@189.com',
      },
    })
  }

  const showInvoiceProcessing = () => {
    pushBusinessCardToDialogue({
      cardType: 'invoice_processing',
      title: '开票中',
      invoiceInfo: {
        title: '刘*闲',
        amount: '¥240',
        email: '18952254781@189.com',
      },
    })
    setTimeout(() => nextBusinessStep(), 6000)
  }

  const showInvoiceResult = () => {
    pushBusinessCardToDialogue({
      cardType: 'invoice_result',
      title: '开票成功',
      invoiceInfo: {
        title: '刘*闲',
        amount: '¥240',
        email: '18952254781@189.com',
      },
    })
  }

  const nextBusinessStep = () => {
    const business = businessFlows[state.value.businessFlow]
    if (!business) return

    state.value.businessStep++
    console.log('进入下一步骤:', state.value.businessStep)

    if (state.value.businessStep >= business.steps?.length) {
      exitBusiness()
    } else {
      setTimeout(() => processCurrentBusinessStep(), 2000)
    }
  }

  const exitBusiness = () => {
    console.log('退出业务流程')
    stopDialogueLoop()

    Object.assign(state.value, {
      isProcessingBusiness: false,
      businessFlow: null,
      businessStep: 0,
    })

    const arr = getDialogueArray()
    if (arr) arr.length = 0

    const cancelTel = document.getElementById('cancel_tel')
    if (cancelTel) cancelTel.classList.remove('active')

    if (timers.qrAdvance) {
      clearTimeout(timers.qrAdvance)
      timers.qrAdvance = null
    }

    try { uiStore.setCurrentPage('main') } catch {}

    // 恢复字幕容器显示
    updateUI({ '#introPopup': { action: 'show' } })
    setTimeout(() => switchState(states.WELCOME || 'welcome'), 50)
  }

  const getCurrentBusinessAction = () => {
    const business = businessFlows[state.value.businessFlow]
    const step = business?.steps?.[state.value.businessStep]
    return step?.actions?.[0] || 'speak'
  }

  // ============ 公共方法 ============
  const setManagers = (audioManager, uiManager, utilsManager) => {
    Object.assign(managers, { audio: audioManager, ui: uiManager, utils: utilsManager })
  }

  const setManualMode = (enabled) => {
    state.value.isManualMode = enabled
    if (enabled) stopDialogueLoop()
  }

  const destroy = () => {
    Object.values(timers).forEach(timer => timer && clearTimeout(timer))
    Object.assign(state.value, {
      current: null,
      businessFlow: null,
      isProcessingBusiness: false,
      isSpeaking: false,
    })
  }

  const setStatic = () => {
    console.log('强制恢复静态状态')
    state.value.isManualMode = false
    state.value.isSpeaking = false
    clearTimer('speaking')

    // 仅同步到 UI store，由组件渲染静态图
    Object.assign(state.value, {
      isAnimationSwitching: false,
      action: 'static',
      pendingAction: null
    })
    try { uiStore?.forceSetCurrentAction?.('static') } catch {}
    try { uiStore?.setAnimationSwitching?.(false) } catch {}
  }

  // 初始化
  initEventListeners()

  // 生命周期管理
  if (typeof onUnmounted !== 'undefined') {
    onUnmounted(() => destroy())
  }

  return {
    state,
    timers,
    managers,
    setManagers,
    setStatic,
    setManualMode,
    enableManualActionMode: () => setManualMode(true),
    disableManualActionMode: () => setManualMode(false),
    switchState,
    setCurrentAvatar,
    setAvatarAction,
    handleVoiceInput,
    handleWelcomeState,
    processCurrentBusinessStep,
    nextBusinessStep,
    exitBusiness,
    getCurrentState: () => state.value.current,
    getCurrentBusinessFlow: () => state.value.businessFlow,
    isProcessingBusinessFlow: () => state.value.isProcessingBusiness,
    destroy,
    pushUserDialogue,
    playDialogue,
    updateUI,
    handleSpeakingStart,
    handleSpeakingEnd,
    stopDialogueLoop
    // 注意：currentAvatar 和 currentBg 现在通过 avatarStore 管理
  }
}
