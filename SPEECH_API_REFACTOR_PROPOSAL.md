# 语音API架构重构方案

## 一、问题诊断

### 当前架构问题
1. **强耦合**：`VoiceRecognizer` 和 `VoiceSynthesizer` 直接依赖科大讯飞 API
2. **切换成本高**：更换供应商需要修改多处代码
3. **测试困难**：无法轻易 mock 第三方服务
4. **配置不灵活**：供应商参数硬编码在代码中

### 商业价值考量
- ✅ **供应商议价能力**：可快速切换，降低被单一供应商锁定的风险
- ✅ **服务可用性**：主备方案，A供应商故障时自动切换到B
- ✅ **成本优化**：根据使用场景选择最优性价比方案
- ✅ **合规要求**：不同地区可能要求使用本地供应商

---

## 二、推荐架构：适配器模式

### 核心思想
**"依赖抽象，而非依赖具体实现"**

```typescript
// 抽象接口（所有供应商都要实现）
interface ISpeechRecognition {
  init(config: RecognitionConfig): Promise<void>
  start(options?: StartOptions): Promise<void>
  stop(): Promise<void>
  on(event: string, callback: Function): void
  off(event: string, callback: Function): void
  destroy(): Promise<void>
}

interface ISpeechSynthesis {
  init(config: SynthesisConfig): Promise<void>
  speak(text: string, options?: SpeakOptions): Promise<void>
  stop(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  on(event: string, callback: Function): void
  destroy(): void
}
```

### 目录结构
```
src/
└── speech/
    ├── core/
    │   ├── ISpeechRecognition.ts      # 识别接口定义
    │   ├── ISpeechSynthesis.ts        # 合成接口定义
    │   └── types.ts                   # 通用类型定义
    │
    ├── adapters/
    │   ├── xfyun/                     # 科大讯飞适配器
    │   │   ├── XFRecognitionAdapter.ts
    │   │   └── XFSynthesisAdapter.ts
    │   │
    │   ├── baidu/                     # 百度语音适配器
    │   │   ├── BaiduRecognitionAdapter.ts
    │   │   └── BaiduSynthesisAdapter.ts
    │   │
    │   └── aliyun/                    # 阿里云适配器（预留）
    │       ├── AliyunRecognitionAdapter.ts
    │       └── AliyunSynthesisAdapter.ts
    │
    ├── factory/
    │   └── SpeechFactory.ts           # 工厂类，根据配置创建实例
    │
    └── composables/
        ├── useSpeechRecognition.ts    # 业务逻辑层（基于抽象接口）
        └── useSpeechSynthesis.ts
```

---

## 三、实现示例

### 1. 抽象接口定义

```typescript
// src/speech/core/ISpeechRecognition.ts
export interface RecognitionConfig {
  lang?: string
  interimResults?: boolean
  continuous?: boolean
  // 供应商特定配置通过 providerOptions 传递
  providerOptions?: Record<string, any>
}

export interface RecognitionResult {
  final: string
  interim: string
  confidence: number
  isFinal: boolean
}

export interface ISpeechRecognition {
  // 初始化
  init(config: RecognitionConfig): Promise<boolean>
  
  // 控制方法
  start(options?: RecognitionConfig): Promise<boolean>
  stop(): Promise<void>
  abort(): Promise<void>
  
  // 状态查询
  isSupported(): boolean
  getState(): RecognitionState
  getResult(): RecognitionResult
  
  // 事件系统
  on(event: 'start' | 'result' | 'end' | 'error', callback: Function): void
  off(event: string, callback: Function): void
  
  // 清理
  destroy(): Promise<void>
}
```

### 2. 科大讯飞适配器

```typescript
// src/speech/adapters/xfyun/XFRecognitionAdapter.ts
import { ISpeechRecognition, RecognitionConfig } from '@/speech/core/ISpeechRecognition'

export class XFRecognitionAdapter implements ISpeechRecognition {
  private ws: WebSocket | null = null
  private listeners = new Map()
  
  async init(config: RecognitionConfig): Promise<boolean> {
    // 科大讯飞特定的初始化逻辑
    const wsUrl = config.providerOptions?.wsUrl || 'ws://localhost:3001/asr'
    // ... 你现有的初始化代码
    return true
  }
  
  async start(options?: RecognitionConfig): Promise<boolean> {
    // 你现有的 start 逻辑
    return true
  }
  
  // ... 实现其他接口方法
}
```

### 3. 工厂类（核心）

