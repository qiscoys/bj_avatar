import { useConfig } from '@/composables/useConfig'
import VoiceRecognizer from '@/utils/SpeechRecognition.js'
import { useSpeechStore } from '@/stores'

// 全局控制：防止重复绑定，支持统一移除旧监听
let __srListenersAbortController = null

// 🔥 首次启动标志：用于控制语音识别启动时机
// 只在第一段欢迎音频播放结束后才启动
let hasFirstStarted = false

export function useSpeechRecognition() {
  const speechStore = useSpeechStore()
  const { config } = useConfig()

  // Store 计算属性
  const isRecording = computed(() => speechStore.recognition.isRecording)
  const isListening = computed(() => speechStore.recognition.isListening)
  const isProcessing = computed(() => speechStore.recognition.isProcessing)
  const currentText = computed(() => speechStore.recognition.currentText)
  const finalText = computed(() => speechStore.recognition.finalText)
  const interimText = computed(() => speechStore.recognition.interimText)
  const confidence = computed(() => speechStore.recognition.confidence)
  const error = computed(() => speechStore.recognition.error)
  const isSupported = computed(() => speechStore.recognition.isSupported)
  const longPress = computed(() => speechStore.longPress)

  // 依赖管理器
  let avatarState = null
  let ui = null
  let audio = null
  let utils = null
  let recognizer = null
  let uiStore = null
  // 防重复处理
  let interimDebounceTimer = null
  let lastInterimTranscript = ''
  // 业务流程用户输入去重（规范化后的数字）
  const lastBusinessDigitsPushed = ref('')

  // 将中文数字（含大写）规范化为阿拉伯数字，仅保留数字字符
  const normalizeToDigits = (text) => {
    const s = String(text || '')
    const map = {
      '零': '0', '〇': '0', '○': '0', 'Ｏ': '0', 'o': '0', 'O': '0',
      '幺': '1', '一': '1', '壹': '1',
      '二': '2', '贰': '2', '两': '2',
      '三': '3', '叁': '3',
      '四': '4', '肆': '4',
      '五': '5', '伍': '5',
      '六': '6', '陆': '6',
      '七': '7', '柒': '7',
      '八': '8', '捌': '8',
      '九': '9', '玖': '9',
    }
    let out = ''
    for (const ch of s.replace(/\s+/g, '')) {
      if (/\d/.test(ch)) {
        out += ch
      } else if (map[ch]) {
        out += map[ch]
      } else {
        // 忽略单位字：十/百/千/万/亿 等，避免非逐位数字影响
      }
    }
    return out
  }
  let lastProcessedText = '' // 防重复：记录最后处理的文本

  // 本地状态
  const isVoiceRecording = ref(false)
  const isLongPressRecording = ref(false)
  const longPressTextBuffer = ref('')
  const isInitialized = ref(false)
  const isConnected = ref(false)
  // 去掉持续识别模式，按合成播放状态控制暂停/恢复
  const speechSynthesisActive = ref(false) // 语音合成播放状态
  const isSpeaking = ref(false) // 检测到用户正在说话
  const allowInterruption = ref(true) // 是否允许打断
  // const recognizedText = ref('')

  // 事件触发
  const emitEvent = (eventName) => {
    utils?.eventManager?.emit?.(document, eventName)
  }

  // 监听语音合成播放状态
  const setupSpeechSynthesisListeners = () => {
    // 先移除已有监听（若存在），避免重复绑定导致事件触发多次
    if (__srListenersAbortController) {
      try { __srListenersAbortController.abort() } catch (e) {}
    }
    __srListenersAbortController = new AbortController()
    const signal = __srListenersAbortController.signal

    // 监听语音合成开始事件
    document.addEventListener('speechStart', async () => {
      speechSynthesisActive.value = true
      
      // 语音合成开始时不再停止识别，而是继续运行以支持打断
      // 只清空识别结果显示，但保持识别器运行
      speechStore.setInterimText('')
      speechStore.setFinalText('')
      speechStore.setCurrentText('')
      speechStore.setConfidence(0)
      speechStore.setRecognitionError(null)
      
      // 支持打断
      if (!isVoiceRecording.value && allowInterruption.value) {
        try {
          await start({ interimResults: true })
        } catch (e) { /* ignore */ }
      }
    }, { signal })

    // 监听语音合成结束事件
    document.addEventListener('speechEnd', async () => {
      speechSynthesisActive.value = false
      // 清空识别结果，仿照 public 连接阶段重置
      speechStore.setInterimText('')
      speechStore.setFinalText('')
      speechStore.setCurrentText('')
      speechStore.setConfidence(0)
      speechStore.setRecognitionError(null)

      // 欢迎音频播放结束后才启动语音识别
      if (!hasFirstStarted) {
        hasFirstStarted = true
        const isAudioPlaying = audio?.isCurrentlyPlaying?.() || false
        if (!isAudioPlaying) {
          try {
            await start({ interimResults: true })
          } catch (e) { /* ignore */ }
        }
        return  // 首次启动后返回，不执行下面的重启逻辑
      }

      // 后续的音频播放结束，确保识别继续运行
      const isAudioPlaying = audio?.isCurrentlyPlaying?.() || false
      // 检查识别器的实际状态，而不仅仅依赖本地变量
      const actuallyRecording = recognizer?.isListening || false
      console.log('[语音识别] speechEnd事件触发，检查是否需要重启', {
        isAudioPlaying,
        actuallyRecording,
        isVoiceRecording: isVoiceRecording.value,
        avatarState: avatarState?.getCurrentState?.()
      })
      
      if (!isAudioPlaying && !actuallyRecording) {
        try {
          console.log('[语音识别] 音频播放结束，准备重启识别')
          await start({ interimResults: true })
          console.log('[语音识别] 重启识别成功')
        } catch (e) {
          console.warn('[语音识别] 重启语音识别失败:', e)
        }
      }
    }, { signal })

    // 监听语音合成错误事件
    document.addEventListener('speechError', async () => {
      speechSynthesisActive.value = false
      // 清空识别结果
      speechStore.setInterimText('')
      speechStore.setFinalText('')
      speechStore.setCurrentText('')
      speechStore.setConfidence(0)
      speechStore.setRecognitionError(null)

      if (!hasFirstStarted) {
        hasFirstStarted = true
      }

      // 确保识别继续运行
      if (!isVoiceRecording.value) {
        await start({ interimResults: true })
      }
    }, { signal })
  }

  // 初始化识别器
  const initRecognition = async () => {
    if (recognizer) return true

    recognizer = new VoiceRecognizer()
    await recognizer.init({
      interimResults: true,
      lang: 'zh-CN'
    })

    // 事件绑定
    recognizer.on('connected', () => {
      isConnected.value = true
    })

    recognizer.on('disconnected', () => {
      isConnected.value = false
    })

    recognizer.on('start', () => {
      isVoiceRecording.value = true
      speechStore.setRecordingState(true)
      // 清空结果，避免叠加
      speechStore.setInterimText('')
      speechStore.setFinalText('')
      speechStore.setCurrentText('')
      speechStore.setConfidence(0)
      emitEvent('speechRecognitionStart')
    })

    recognizer.on('result', ({ final, interim, isFinal, confidence: conf }) => {
      const transcript = final || interim
      console.log('语音识别结果:', transcript, isFinal ? '(最终)' : '(中间)')
      if (isFinal && final?.trim()) {
        console.log('语音识别最终结果:', final.trim())
      }

      // 如果在语音合成播放时检测到用户说话，立即打断
      if (speechSynthesisActive.value && allowInterruption.value && transcript?.trim()) {
        // 停止语音合成
        if (window.speechSynthesis) {
          window.speechSynthesis.cancel()
        }
        // 触发语音合成停止事件
        emitEvent('speechSynthesisInterrupted')
        speechSynthesisActive.value = false
        
        // 清空之前的合成内容，准备处理用户输入
        speechStore.setInterimText('')
        speechStore.setFinalText('')
        speechStore.setCurrentText('')
      }

      if (isLongPressRecording.value) {
        longPressTextBuffer.value = transcript || ''
        speechStore.setInterimText(transcript || '')
        return
      }

      if (isFinal && final?.trim()) {
        // 只在最终结果时处理和发送
        // 清理实时派发定时器（如果有未完成的中间结果处理）
        if (interimDebounceTimer) {
          clearTimeout(interimDebounceTimer)
          interimDebounceTimer = null
        }

        // 防重复：检查是否已经处理过相同或相似的文本
        const normalizedFinal = final.trim().replace(/[。，！？\s]+$/g, '') // 去除尾部标点
        const normalizedLast = lastProcessedText.replace(/[。，！？\s]+$/g, '')

        if (normalizedFinal !== normalizedLast) {
          lastProcessedText = final.trim()
          onRecognitionComplete(final.trim())
        }

        // 更新 Store 最终结果
        speechStore.setFinalText(final.trim())
        speechStore.setInterimText('')
        speechStore.setConfidence(typeof conf === 'number' ? conf : 0)
      } else {
        // 中间结果：实时体现到用户对话框（业务流程内），并更新Store
        speechStore.setInterimText(transcript || '')
        speechStore.setConfidence(typeof conf === 'number' ? conf : 0)

        const curr = (transcript || '').trim()
        if (curr && curr !== lastInterimTranscript) {
          lastInterimTranscript = curr
          if (interimDebounceTimer) clearTimeout(interimDebounceTimer)
          // 轻微防抖，避免频繁推送但保持实时感
          interimDebounceTimer = setTimeout(() => {
            updateVoiceDisplay(curr)
          }, 120)
        }
      }
    })

    recognizer.on('end', async () => {
      isVoiceRecording.value = false
      speechStore.setRecordingState(false)
      emitEvent('speechRecognitionEnd')

      // 在未播放合成音频的情况下，自动继续识别
      const isAudioPlaying = audio?.isCurrentlyPlaying?.() || false
      console.log('[语音识别] 识别结束，准备自动重启', {
        speechSynthesisActive: speechSynthesisActive.value,
        isAudioPlaying,
        avatarState: avatarState?.getCurrentState?.()
      })

      if (!speechSynthesisActive.value && !isAudioPlaying) {
        setTimeout(async () => {
          try {
            await start({ interimResults: true })
            console.log('[语音识别] 自动重启成功')
          } catch (e) {
            console.warn('[语音识别] 自动重启失败:', e)
          }
        }, 100)
      }
    })

    recognizer.on('error', async (e) => {
      resetRecordingState()
      emitEvent('speechRecognitionError')

      // 非合成播放时尝试自动恢复识别
      const isAudioPlaying = audio?.isCurrentlyPlaying?.() || false
      if (!speechSynthesisActive.value && !isAudioPlaying) {
        // 渐进重试，避免服务端短暂不可用造成的立即失败
        const delays = [200, 800, 2000]
        const tryRestart = async (i = 0) => {
          try {
            await start({ interimResults: true })
            console.log('[语音识别] 自动重启成功')
          } catch (err) {
            console.warn('[语音识别] 自动重启失败:', err)
            if (i < delays.length) {
              setTimeout(() => tryRestart(i + 1), delays[i])
            } else {
              speechStore.setRecognitionError('WebSocket连接失败，请检查服务地址是否可达')
            }
          }
        }
        tryRestart(0)
      }
    })

    // 监听语音检测事件
    recognizer.on('speechstart', () => {
      isSpeaking.value = true
    })

    recognizer.on('speechend', () => {
      isSpeaking.value = false
    })

    isInitialized.value = true
    return true
  }

  // 开始识别
  const start = async (opts = {}) => {
    if (!isInitialized.value) {
      await initRecognition()
    }

    if (isVoiceRecording.value) return false

    // 触发识别流程前，清空识别结果，避免叠加
    speechStore.setInterimText('')
    speechStore.setFinalText('')
    speechStore.setCurrentText('')
    speechStore.setConfidence(0)
    speechStore.setRecognitionError(null)

    // 重置防重复标记，开启新的识别会话
    lastProcessedText = ''

    await recognizer.start({
      interimResults: opts.interimResults ?? true,
      lang: 'zh-CN'
    })
    return true
  }

  // 停止识别
  const stop = async () => {
    if (recognizer && isVoiceRecording.value) {
      await recognizer.stop()
    }
    resetRecordingState()
  }

  // 长按录音开始
  const startLongPressRecording = async () => {
    speechStore.startLongPress()
    speechStore.setInterimText('')
    longPressTextBuffer.value = ''
    isLongPressRecording.value = true

    const success = await start({ interimResults: true })
    if (!success) {
      speechStore.endLongPress()
      isLongPressRecording.value = false
    }
  }

  // 长按录音结束
  const endLongPressRecording = async () => {
    if (!isLongPressRecording.value) return

    speechStore.endLongPress()
    isLongPressRecording.value = false
    await stop()

    const result = recognizer?.getResult?.() || {}
    const text = (result.final || result.interim || longPressTextBuffer.value || '').trim()
    if (text) {
      onRecognitionComplete(text)
    }

    speechStore.setInterimText('')
  }

  // 识别完成处理（仅最终结果）
  const onRecognitionComplete = (transcript) => {
    const norm = String(transcript || '').trim().replace(/\s+/g, '')
    if (!norm) return

    updateVoiceDisplay(transcript)
    // 结束用户流式对话项
    try { avatarState?.finishUserStreamingDialogue?.() } catch {}
    processVoiceInput(transcript)
  }

  // 处理语音输入
  const processVoiceInput = (transcript) => {
    const isActionMode = ui?.actionStatus?.value

    if (avatarState && !isActionMode) {
      if (avatarState.handleVoiceInput?.(transcript)) {
        return
      }
    }
    handleLegacyVoiceInput(transcript)
  }

  // 更新显示
  const updateVoiceDisplay = (transcript) => {
    const isInBusiness = avatarState?.getCurrentState?.() === config?.states?.BUSINESS_PROCESSING
      && avatarState?.isProcessingBusinessFlow?.()

    if (isInBusiness && avatarState?.pushUserDialogue) {
      // 在业务流程中：若包含数字则仅推送数字；否则推送原始文本
      // const digits = normalizeToDigits(transcript)
      // if (digits) {
      //   if (digits !== lastBusinessDigitsPushed.value) {
      //     avatarState.pushUserDialogue(digits)
      //     lastBusinessDigitsPushed.value = digits
      //   }
      // } else {
        avatarState.pushUserDialogue(transcript)
      // }
    } else {
      speechStore.setCurrentText(transcript)
    }
  }

  // 重置状态
  const resetRecordingState = () => {
    speechStore.setRecordingState(false)
    speechStore.endLongPress()
    speechStore.setInterimText('')
    isLongPressRecording.value = false
    lastProcessedText = '' // 重置防重复标记
  }

  // ===== 传统语音处理 =====
  const handleLegacyVoiceInput = (transcript) => {
    const cleanText = transcript.toLowerCase().replace(/[，。！？\s]/g, '')

    if (handleDanceCommand(cleanText)) return
    if (handleAvatarSwitchCommands(cleanText)) return
    if (handleActionLibraryCommands(cleanText)) return
    if (handleActionSwitchCommands(cleanText)) return
    if (handleExitCommands(cleanText)) return
  }

  // 形象切换指令
  const handleAvatarSwitchCommands = (cleanText) => {
    // 获取所有可用形象配置
    const avatars = config.avatars || {}

    // 检查是否包含"切换形象"关键词（打开弹窗）
    const openModalKeywords = ['切换形象', '换形象', '更换形象','形象切换',]
    const shouldOpenModal = openModalKeywords.some(k => cleanText.includes(k))

    // 检查弹窗是否已打开
    const isModalOpen = uiStore?.showActionList || false

    // 第一步：如果说"切换形象"且弹窗未打开，则打开弹窗
    if (shouldOpenModal && !isModalOpen) {
      if (uiStore?.showPopup) {
        uiStore.showPopup('actionList')
      }
      return true
    }

    // 第二步：如果弹窗已打开，检查是否匹配形象名称
    if (isModalOpen) {
      // 遍历所有形象配置，动态匹配
      for (const [avatarId, avatarConfig] of Object.entries(avatars)) {
        const avatarName = avatarConfig.name || ''
        const avatarNameEn = avatarConfig.nameEn || ''

        // 构建匹配关键词列表
        const matchKeywords = [
          avatarName,
          avatarNameEn,
          avatarId
        ].filter(Boolean)

        // 检查是否匹配形象名称或ID
        const matchesName = matchKeywords.some(keyword =>
          cleanText.includes(keyword.toLowerCase())
        )

        if (matchesName) {
          // 切换形象
          if (avatarState?.setCurrentAvatar) {
            avatarState.setCurrentAvatar(avatarId)
          }
          // 关闭弹窗
          if (uiStore?.hidePopup) {
            uiStore.hidePopup('actionList')
          }

          ui?.returnToMain?.()
          return true
        }
      }
    }

    return false
  }

  // 动作库指令
  const handleActionLibraryCommands = (cleanText) => {
    const keywords = ['动作库', '动作酷', '动作', '动库', '动作列表', '切换动作']
    if (!keywords.some(k => cleanText.includes(k))) return false

    if (typeof ui?.handleActionChange === 'function') {
      ui.handleActionChange()
    } else {
      avatarState?.enableManualActionMode?.()

      if (utils?.eventManager) {
        const uiChecker = utils.eventManager.getStateChecker('ui')
        if (uiChecker?.exists?.()) {
          if (uiChecker.hasMethod?.('pauseWelcomeActivities')) {
            ui?.pauseWelcomeActivities?.()
          }
          ui?.setActionStatus?.(true)
        }
      }
    }
    return true
  }

  // 动作切换指令
  const handleActionSwitchCommands = (cleanText) => {
    const actionMapping = typeof ui?.getActionMapping === 'function'
      ? ui.getActionMapping()
      : {}

    const cnMap = {
      action: '动作', sayHi: '打招呼', welcome: '欢迎', speak: '说话',
      listen: '聆听', dance: '跳舞', finishing: '成功', heart: '笔芯',
      happy: '开心', disappointed: '失望', submitInvoice: '开发票',
      queryData: '查询数据', introduceProd: '介绍产品', tel: '手机号',
      telConfirm: '号码确认',
    }

    for (const [action, chinese] of Object.entries(cnMap)) {
      if (actionMapping[action] && (cleanText.includes(chinese) || cleanText.includes(action))) {
        ui?.switchAction?.(action)
        if (ui?.currentAction) {
          ui.currentAction.value = action
        }
        return true
      }
    }
    return false
  }

  // 退出指令
  const handleExitCommands = (cleanText) => {
    const exitWords = ['退出', '返回主页', '返回主页面', '回到主页','结束对话']
    if (!exitWords.some(word => cleanText.includes(word))) return false

    ui?.returnToMain?.()
    return true
  }

  // 跳舞指令
  const handleDanceCommand = (cleanText) => {
    const danceKeywords = ['小翼请跳个舞', '小翼跳个舞', '跳个舞', '请跳舞', '跳舞吧']
    if (!danceKeywords.some(k => cleanText.includes(k))) return false

    // 🔥 启用手动模式，防止 speechEnd 事件自动切换动作
    if (avatarState?.setManualMode) {
      avatarState.setManualMode(true)
    }

    // 关闭语音识别
    stop()

    // 直接设置动作和UI，不触发自动音频播放
    try {
      if (uiStore?.forceSetCurrentAction) {
        uiStore.forceSetCurrentAction('danceStatus')
      }
    } catch {}

    if (avatarState?.state?.value) {
      avatarState.state.value.action = 'danceStatus'
    }

    // 播放跳舞音频
    const danceAudio = config.audios?.danceStatus
    if (danceAudio && audio?.playCustomAudio) {
      // 显示音乐符号
      showMusicNote()

      // 播放音频，音频结束后回到欢迎状态
      audio.playCustomAudio(danceAudio, () => {
        // 隐藏音乐符号
        hideMusicNote()

        // 🔥 禁用手动模式，恢复自动动作切换
        if (avatarState?.setManualMode) {
          avatarState.setManualMode(false)
        }

        // 退出
        handleExitCommands('退出')
      })
    }

    return true
  }

  // 显示音乐符号
  const showMusicNote = () => {
    const musicNote = document.getElementById('music-note-animation')
    if (musicNote) {
      musicNote.style.display = 'block'
    }
  }

  // 隐藏音乐符号
  const hideMusicNote = () => {
    const musicNote = document.getElementById('music-note-animation')
    if (musicNote) {
      musicNote.style.display = 'none'
    }
  }

  // 打断控制方法
  const setInterruptionEnabled = (enabled) => {
    allowInterruption.value = enabled
  }

  const isInterruptionEnabled = () => allowInterruption.value

  // 销毁
  const destroy = async () => {
    await stop()
    audio?.stopCurrentAudio?.()

    if (recognizer) {
      await recognizer.destroy()
      recognizer = null
    }

    isInitialized.value = false
  }

  // 初始化时设置语音合成监听器
  onMounted(() => {
    setupSpeechSynthesisListeners()
    initRecognition()
      .then(() => { /* initialized */ })
      .catch(() => { /* 忽略初始化错误 */ })
  })

  onUnmounted(destroy)

  return {
    // 状态
    isVoiceRecording: readonly(isVoiceRecording),
    isConnected: readonly(isConnected),
    isLongPressRecording: () => isLongPressRecording.value,
    longPressTextBuffer: readonly(longPressTextBuffer),
    isInitialized: readonly(isInitialized),
    speechSynthesisActive: readonly(speechSynthesisActive),
    isSpeaking: readonly(isSpeaking),
    allowInterruption: readonly(allowInterruption),
    // recognizedText: readonly(recognizedText),

    // Store 状态
    isRecording,
    isListening,
    isProcessing,
    currentText,
    finalText,
    interimText,
    confidence,
    error,
    isSupported,
    longPress,

    // 方法
    initRecognition,
    start,
    stop,
    startLongPressRecording,
    endLongPressRecording,
    stopRecording: () => isLongPressRecording.value ? endLongPressRecording() : stop(),
    isRecording: () => isVoiceRecording.value,
    setInterruptionEnabled,
    isInterruptionEnabled,
    destroy,

    // 依赖注入
    setManagers: (injectedAvatarState, injectedUi, injectedAudio, injectedUtils, injectedUiStore) => {
      avatarState = injectedAvatarState
      ui = injectedUi
      audio = injectedAudio
      utils = injectedUtils
      uiStore = injectedUiStore
    },
  }
}
