let config: any = null

export interface AppConfig {
  name: string
  version: string
  description: string
  openclaw: {
    url: string
    token: string
    agent: string
    systemPrompt?: string
    thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  }
  tts?: {
    apiKey?: string
    endpoint?: string
    voice?: string
    enabled?: boolean
  }
  live2d: {
    modelPath: string
  }
  window: {
    width: number
    height: number
  }
}

// 获取环境变量
function getEnvValue(key: string): string | undefined {
  // @ts-ignore
  return import.meta.env?.[key]
}

// 异步加载配置
async function loadConfig(): Promise<AppConfig> {
  if (config) return config
  
  try {
    const response = await fetch('/config.json')
    config = await response.json()
  } catch (err) {
    console.warn('[Config] Failed to load config, using defaults:', err)
    config = {
      name: 'airi-claw',
      version: '1.0.0',
      description: '轻量级 AIRI 虚拟形象 + OpenClaw 集成',
      openclaw: {
        url: 'ws://127.0.0.1:18789',
        token: '',
        agent: 'main'
      },
      live2d: {
        modelPath: './assets/live2d/models/hiyori/Hiyori.model3.json'
      },
      window: {
        width: 400,
        height: 700
      }
    }
  }
  
  // 修复模型路径 - 使用相对路径
  if (config.live2d?.modelPath?.startsWith('/')) {
    config.live2d.modelPath = '.' + config.live2d.modelPath
  }
  
  // 从环境变量覆盖
  const envUrl = getEnvValue('VITE_OPENCLAW_URL')
  const envToken = getEnvValue('VITE_OPENCLAW_TOKEN')
  const envAgent = getEnvValue('VITE_OPENCLAW_AGENT')
  const envSystemPrompt = getEnvValue('VITE_OPENCLAW_SYSTEM_PROMPT')
  const envThinking = getEnvValue('VITE_OPENCLAW_THINKING')
  
  if (envUrl) config.openclaw.url = envUrl
  if (envToken) config.openclaw.token = envToken
  if (envAgent) config.openclaw.agent = envAgent
  if (envSystemPrompt) config.openclaw.systemPrompt = envSystemPrompt
  if (envThinking) config.openclaw.thinking = envThinking as any
  
  // TTS 配置
  const envTtsApiKey = getEnvValue('VITE_TTS_API_KEY')
  const envTtsEndpoint = getEnvValue('VITE_TTS_ENDPOINT')
  const envTtsVoice = getEnvValue('VITE_TTS_VOICE')
  
  if (envTtsApiKey || envTtsEndpoint || envTtsVoice) {
    config.tts = {
      ...config.tts,
      ...(envTtsApiKey && { apiKey: envTtsApiKey }),
      ...(envTtsEndpoint && { endpoint: envTtsEndpoint }),
      ...(envTtsVoice && { voice: envTtsVoice }),
    }
  }
  
  return config
}

// 同步获取配置（确保已加载）
export function getConfig(): AppConfig {
  if (!config) {
    throw new Error('[Config] Config not loaded. Call loadConfig() first.')
  }
  return config
}

export { loadConfig }
export default getConfig
