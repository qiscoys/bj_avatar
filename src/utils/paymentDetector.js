/**
 * 支付URL检测工具
 */

// 检测是否包含支付信息
export function detectPayment(content) {
  // 提取微信支付URL
  const weixinUrlRegex = /(weixin:\/\/wxpay\/bizpayurl\?pr=[A-Za-z0-9]+)/
  const match = content.match(weixinUrlRegex)
  
  if (!match || !match[1]) {
    return null
  }
  
  const paymentUrl = match[1]
  
  // 检测支付标识
  const hasPaymentFlag = content.includes('000000，000000') || 
                        content.includes('000000,000000') ||
                        content.includes('000000，') ||
                        content.includes('000000,') ||
                        content.includes(',000000')
  
  if (!hasPaymentFlag) {
    return null
  }
  
  // 提取订单号（第一个逗号前的内容）
  const parts = content.split(',')
  const orderId = parts[0] ? parts[0].trim() : ''
  
  return {
    paymentUrl,
    orderId
  }
}

// 清理HTML标签，提取文本
export function extractTextFromHtml(html) {
  const temp = document.createElement('div')
  temp.innerHTML = html
  
  // 移除加载图标
  const loadingElements = temp.querySelectorAll('.el-icon-loading')
  loadingElements.forEach(el => el.remove())
  
  let text = temp.textContent || temp.innerText || ''
  text = text.replace(/正在调用【.*?】生成答案.../g, '').trim()
  
  return text || null
}

