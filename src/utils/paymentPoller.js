/**
 * 支付状态轮询工具
 */

const POLL_INTERVAL = 5000 // 5秒轮询一次
const MAX_POLL_TIME = 5 * 60 * 1000 // 最多轮询5分钟
const MAX_POLL_COUNT = Math.floor(MAX_POLL_TIME / POLL_INTERVAL) // 60次

export class PaymentPoller {
  constructor(orderId, onSuccess, onTimeout, onError) {
    this.orderId = orderId
    this.onSuccess = onSuccess
    this.onTimeout = onTimeout
    this.onError = onError
    this.pollCount = 0
    this.timerId = null
    this.isPolling = false
  }

  // 开始轮询
  start() {
    if (this.isPolling) return
    
    this.isPolling = true
    this.pollCount = 0
    console.log(`🔄 开始轮询支付状态，订单号: ${this.orderId}`)
    
    // 立即执行第一次查询
    this.poll()
  }

  // 停止轮询
  stop() {
    if (this.timerId) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
    this.isPolling = false
    console.log('⏸️ 停止轮询支付状态')
  }

  // 执行一次轮询
  async poll() {
    if (!this.isPolling) return

    this.pollCount++
    console.log(`📡 第 ${this.pollCount}/${MAX_POLL_COUNT} 次查询支付状态...`)

    try {
      const result = await this.checkPaymentStatus()
      
      if (result.success) {
        // 支付成功
        console.log('✅ 支付成功！', result.data)
        this.stop()
        if (this.onSuccess) {
          this.onSuccess(result.data)
        }
        return
      }

      // 处理错误状态（订单不存在、支付失败、订单过期等）
      if (result.error) {
        console.log('❌ 支付错误:', result.message)
        this.stop()
        if (this.onError) {
          this.onError(new Error(result.message), result.message)
        }
        return
      }

      // 未支付（pending），继续轮询
      if (this.pollCount >= MAX_POLL_COUNT) {
        // 超时
        console.log('⏰ 轮询超时（5分钟）')
        this.stop()
        if (this.onTimeout) {
          this.onTimeout()
        }
        return
      }

      // 继续下一次轮询
      this.timerId = setTimeout(() => this.poll(), POLL_INTERVAL)

    } catch (error) {
      console.error('❌ 查询支付状态失败:', error)
      
      // 网络错误等异常，继续轮询（除非超时）
      if (this.pollCount >= MAX_POLL_COUNT) {
        this.stop()
        if (this.onTimeout) {
          this.onTimeout()
        }
      } else {
        // 继续轮询，可能是网络暂时问题
        this.timerId = setTimeout(() => this.poll(), POLL_INTERVAL)
      }
      
      // 通知错误但不停止轮询
      if (this.onError) {
        this.onError(error, '网络异常，继续重试...')
      }
    }
  }

  // 查询支付状态
  async checkPaymentStatus() {
    // 使用Vite代理路径，解决CORS问题
    const url = '/api/payment'
    
    const requestData = {
      transactionId: "",
      phoneNum: "",
      outTradeNo: this.orderId
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      })

      // 检查HTTP状态
      if (!response.ok) {
        throw new Error(`HTTP错误: ${response.status}`)
      }

      const data = await response.json()
      
      console.log('📥 支付状态响应:', data)

      // 判断支付状态
      if (data.retCode === '000000') {
        // 支付成功
        return {
          success: true,
          data: {
            balance: data.object?.balance,
            phoneNumber: data.object?.phoneNumber,
            billNo: data.object?.billNo,
            amount: data.object?.tamount,
            message: data.retMsg
          }
        }
      } else if (data.retCode === '1000002') {
        // 未支付，继续等待
        return {
          success: false,
          pending: true,
          message: data.retMsg
        }
      } else if (data.retCode === '1000003') {
        // 订单不存在
        return {
          success: false,
          error: true,
          message: data.retMsg || '订单不存在'
        }
      } else if (data.retCode === '1000004') {
        // 支付失败
        return {
          success: false,
          error: true,
          message: data.retMsg || '支付失败'
        }
      } else if (data.retCode === '1000005') {
        // 订单已过期
        return {
          success: false,
          error: true,
          message: data.retMsg || '订单已过期'
        }
      } else {
        // 其他未知状态
        return {
          success: false,
          error: true,
          message: data.retMsg || `未知状态: ${data.retCode}`
        }
      }

    } catch (error) {
      console.error('查询支付状态异常:', error)
      throw error
    }
  }
}

