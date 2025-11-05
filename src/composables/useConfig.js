import { ref, reactive } from 'vue'

// 全局配置状态
const config = reactive({})
const isConfigLoaded = ref(false)

let loadPromise = null

/**
 * 加载配置文件
 */
async function loadConfig() {
  // 防止重复加载
  if (loadPromise) return loadPromise
  
  loadPromise = (async () => {
    try {
      // 兼容子路径部署：使用 Vite 的 BASE_URL 作为前缀
      const base = (import.meta?.env?.BASE_URL ?? '/').replace(/\/+/g, '/');
      const url = `${base}config.json?t=${Date.now()}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`配置文件加载失败: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      Object.assign(config, data);
      console.log('配置加载成功');
      isConfigLoaded.value = true;
    } catch (e) {
      // 保持应用可启动：记录异常，但不阻断挂载
      console.warn('配置加载失败，应用将使用默认配置继续启动:', e);
      isConfigLoaded.value = false;
    }
    return true
  })()
  
  return loadPromise
}

/**
 * 重新加载配置
 */
async function reloadConfig() {
  loadPromise = null
  isConfigLoaded.value = false
  Object.keys(config).forEach(key => delete config[key])
  return loadConfig()
}

/**
 * 获取配置项（支持路径访问如 'avatars.avatar1'）
 */
function getConfig(path) {
  if (!path) return config
  
  return path.split('.').reduce((obj, key) => obj?.[key], config)
}

/**
 * 设置配置值（仅内存）
 */
function setConfig(path, value) {
  const keys = path.split('.')
  const lastKey = keys.pop()
  
  const target = keys.reduce((obj, key) => {
    if (!obj[key] || typeof obj[key] !== 'object') {
      obj[key] = {}
    }
    return obj[key]
  }, config)
  
  target[lastKey] = value
}

/**
 * 配置管理 Composable
 */
export function useConfig() {
  return {
    config,
    isConfigLoaded,
    getConfig,
    setConfig,
    loadConfig,
    reloadConfig,
    // 便捷方法
    getAvatarConfig: (id) => config.avatars?.[id] || {},
    getBackgroundConfig: (id) => config.backgrounds?.[id] || {},
    getBusinessFlowConfig: (name) => config.businessFlows?.[name] || {},
    getDialogueConfig: (type) => config.dialogues?.[type] || [],
    getAudioConfig: (key) => config.audios?.[key] || ''
  }
}

/**
 * 初始化配置
 */
export async function initConfig() {
  return loadConfig()
}

export default config