```typescript
// src/speech/factory/SpeechFactory.ts
import type { ISpeechRecognition } from '@/speech/core/ISpeechRecognition'
import type { ISpeechSynthesis } from '@/speech/core/ISpeechSynthesis'

export type SpeechProvider = 'xfyun' | 'baidu' | 'aliyun'

export class SpeechFactory {
  /**
   * 创建语音识别实例
   */
  static async createRecognizer(provider: SpeechProvider): Promise<ISpeechRecognition> {
    switch (provider) {
      case 'xfyun': {
        const { XFRecognitionAdapter } = await import('@/speech/adapters/xfyun/XFRecognitionAdapter')
        return new XFRecognitionAdapter()
      }
      case 'baidu': {
        const { BaiduRecognitionAdapter } = await import('@/speech/adapters/baidu/BaiduRecognitionAdapter')
        return new BaiduRecognitionAdapter()
      }
      default:
        throw new Error(`不支持的语音识别供应商: ${provider}`)
    }
  }

  /**
   * 创建语音合成实例
   */
  static async createSynthesizer(provider: SpeechProvider): Promise<ISpeechSynthesis> {
    switch (provider) {
      case 'xfyun': {
        const { XFSynthesisAdapter } = await import('@/speech/adapters/xfyun/XFSynthesisAdapter')
        return new XFSynthesisAdapter()
      }
      case 'baidu': {
        const { BaiduSynthesisAdapter } = await import('@/speech/adapters/baidu/BaiduSynthesisAdapter')
        return new BaiduSynthesisAdapter()
      }
      default:
        throw new Error(`不支持的语音合成供应商: ${provider}`)
    }
  }
}
```

### 4. 配置文件

```json
// public/config.json 或 环境变量
{
  "speech": {
    "recognition": {
      "provider": "xfyun",
      "fallback": "baidu",
      "xfyun": {
        "wsUrl": "ws://localhost:3001/asr",
        "appId": "your-app-id"
      },
      "baidu": {
        "apiKey": "your-api-key",
        "secretKey": "your-secret-key"
      }
    },
    "synthesis": {
      "provider": "xfyun",
      "xfyun": {
        "wsUrl": "ws://localhost:3001/tts-ws",
        "appId": "130cba7b"
      }
    }
  }
}
```

### 5. 业务逻辑层重构

```typescript
// src/composables/useSpeechRecognition.ts
import { SpeechFactory } from '@/speech/factory/SpeechFactory'
import { useConfig } from '@/composables/useConfig'
import type { ISpeechRecognition } from '@/speech/core/ISpeechRecognition'

export function useSpeechRecognition() {
  const { config } = useConfig()
  let recognizer: ISpeechRecognition | null = null
  
  // 初始化识别器
  const initRecognition = async () => {
    if (recognizer) return true
    
    // 🔥 从配置中读取供应商
    const provider = config.speech?.recognition?.provider || 'xfyun'
    
    try {
      // 🔥 工厂创建，业务层不关心具体实现
      recognizer = await SpeechFactory.createRecognizer(provider)
      
      await recognizer.init({
        interimResults: true,
        lang: 'zh-CN',
        providerOptions: config.speech?.recognition?.[provider]
      })
      
      // 事件绑定（统一接口）
      recognizer.on('start', () => {
        isVoiceRecording.value = true
        speechStore.setRecordingState(true)
      })
      
      recognizer.on('result', ({ final, interim, isFinal, confidence }) => {
        // 你现有的业务逻辑
      })
      
      // ... 其他事件
      
      return true
    } catch (error) {
      console.error('语音识别初始化失败:', error)
      
      // 🔥 自动降级到备用供应商
      const fallback = config.speech?.recognition?.fallback
      if (fallback && fallback !== provider) {
        console.log(`尝试使用备用供应商: ${fallback}`)
        recognizer = await SpeechFactory.createRecognizer(fallback)
        await recognizer.init({ /* ... */ })
        return true
      }
      
      return false
    }
  }
  
  // ... 其他方法保持不变
  
  return {
    initRecognition,
    start,
    stop,
    // ...
  }
}
```

---

## 四、优势对比

### 方案A：保持现状（不建议）
❌ 切换供应商需要 2-3 天开发 + 全面测试  
❌ 多处代码需要修改（composable + utils）  
❌ 测试困难，依赖真实服务  

### 方案B：简单封装（短期方案）
⚠️ 只抽取配置文件  
⚠️ 代码仍然耦合  
⚠️ 切换时仍需修改核心逻辑  

