import { useConfig } from '@/composables/useConfig'
import { useWebSocket } from '@/composables/useWebSocket'
import { detectPayment, extractTextFromHtml } from '@/utils/paymentDetector'
import { PaymentPoller } from '@/utils/paymentPoller'
import QRCode from 'qrcode'

export function useChatState(bussDialogueArr, options = {}) {
  const { avatarStore, uiStore, speechStore } = options
  const { config } = useConfig()
  // 支付提示语去重标记
  let _paymentHintPushed = false

  // 智能体WebSocket配置
  const WS_URL = 'wss://devcloud.sitechcloud.com/km/search-api/bigModel/websocketNew?userId=ONCON100001187885&userName=tangrui&cpersonName=%E5%94%90%E7%9D%BF&epId=jiusiTest&scene_id=e600013190f24839bdcd8b0fb30ca483&clientType=PC&is_send_hint=Y&chat_source_href=1&jsbosssessionid=nA11F5F28A2096B593B8BB96A36075288-1'
  
  // 初始化智能体WebSocket和聊天功能
  const agentWebSocket = useWebSocket(WS_URL)
  // 内置聊天管理
  const agentChat = (() => {
    const messages = ref([])
    const messageMap = reactive(new Map())
    const currentMessageId = ref(null)
    const pendingLoadingId = ref(null)

    const addUserMessage = (content) => {
      messages.value.push({ id: Date.now(), type: 'user', content, time: new Date() })
    }

    const addAIMessage = (content) => {
      messages.value.push({ id: Date.now(), type: 'ai', content, time: new Date() })
    }

    const addLoading = () => {
      const loadingId = 'loading_' + Date.now()
      pendingLoadingId.value = loadingId
      return loadingId
    }

    const removeLoading = (loadingId) => {
      if (!loadingId) return
      const index = messages.value.findIndex(msg => msg.id === loadingId)
      if (index !== -1) messages.value.splice(index, 1)
    }

    const handleMessage = (data, onShowQRCode) => {
      try {
        const response = JSON.parse(data)
        if (!response.status) {
          addAIMessage('抱歉，处理您的请求时出现错误：' + (response.errMsg || '未知错误'))
          return
        }

        const responseData = response.data
        const messageId = responseData.chatMessageId

        console.log(responseData)
        if (messageId && !messageMap.has(messageId)) {
          messageMap.set(messageId, { content: '', status: [], loadingId: pendingLoadingId.value })
          currentMessageId.value = messageId
          pendingLoadingId.value = null
        }

        const msgData = messageMap.get(messageId)

        if (responseData.agent_executeList && responseData.agent_executeList.length > 0) {
          if (msgData) msgData.status = responseData.agent_executeList
        }

        if (responseData.response) {
          const cleanContent = extractTextFromHtml(responseData.response)
          if (cleanContent && msgData) {
            msgData.content = cleanContent

            const finalize = () => {
              let content = (msgData.content || '').trim()
              // 跳过"思考中"等占位文本
              if (!content || /^(AI正在思考|思考中)$/i.test(content)) {
                if (msgData.loadingId) { removeLoading(msgData.loadingId); msgData.loadingId = null }
                return
              }

              if (msgData.loadingId) { removeLoading(msgData.loadingId); msgData.loadingId = null }

              const paymentInfo = detectPayment(content)
              if (paymentInfo && paymentInfo.paymentUrl) {
                // 先推送友好提示语，再展示二维码
                try {
                  if (!_paymentHintPushed) {
                    const hintText = '现在我要变出微信支付二维码，稍等一下下哦，很快就可以成功哦！'
                    pushDialogueItem({ type: 'assistant', text: hintText })
                    // 同步播放该提示语音频（TTS）
                    try { managers.audio?.playCustomAudio?.(hintText) } catch {}
                    _paymentHintPushed = true
                  }
                } catch (e) { console.warn('推送支付提示语失败:', e) }
                setTimeout(() => {
                  showQRCodeFromAgent(paymentInfo.paymentUrl, paymentInfo.orderId)
                }, 2000)
                return
              }

              // 工作流文案拦截
              if (/执行工作流/.test(content)) {
                return
              }

              // 非支付消息：推送到对话并播放
              let aiMsg = messages.value.find(msg => msg.messageId === messageId)
              if (!aiMsg) {
                aiMsg = { id: Date.now(), messageId, type: 'ai', content: content, status: msgData.status, time: new Date() }
                messages.value.push(aiMsg)
              } else {
                aiMsg.content = content
                aiMsg.status = msgData.status
              }
              try { playDialogue({ text: content, audio: content }) } catch {}
            }

            // 如果服务端标记 finished，则立即最终化；否则使用防抖在静默后一次性推送
            if (responseData.finished) {
              if (msgData.debounceTimer) { clearTimeout(msgData.debounceTimer); msgData.debounceTimer = null }
              finalize()
            } else {
              if (msgData.debounceTimer) clearTimeout(msgData.debounceTimer)
              msgData.debounceTimer = setTimeout(finalize, 800)
            }
          }
        }

        if (responseData.finished && msgData) {
          if (msgData.debounceTimer) { clearTimeout(msgData.debounceTimer); msgData.debounceTimer = null }
          if (msgData.loadingId) { removeLoading(msgData.loadingId); msgData.loadingId = null }
        }
      } catch (error) {
        console.error('解析消息错误:', error)
        addAIMessage('抱歉，解析响应时出现错误。')
      }
    }

    return { messages, messageMap, addUserMessage, addAIMessage, addLoading, removeLoading, handleMessage }
  })()

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
    isAnimationSwitching: false,
    pendingExitAfterSpeech: false
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

  // 支付轮询器实例
  let _paymentPoller = null

  const managers = reactive({ audio: null, ui: null, utils: null, speechRecognition: null })

  // 用户消息推送去重/节流（2秒窗口，按规范化文本比较）
  let lastUserPush = { normText: '', ts: 0 }

  // 确保全局状态已初始化
  if (!avatarStore?.currentAvatar) {
    avatarStore?.setCurrentAvatar(config.initAvatar)
  }

  // 发送到智能体：连接就绪重试与排队
  let _pendingAgentMessage = null
  let _pendingAgentAttempts = 0
  let _pendingAgentTimer = null
  const sendToAgent = (text) => {
    // 停止语音识别，等待智能体回复音频播放完成后再重启
    try {
      if (managers.speechRecognition?.stop) {
        managers.speechRecognition.stop()
      }
    } catch (e) {
      console.warn('停止语音识别失败:', e)
    }

    const trySend = (payload) => {
      const ok = agentWebSocket.sendMessage(payload)
      if (ok) {
        agentChat.addUserMessage(payload)
        agentChat.addLoading()
      }
      return ok
    }

    if (!agentWebSocket.isConnected.value) {
      agentWebSocket.connect(agentChat.handleMessage)
      _pendingAgentMessage = text
      _pendingAgentAttempts = 0
      if (_pendingAgentTimer) clearTimeout(_pendingAgentTimer)
      const retry = () => {
        if (agentWebSocket.isConnected.value && _pendingAgentMessage) {
          const ok = trySend(_pendingAgentMessage)
          if (ok) {
            _pendingAgentMessage = null
            _pendingAgentTimer = null
            return
          }
        }
        _pendingAgentAttempts++
        if (_pendingAgentAttempts < 20) {
          _pendingAgentTimer = setTimeout(retry, 200)
        } else {
          console.warn('连接超时，未能发送到智能体')
          _pendingAgentTimer = null
        }
      }
      _pendingAgentTimer = setTimeout(retry, 100)
      return true
    } else {
      return trySend(text)
    }
  }

  const showQRCodeFromAgent = async (paymentUrl, orderId) => {
    // 生成二维码图片并展示
    try {
      const dataUrl = await QRCode.toDataURL(paymentUrl, { margin: 2, width: 256 })
      pushBusinessCardToDialogue({ cardType: 'qrcode', image: dataUrl, orderId })
    } catch (e) {
      console.error('二维码生成失败:', e)
    }
    // 二维码展示后，允许后续流程再次推送提示语
    _paymentHintPushed = false

    // 设置支付状态检查
    if (_paymentPoller) {
      try { _paymentPoller.stop() } catch {}
      _paymentPoller = null
    }
    if (orderId) {
      console.log('开始监听支付状态:', orderId)
      _paymentPoller = new PaymentPoller(
        orderId,
        // onSuccess
        (data) => {
          try { showSuccessStatus(data) } catch (e) { console.warn('展示支付成功卡片:', e) }
          try { _paymentPoller.stop() } catch {}
          _paymentPoller = null
        },
      )
      try { _paymentPoller.start() } catch (e) { console.error('启动支付轮询失败:', e) }
    }
  }

  // ============ 预设问题列表管理 ============
  const showQuestionsListWithTimer = () => {
    // 显示预设问题列表
    updateUI({ 
      '#voicePresetQuestions': { action: 'show' },
      '.preset-questions': { action: 'show' }
    })
    
    // 2秒后隐藏问题列表并显示对话框
    timers.questionsDisplay = setTimeout(() => {
      updateUI({ 
        '#voicePresetQuestions': { action: 'hide' },
        '.preset-questions': { action: 'hide' }
      })
      
      // 显示对话框
      showChatDialog()
    }, 4000)
  }

  const showChatDialog = () => {
    // 显示对话框区域
    updateUI({ 
      '.dialogueArea': { action: 'show' },
      '.chat-container': { action: 'show' }
    })
    
    // 确保对话框在UI中可见
    try {
      uiStore?.showPopup?.('chatDialog')
    } catch {}
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

    // 音频结束：强制重置动画切换状态、停止说话动作
    state.value.isAnimationSwitching = false
    if (state.value.pendingAction) {
      state.value.pendingAction = null
    }

    // 立即切换到静态动作
    setAvatarAction('static')

    // 在语音结束后退出
    if (state.value.isProcessingBusiness && state.value.pendingExitAfterSpeech) {
      state.value.pendingExitAfterSpeech = false
      exitBusiness()
    }
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

    // 唤醒状态不再播放awakening对话，直接由智能体处理
    // 停止任何现有的对话轮播
    stopDialogueLoop()
    
    // 设置静态动作，等待智能体回复
    if (!state.value.isManualMode) {
      setAvatarAction('static')
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

  }

  // ============ 形象和动作 ============
  const setCurrentAvatar = (avatar) => {
    avatarStore?.setCurrentAvatar(avatar)
  }

  const setAvatarAction = (actionName) => {
    const currentAvatar = avatarStore?.currentAvatar || config.initAvatar
    const actionConfig = config.avatars?.[currentAvatar]?.actions?.[actionName]

    if (!actionConfig) {
      return
    }

    // 如果要切换到 static，清除动画切换状态和待处理动作
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

  const pushUserDialogue = (text, opts = {}) => {
    if (!bussDialogueArr) {
      console.warn('bussDialogueArr 未定义')
      return
    }
    const now = Date.now()
    const normText = String(text || '')
      .trim()
      .replace(/\s+/g, '')

    // 查找最后一条用户消息是否为流式项
    const lastItem = bussDialogueArr[bussDialogueArr.length - 1]
    const isStreamingUser = lastItem && lastItem.type === 'user' && lastItem.isStreaming

    if (isStreamingUser) {
      // 流式更新同一个对话项
      lastItem.text = text
    } else {
      // 推入新的流式对话项
      pushDialogueItem({ type: 'user', text, isStreaming: true })
    }

    // 记录最近一次用户输入（用于节流去重统计）
    lastUserPush = { normText, ts: now }

    // 最终识别结果通过 opts.finalize 标记
    if (opts && opts.finalize) {
      const item = bussDialogueArr[bussDialogueArr.length - 1]
      if (item && item.type === 'user' && item.isStreaming) {
        item.isStreaming = false
      }
    }
  }
  // 结束用户流式对话项 ASR最终结果调用
  const finishUserStreamingDialogue = () => {
    if (!bussDialogueArr || bussDialogueArr.length === 0) return
    const lastItem = bussDialogueArr[bussDialogueArr.length - 1]
    if (lastItem && lastItem.type === 'user' && lastItem.isStreaming) {
      lastItem.isStreaming = false
    }
  }

  // ============ 语音输入处理 ============
  const handleVoiceInput = (transcript) => {
    const cleanText = transcript.toLowerCase().replace(/[,。!?\s]/g, '')

    // 唤醒词检测 - 直接连接智能体
    if (checkKeywords(cleanText, config.wakeWords || [])) {
      switchState(states.AWAKENED || 'awakened')
      
      // 立即进入业务状态并连接智能体
      switchState(states.BUSINESS_PROCESSING || 'business', { businessKey: 'agent' })
      Object.assign(state.value, {
        businessFlow: 'agent',
        businessStep: 0,
        isProcessingBusiness: true,
      })

      // 清理轮播并连接智能体
      stopDialogueLoop()

      try { managers.utils?.stopTypewriter?.() } catch {}
      try { uiStore?.clearIntroText?.() } catch {}
      updateUI({ '#introPopup': { action: 'hide' } })

      // 触发预设问题列表显示和自动消失逻辑
      showQuestionsListWithTimer()

      // 连接智能体，发送唤醒词
      sendToAgent('你好')

      return true
    }

    // 在已唤醒状态下，检测业务关键词
    if ([states.AWAKENED, states.WELCOME].includes(state.value.current)) {
      const businessKey = findBusinessKeyword(cleanText)
      if (businessKey) {
        switchState(states.BUSINESS_PROCESSING || 'business', { businessKey })
        Object.assign(state.value, {
          businessFlow: businessKey,
          businessStep: 0,
          isProcessingBusiness: true,
        })

        stopDialogueLoop()
        try { managers.utils?.stopTypewriter?.() } catch {}
        try { uiStore?.clearIntroText?.() } catch {}
        updateUI({ '#introPopup': { action: 'hide' } })

        sendToAgent(transcript)
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

    const cancelWords = ['取消', '退出', '返回']

    // 所有业务流程都使用智能体处理
    if (state.value.businessFlow) {
      // 若检测到退出类指令，等待智能体回复音频播放完毕后退出
      if (cancelWords.some(w => text.includes(w))) {
        state.value.pendingExitAfterSpeech = true
        sendToAgent(text)
        return true
      }

      // 连接并发送到智能体（带重试队列）
      sendToAgent(text)

      return true
    }

    return false
  }

  // ============ 业务流程处理 ============
  const processCurrentBusinessStep = () => {
    // 已简化：所有业务流程都通过智能体处理
    console.log('业务流程已简化，使用智能体处理')
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

  const showSuccessStatus = (data) => {
    const amtRaw = (data && data.amount) ?? businessData.recharge.amount ?? '0'
    const amtStr = typeof amtRaw === 'number'
      ? amtRaw.toFixed(2)
      : (/^\d+(?:\.\d+)?$/.test(String(amtRaw)) ? Number(amtRaw).toFixed(2) : String(amtRaw))
    const tel = (data && (data.phoneNumber || data.phoneNum)) ?? businessData.recharge.phone ?? '18910026575'

    // 展示成功卡片（金额与手机号）
    pushBusinessCardToDialogue({
      cardType: 'success',
      text: '充值成功',
      amount: amtStr,
      telNum: tel,
    })

    // 推送成功文案到对话框（余额动态）并同时播放 TTS 与成功音效
    try {
      const balRaw = (data && data.balance)
      const balNum = typeof balRaw === 'number' ? balRaw : Number(String(balRaw ?? '').replace(/[^\d.-]/g, ''))
      const balStr = Number.isFinite(balNum)
        ? (balNum % 1 === 0 ? String(balNum) : balNum.toFixed(2))
        : String(balRaw || amtStr)
      const successText = `充值成功了！当前余额${balStr}元，您可以继续与我对话或点击右上方按钮结束对话`
      pushDialogueItem({ type: 'assistant', text: successText })
      // 同步播放文字合成音频与成功音效
      try { managers.audio?.playCustomAudio?.(successText) } catch {}
      try { if (audios?.finishing) managers.audio?.playSfx?.(audios.finishing) } catch {}
    } catch (e) { console.warn('推送/播放成功提示失败:', e) }

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
    // 已简化：不再使用写死的业务步骤，由智能体控制流程
    console.log('业务流程由智能体控制，不再使用固定步骤')
  }

  const exitBusiness = () => {
    console.log('退出业务流程')
    stopDialogueLoop()

    // 停止支付轮询
    if (_paymentPoller) {
      try { _paymentPoller.stop() } catch {}
      _paymentPoller = null
    }

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
  const setManagers = (audioManager, uiManager, utilsManager, speechRecognitionManager) => {
    Object.assign(managers, {
      audio: audioManager,
      ui: uiManager,
      utils: utilsManager,
      speechRecognition: speechRecognitionManager
    })
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
    finishUserStreamingDialogue,
    playDialogue,
    updateUI,
    handleSpeakingStart,
    handleSpeakingEnd,
    stopDialogueLoop,
    // 智能体相关功能
    agentWebSocket,
    agentChat,
    showQRCodeFromAgent,
    // 预设问题列表管理
    showQuestionsListWithTimer,
    showChatDialog
    // 注意：currentAvatar 和 currentBg 现在通过 avatarStore 管理
  }
}
