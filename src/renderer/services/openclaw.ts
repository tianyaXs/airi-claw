export interface OpenClawMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  streaming?: boolean
}

export interface PairingRequest {
  requestId: string
  deviceId: string
  reason: string
}

type EventCallback = (...args: any[]) => void

class SimpleEventEmitter {
  private listeners: Map<string, EventCallback[]> = new Map()

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event)!.push(callback)
  }

  off(event: string, callback: EventCallback): void {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      const index = callbacks.indexOf(callback)
      if (index > -1) {
        callbacks.splice(index, 1)
      }
    }
  }

  emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(...args)
        } catch (error) {
          console.error(`[EventEmitter] Error in ${event} listener:`, error)
        }
      })
    }
  }

  once(event: string, callback: EventCallback): void {
    const onceCallback = (...args: any[]) => {
      this.off(event, onceCallback)
      callback(...args)
    }
    this.on(event, onceCallback)
  }
}

export interface OpenClawConfig {
  url: string
  token?: string
  agent?: string
  autoReconnect?: boolean
  reconnectInterval?: number
  systemPrompt?: string
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
}

export class OpenClawClient extends SimpleEventEmitter {
  private config: OpenClawConfig
  private isConnected = false
  private messageBuffer = ''
  private cleanupFunctions: (() => void)[] = []

  constructor(config: OpenClawConfig) {
    super()
    this.config = {
      url: config.url || 'ws://127.0.0.1:18789',
      token: config.token || '',
      agent: config.agent || 'main',
      autoReconnect: config.autoReconnect !== false,
      reconnectInterval: config.reconnectInterval || 3000,
      systemPrompt: config.systemPrompt || '',
      thinking: config.thinking,
    }
    
    this.setupIPCListeners()
  }

  private setupIPCListeners() {
    // 监听来自主进程的事件
    const connectedCleanup = window.electron.ipcRenderer.on('openclaw:connected', () => {
      console.log('[OpenClaw] Connected via IPC')
      this.isConnected = true
      this.emit('connected')
    })

    const disconnectedCleanup = window.electron.ipcRenderer.on('openclaw:disconnected', () => {
      console.log('[OpenClaw] Disconnected via IPC')
      this.isConnected = false
      this.emit('disconnected')
    })

    const messageCleanup = window.electron.ipcRenderer.on('openclaw:message', (message: OpenClawMessage) => {
      console.log('[OpenClaw] Message received:', message)
      this.emit('message', message)
    })

    const chunkCleanup = window.electron.ipcRenderer.on('openclaw:chunk', (data: { content: string, streaming?: boolean }) => {
      this.messageBuffer += data.content
      this.emit('chunk', {
        content: data.content,
        fullContent: this.messageBuffer,
        streaming: data.streaming || true,
      })
    })

    const completeCleanup = window.electron.ipcRenderer.on('openclaw:complete', (data: { id?: string }) => {
      this.emit('complete', { content: this.messageBuffer, id: data.id })
      this.messageBuffer = ''
    })

    const typingCleanup = window.electron.ipcRenderer.on('openclaw:typing', (payload: any) => {
      this.emit('typing', payload)
    })

    const errorCleanup = window.electron.ipcRenderer.on('openclaw:error', (data: { message: string }) => {
      console.error('[OpenClaw] Error:', data.message)
      this.emit('error', new Error(data.message))
    })

    const pairingRequiredCleanup = window.electron.ipcRenderer.on('openclaw:pairing-required', (data: PairingRequest) => {
      console.log('[OpenClaw] Pairing required:', data)
      this.emit('pairingRequired', data)
    })

    const deviceMismatchCleanup = window.electron.ipcRenderer.on('openclaw:device-mismatch', (data: { deviceId: string }) => {
      console.log('[OpenClaw] Device mismatch:', data)
      this.emit('deviceMismatch', data)
    })

    const responseCleanup = window.electron.ipcRenderer.on('openclaw:response', (msg: any) => {
      this.emit('response', msg)
    })

    // 保存清理函数
    this.cleanupFunctions = [
      connectedCleanup,
      disconnectedCleanup,
      messageCleanup,
      chunkCleanup,
      completeCleanup,
      typingCleanup,
      errorCleanup,
      pairingRequiredCleanup,
      deviceMismatchCleanup,
      responseCleanup
    ]
  }

  async connect(): Promise<void> {
    console.log('[OpenClaw] Connecting via IPC...')
    const result = await window.electron.ipcRenderer.invoke('openclaw:connect', {
      url: this.config.url,
      token: this.config.token,
      agent: this.config.agent,
    })
    if (!result.success) {
      const err = new Error(result.error || 'Failed to connect') as any
      err.deviceId = result.deviceId
      throw err
    }
  }

  async sendMessage(content: string): Promise<void> {
    if (!this.isConnected) {
      console.log('[OpenClaw] Not connected, attempting to reconnect...')
      await this.connect()
    }

    const result = await window.electron.ipcRenderer.invoke(
      'openclaw:send',
      content,
      this.config.systemPrompt,
      this.config.thinking
    )

    if (!result.success) {
      throw new Error(result.error || 'Failed to send message')
    }
  }

  disconnect(): void {
    window.electron.ipcRenderer.invoke('openclaw:disconnect')
    this.isConnected = false
    
    // 清理 IPC 监听器
    this.cleanupFunctions.forEach(cleanup => cleanup())
    this.cleanupFunctions = []
  }

  /** 重置设备密钥（清除主进程存储并重新生成），用于设备身份不匹配后恢复 */
  async resetDeviceKeys(): Promise<{ success: boolean; error?: string }> {
    const result = await window.electron.ipcRenderer.invoke('openclaw:reset-device-keys')
    return { success: result?.success === true, error: result?.error }
  }

  isReady(): boolean {
    return this.isConnected
  }
}
