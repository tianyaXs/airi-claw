let config: any = null

export interface AppConfig {
  name: string
  version: string
  description: string
  openclaw: {
    url: string
    token: string
    agent: string
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
        modelPath: '/assets/live2d/models/hiyori/Hiyori.model3.json'
      },
      window: {
        width: 400,
        height: 700
      }
    }
  }
  
  // 从环境变量覆盖
  const envUrl = getEnvValue('VITE_OPENCLAW_URL')
  const envToken = getEnvValue('VITE_OPENCLAW_TOKEN')
  const envAgent = getEnvValue('VITE_OPENCLAW_AGENT')
  
  if (envUrl) config.openclaw.url = envUrl
  if (envToken) config.openclaw.token = envToken
  if (envAgent) config.openclaw.agent = envAgent
  
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
