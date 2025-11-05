import { defineStore } from 'pinia'

export const useSpeechStore = defineStore('speech', () => {
  // 语音识别状态
  const recognition = reactive({
    isRecording: false,
    isListening: false,
    isProcessing: false,
    currentText: '',
    finalText: '',
    interimText: '',
    confidence: 0,
    error: null,
    isSupported: false
  })

  // 语音合成状态
  const synthesis = reactive({
    isSpeaking: false,
    isPaused: false,
    currentText: '',
    voice: null,
    rate: 1,
    pitch: 1,
    volume: 1,
    isSupported: false
  })

  // 音频播放状态
  const audio = reactive({
    isPlaying: false,
    isPaused: false,
    currentAudio: null,
    volume: 1,
    duration: 0,
    currentTime: 0,
    playbackRate: 1
  })

  // 语音聊天状态
  const voiceChat = reactive({
    isActive: false,
    isConnected: false,
    callDuration: 0,
    callStartTime: null,
    isHangupActive: false,
    voiceReplyMsgId: null,
    lastVoiceReply: ''
  })

  // 长按录音状态
  const longPress = reactive({
    isActive: false,
    startTime: null,
    duration: 0,
    minDuration: 500, // 最小录音时长
    maxDuration: 60000, // 最大录音时长
    textBuffer: '' // 长按录音文本缓冲区
  })

  // 语音识别相关状态
  const voiceRecognition = reactive({
    isVoiceRecording: false, // 普通语音录音状态
    // recognizedText: '', // 识别到的文本
    isInitialized: false // 是否已初始化
  })

  // 计算属性
  const isVoiceRecording = computed(() => recognition.isRecording || longPress.isActive)
  const canStartRecording = computed(() => !recognition.isRecording && !recognition.isProcessing)
  const canStartSpeaking = computed(() => !synthesis.isSpeaking && !audio.isPlaying)
  const isVoiceActive = computed(() => recognition.isRecording || synthesis.isSpeaking || audio.isPlaying)

  // 语音识别动作
  const setRecordingState = (isRecording) => {
    recognition.isRecording = isRecording
  }

  const setListeningState = (isListening) => {
    recognition.isListening = isListening
  }

  const setProcessingState = (isProcessing) => {
    recognition.isProcessing = isProcessing
  }

  const setCurrentText = (text) => {
    recognition.currentText = text
  }

  const setFinalText = (text) => {
    recognition.finalText = text
  }

  const setInterimText = (text) => {
    recognition.interimText = text
  }

  const setConfidence = (confidence) => {
    recognition.confidence = confidence
  }

  const setRecognitionError = (error) => {
    recognition.error = error
  }

  const setRecognitionSupported = (supported) => {
    recognition.isSupported = supported
  }

  // 语音合成动作
  const setSpeakingState = (isSpeaking) => {
    synthesis.isSpeaking = isSpeaking
  }

  const setSynthesisPaused = (isPaused) => {
    synthesis.isPaused = isPaused
  }

  const setSynthesisText = (text) => {
    synthesis.currentText = text
  }

  const setSynthesisVoice = (voice) => {
    synthesis.voice = voice
  }

  const setSynthesisRate = (rate) => {
    synthesis.rate = rate
  }

  const setSynthesisPitch = (pitch) => {
    synthesis.pitch = pitch
  }

  const setSynthesisVolume = (volume) => {
    synthesis.volume = volume
  }

  const setSynthesisSupported = (supported) => {
    synthesis.isSupported = supported
  }

  // 音频播放动作
  const setAudioPlaying = (isPlaying) => {
    audio.isPlaying = isPlaying
  }

  const setAudioPaused = (isPaused) => {
    audio.isPaused = isPaused
  }

  const setCurrentAudio = (audioElement) => {
    audio.currentAudio = audioElement
  }

  const setAudioVolume = (volume) => {
    audio.volume = volume
  }

  const setAudioDuration = (duration) => {
    audio.duration = duration
  }

  const setAudioCurrentTime = (currentTime) => {
    audio.currentTime = currentTime
  }

  const setAudioPlaybackRate = (rate) => {
    audio.playbackRate = rate
  }

  // 语音聊天动作
  const setVoiceChatActive = (isActive) => {
    voiceChat.isActive = isActive
    if (isActive) {
      voiceChat.callStartTime = Date.now()
    } else {
      voiceChat.callStartTime = null
      voiceChat.callDuration = 0
    }
  }

  const setVoiceChatConnected = (isConnected) => {
    voiceChat.isConnected = isConnected
  }

  const updateCallDuration = () => {
    if (voiceChat.callStartTime) {
      voiceChat.callDuration = Date.now() - voiceChat.callStartTime
    }
  }

  const setHangupActive = (isActive) => {
    voiceChat.isHangupActive = isActive
  }

  const setVoiceReplyMsgId = (msgId) => {
    voiceChat.voiceReplyMsgId = msgId
  }

  const setLastVoiceReply = (reply) => {
    voiceChat.lastVoiceReply = reply
  }

  // 长按录音动作
  const startLongPress = () => {
    longPress.isActive = true
    longPress.startTime = Date.now()
    longPress.duration = 0
  }

  const updateLongPressDuration = () => {
    if (longPress.startTime) {
      longPress.duration = Date.now() - longPress.startTime
    }
  }

  const endLongPress = () => {
    longPress.isActive = false
    longPress.startTime = null
    longPress.duration = 0
  }

  const setLongPressTextBuffer = (text) => {
    longPress.textBuffer = text
  }

  // 语音识别动作
  const setVoiceRecordingState = (isRecording) => {
    voiceRecognition.isVoiceRecording = isRecording
  }

  // const setRecognizedText = (text) => {
  //   voiceRecognition.recognizedText = text
  // }

  const setVoiceRecognitionInitialized = (initialized) => {
    voiceRecognition.isInitialized = initialized
  }

  const isLongPressValid = computed(() => {
    return longPress.duration >= longPress.minDuration && longPress.duration <= longPress.maxDuration
  })

  // 重置所有状态
  const resetRecognition = () => {
    Object.assign(recognition, {
      isRecording: false,
      isListening: false,
      isProcessing: false,
      currentText: '',
      finalText: '',
      interimText: '',
      confidence: 0,
      error: null
    })
  }

  const resetSynthesis = () => {
    Object.assign(synthesis, {
      isSpeaking: false,
      isPaused: false,
      currentText: '',
      rate: 1,
      pitch: 1,
      volume: 1
    })
  }

  const resetAudio = () => {
    Object.assign(audio, {
      isPlaying: false,
      isPaused: false,
      currentAudio: null,
      volume: 1,
      duration: 0,
      currentTime: 0,
      playbackRate: 1
    })
  }

  const resetVoiceChat = () => {
    Object.assign(voiceChat, {
      isActive: false,
      isConnected: false,
      callDuration: 0,
      callStartTime: null,
      isHangupActive: false,
      voiceReplyMsgId: null,
      lastVoiceReply: ''
    })
  }

  const resetLongPress = () => {
    Object.assign(longPress, {
      isActive: false,
      startTime: null,
      duration: 0
    })
  }

  const resetAll = () => {
    resetRecognition()
    resetSynthesis()
    resetAudio()
    resetVoiceChat()
    resetLongPress()
  }

  return {
    // 状态
    recognition: readonly(recognition),
    synthesis: readonly(synthesis),
    audio: readonly(audio),
    voiceChat: readonly(voiceChat),
    longPress: readonly(longPress),
    voiceRecognition: readonly(voiceRecognition),
    
    // 计算属性
    isVoiceRecording,
    canStartRecording,
    canStartSpeaking,
    isVoiceActive,
    isLongPressValid,
    
    // 语音识别动作
    setRecordingState,
    setListeningState,
    setProcessingState,
    setCurrentText,
    setFinalText,
    setInterimText,
    setConfidence,
    setRecognitionError,
    setRecognitionSupported,
    
    // 语音合成动作
    setSpeakingState,
    setSynthesisPaused,
    setSynthesisText,
    setSynthesisVoice,
    setSynthesisRate,
    setSynthesisPitch,
    setSynthesisVolume,
    setSynthesisSupported,
    
    // 音频播放动作
    setAudioPlaying,
    setAudioPaused,
    setCurrentAudio,
    setAudioVolume,
    setAudioDuration,
    setAudioCurrentTime,
    setAudioPlaybackRate,
    
    // 语音聊天动作
    setVoiceChatActive,
    setVoiceChatConnected,
    updateCallDuration,
    setHangupActive,
    setVoiceReplyMsgId,
    setLastVoiceReply,
    
    // 长按录音动作
    startLongPress,
    endLongPress,
    updateLongPressDuration,
    setLongPressTextBuffer,
    
    // 语音识别动作
    setVoiceRecordingState,
    // setRecognizedText,
    setVoiceRecognitionInitialized,
    setVoiceReplyMsgId,
    setLastVoiceReply,
    
    // 长按录音动作
    startLongPress,
    updateLongPressDuration,
    endLongPress,
    
    // 重置动作
    resetRecognition,
    resetSynthesis,
    resetAudio,
    resetVoiceChat,
    resetLongPress,
    resetAll
  }
})