### 方案C：适配器模式（推荐）
✅ 切换供应商只需修改配置文件  
✅ 新增供应商只需实现接口，不影响现有代码  
✅ 易于测试（可 mock 适配器）  
✅ 支持运行时切换和降级策略  
✅ 符合开闭原则（对扩展开放，对修改关闭）  

---

## 五、实施计划

### 阶段1：接口设计（1天）
- [ ] 定义 `ISpeechRecognition` 接口
- [ ] 定义 `ISpeechSynthesis` 接口
- [ ] 定义通用类型（Config, Result, State）

### 阶段2：适配器改造（2-3天）
- [ ] 创建 `XFRecognitionAdapter`（将现有代码迁移）
- [ ] 创建 `XFSynthesisAdapter`（将现有代码迁移）
- [ ] 实现 `SpeechFactory` 工厂类

### 阶段3：业务逻辑重构（1-2天）
- [ ] 修改 `useSpeechRecognition` 使用工厂
- [ ] 修改 `useSpeechSynthesis` 使用工厂
- [ ] 配置文件整合

### 阶段4：测试验证（1天）
- [ ] 功能回归测试
- [ ] 性能测试
- [ ] 准备备用供应商接入方案

**总耗时：5-7 工作日**

---

## 六、关键决策建议

### ✅ 建议进行重构，如果满足以下条件：
1. **项目处于迭代期**，有时间预算
2. **未来可能切换供应商**（商务谈判、成本优化）
3. **计划支持多地区部署**（国内用科大讯飞，海外用其他）
4. **需要 A/B 测试不同供应商**的效果

### ⚠️ 可暂缓重构，如果满足以下条件：
1. **项目即将上线**，时间非常紧张
2. **明确长期只用科大讯飞**，有长期合约
3. **团队规模小**，维护成本优先于架构优雅

---

## 七、最小可行方案（MVP）

如果时间紧张，可以先做**最小重构**：

```typescript
// 1. 提取配置到环境变量
const SPEECH_CONFIG = {
  asr: {
    wsUrl: import.meta.env.VITE_ASR_WS_URL || 'ws://localhost:3001/asr'
  },
  tts: {
    wsUrl: import.meta.env.VITE_TTS_WS_URL || 'ws://localhost:3001/tts-ws',
    appId: import.meta.env.VITE_TTS_APP_ID || '130cba7b'
  }
}

// 2. 在现有类中添加配置注入
export class VoiceRecognizer {
  constructor(config = SPEECH_CONFIG.asr) {
    this.wsUrl = config.wsUrl
    // ...
  }
}

// 3. 未来再迁移到适配器模式
```

这样至少做到了**配置与代码分离**，切换时只需修改环境变量。

---

## 八、参考案例

类似架构在以下场景被广泛使用：

- **支付系统**：统一接口对接微信/支付宝/银联
- **云存储**：统一接口对接阿里云OSS/腾讯云COS/七牛云
- **地图服务**：统一接口对接高德/百度/谷歌地图
- **推送服务**：统一接口对接极光/友盟/华为推送

---

## 九、总结

### 核心原则
> **"为变化设计，而非为现状设计"**

在生产级系统中，供应商切换是**常态而非例外**。提前做好抽象设计，可以在商务谈判、服务故障、成本优化等场景中快速应对。

### 投资回报率（ROI）
- **初始投入**：5-7 工作日重构
- **长期收益**：
  - 每次切换供应商从 3 天降低到 1 小时（修改配置）
  - 新增供应商从 5 天降低到 2 天（只写适配器）
  - 降低供应商锁定风险，提升议价能力

### 我的建议
**如果你们的项目：**
1. 已经有一定用户规模
2. 预算充足，考虑多供应商备份
3. 团队有一定技术追求

**那么我强烈建议进行这次重构。**

否则，可以先采用 MVP 方案（配置分离），等业务稳定后再重构。

---

## 附录：快速对比表

| 维护项 | 当前架构 | 重构后 |
|--------|---------|--------|
| 切换供应商 | 修改 3+ 文件 | 修改 1 个配置 |
| 新增供应商 | 修改核心代码 | 新建适配器 |
| 单元测试 | 依赖真实服务 | Mock 适配器 |
| 降级策略 | 需要手动改代码 | 配置自动切换 |
| 学习成本 | 低 | 中 |
| 长期维护性 | ⭐⭐ | ⭐⭐⭐⭐⭐ |

---

**需要我帮你开始实施重构吗？我可以：**
1. ✅ 生成完整的接口定义代码
2. ✅ 将你现有的科大讯飞代码迁移到适配器
3. ✅ 实现工厂类和配置系统
4. ✅ 更新 composables 以使用新架构

请告诉我你的决定！


