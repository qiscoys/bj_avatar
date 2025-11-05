/**
 * WebSocket通信封装
 */
import { ref, onUnmounted } from 'vue'

export function useWebSocket(url) {
  const ws = ref(null)
  const isConnected = ref(false)
  const connectionStatus = ref('未连接')

  // 连接WebSocket
  const connect = (onMessage) => {
    try {
      connectionStatus.value = '连接中...'
      ws.value = new WebSocket(url)

      ws.value.onopen = () => {
        isConnected.value = true
        connectionStatus.value = '已连接'
      }

      ws.value.onmessage = (event) => {
        if (onMessage) {
          onMessage(event.data)
        }
      }

      ws.value.onerror = (error) => {
        console.error('WebSocket错误:', error)
        connectionStatus.value = '连接错误'
      }

      ws.value.onclose = () => {
        isConnected.value = false
        connectionStatus.value = '连接已断开'

        // 5秒后自动重连
        setTimeout(() => {
          if (onMessage) {
            connect(onMessage)
          }
        }, 5000)
      }
    } catch (error) {
      console.error('连接失败:', error)
      connectionStatus.value = '连接失败'
    }
  }

  // 发送消息
  const sendMessage = (message) => {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      const payload = { keywords: message }
      ws.value.send(JSON.stringify(payload))
      return true
    }
    return false
  }

  // 关闭连接
  const close = () => {
    if (ws.value) {
      ws.value.close()
    }
  }

  // 组件卸载时关闭连接
  onUnmounted(() => {
    close()
  })

  return {
    ws,
    isConnected,
    connectionStatus,
    connect,
    sendMessage,
    close
  }
}

