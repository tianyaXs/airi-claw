import { ipcMain, app } from 'electron'
import WebSocket from 'ws'
import nacl from 'tweetnacl'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import crypto from 'node:crypto'

// 使用文件存储而不是 electron-store
const getStorePath = () => join(app.getPath('userData'), 'device-keys.json')

const store = {
  get: (key: string) => {
    try {
      const path = getStorePath()
      if (!existsSync(path)) return undefined
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      return data[key]
    } catch (err) {
      console.error('[Store] Failed to read:', err)
      return undefined
    }
  },
  set: (key: string, value: any) => {
    try {
      const path = getStorePath()
      let data: any = {}
      if (existsSync(path)) {
        data = JSON.parse(readFileSync(path, 'utf-8'))
      }
      data[key] = value
      writeFileSync(path, JSON.stringify(data, null, 2))
    } catch (err) {
      console.error('[Store] Failed to write:', err)
    }
  }
}

interface OpenClawConfig {
  url: string
  token?: string
  agent?: string
}

interface PairingRequest {
  requestId: string
  deviceId: string
  reason: string
}

// Base64URL 编码
function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = Buffer.from(buffer).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Base64URL 解码
function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, 'base64')
}

// 计算 deviceId：与 OpenClaw 网关一致，对公钥原始 32 字节做 SHA-256 的 hex
// 必须只哈希公钥的 32 字节，不能使用 publicKeyRaw.buffer（可能是更大 ArrayBuffer 的视图）
function computeDeviceId(publicKeyRaw: Uint8Array): string {
  const buf = Buffer.from(publicKeyRaw.subarray(0, 32))
  return crypto.createHash('sha256').update(buf).digest('hex')
}

class OpenClawService {
  private ws: WebSocket | null = null
  private config: OpenClawConfig
  private isConnected = false
  private messageQueue: any[] = []
  private pendingConnectId: string | null = null
  private privateKey: Uint8Array
  private publicKey: Uint8Array
  private deviceId: string = ''
  private serverNonce: string | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private shouldStopReconnect = false
  private maxReconnectAttempts = 5
  private window: Electron.BrowserWindow | null = null

  constructor(config: OpenClawConfig) {
    this.config = {
      url: config.url || 'ws://127.0.0.1:18789',
      token: config.token || '',
      agent: config.agent || 'main',
    }
    
    // 获取或创建设备密钥对
    const keys = this.getOrCreateDeviceKeys()
    this.privateKey = keys.privateKey
    this.publicKey = keys.publicKey

    this.setupIPC()
  }

  setWindow(window: Electron.BrowserWindow) {
    this.window = window
    
    // 应用启动时显示设备 ID
    const deviceId = this.deviceId || 'loading...'
    console.log('%c========================================', 'color: #667eea; font-size: 14px; font-weight: bold;')
    console.log('%c📱 AIRI Claw 设备信息', 'color: #667eea; font-size: 14px; font-weight: bold;')
    console.log('%c设备 ID: ' + deviceId, 'color: #667eea; font-size: 13px;')
    console.log('%c========================================', 'color: #667eea; font-size: 14px; font-weight: bold;')
  }

  private setupIPC() {
    // 发送消息
    ipcMain.handle('openclaw:send', async (_event, content: string, extraSystemPrompt?: string, thinking?: string) => {
      try {
        await this.sendMessage(content, extraSystemPrompt, thinking)
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    })

    // 连接状态
    ipcMain.handle('openclaw:is-connected', () => {
      return this.isConnected
    })

    // 手动连接（可传入渲染进程的 url/token，以使用界面或 localStorage 中的最新配置）
    ipcMain.handle('openclaw:connect', async (_event, options?: { url?: string; token?: string; agent?: string }) => {
      try {
        if (options) {
          if (options.url !== undefined) this.config.url = options.url
          if (options.token !== undefined) this.config.token = options.token
          if (options.agent !== undefined) this.config.agent = options.agent
        }
        await this.connect()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message, deviceId: this.deviceId }
      }
    })

    // 断开连接
    ipcMain.handle('openclaw:disconnect', () => {
      this.disconnect()
      return { success: true }
    })

    // 重置设备密钥（清除本地密钥并重新生成，用于解决设备身份不匹配后的恢复）
    ipcMain.handle('openclaw:reset-device-keys', () => {
      try {
        this.resetDeviceKeys()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error?.message }
      }
    })
  }

  private getOrCreateDeviceKeys(): { privateKey: Uint8Array; publicKey: Uint8Array } {
    const storageKey = 'device_keys'
    const stored = store.get(storageKey) as { privateKey: string; publicKey: string } | undefined
    
    if (stored) {
      try {
        console.log('[OpenClaw] Loading existing device keys from store')
        return {
          privateKey: base64UrlDecode(stored.privateKey),
          publicKey: base64UrlDecode(stored.publicKey)
        }
      } catch (err) {
        console.warn('[OpenClaw] Failed to load stored keys, generating new ones:', err)
      }
    }
    
    // 生成新的 Ed25519 密钥对
    console.log('[OpenClaw] Generating new device keys')
    const keyPair = nacl.sign.keyPair()
    const keys = { privateKey: keyPair.secretKey, publicKey: keyPair.publicKey }
    
    // 持久化到 electron-store
    store.set(storageKey, {
      privateKey: base64UrlEncode(keys.privateKey),
      publicKey: base64UrlEncode(keys.publicKey)
    })
    
    return keys
  }

  /** 重置设备密钥：清除存储并重新生成，用于设备身份不匹配后恢复（需在网关侧执行 openclaw devices remove <deviceId> 后使用） */
  resetDeviceKeys(): void {
    this.disconnect()
    this.shouldStopReconnect = false
    const storageKey = 'device_keys'
    const path = getStorePath()
    try {
      if (existsSync(path)) {
        const data = JSON.parse(readFileSync(path, 'utf-8'))
        delete data[storageKey]
        writeFileSync(path, JSON.stringify(data, null, 2))
      }
    } catch (err) {
      console.warn('[OpenClaw] Failed to clear store:', err)
    }
    const keyPair = nacl.sign.keyPair()
    this.privateKey = keyPair.secretKey
    this.publicKey = keyPair.publicKey
    this.deviceId = computeDeviceId(this.publicKey)
    store.set(storageKey, {
      privateKey: base64UrlEncode(this.privateKey),
      publicKey: base64UrlEncode(this.publicKey)
    })
    console.log('[OpenClaw] Device keys reset, new deviceId:', this.deviceId)
  }

  private signData(privateKey: Uint8Array, data: string): string {
    const encoder = new TextEncoder()
    const signature = nacl.sign.detached(encoder.encode(data), privateKey)
    return base64UrlEncode(signature)
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  async connect(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        console.log('[OpenClaw] Connecting to:', this.config.url)
        
        this.ws = new WebSocket(this.config.url)

        this.ws.on('open', () => {
          console.log('[OpenClaw] WebSocket connected')
        })

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data.toString(), resolve, reject)
        })

        this.ws.on('close', () => {
          console.log('[OpenClaw] WebSocket closed')
          this.isConnected = false
          this.pendingConnectId = null
          this.window?.webContents.send('openclaw:disconnected')
          this.scheduleReconnect()
        })

        this.ws.on('error', (error) => {
          console.error('[OpenClaw] WebSocket error:', error)
          this.window?.webContents.send('openclaw:error', { message: error.message })
          reject(new Error('WebSocket error: ' + error.message))
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  private async handleMessage(data: string, resolve: () => void, reject: (err: Error) => void) {
    try {
      const msg = JSON.parse(data)
      console.log('[OpenClaw] Received:', msg.type, msg.event || msg.method, 'id:', msg.id)

      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        console.log('[OpenClaw] Received challenge, preparing device auth...')
        this.serverNonce = msg.payload?.nonce
        
        try {
          const publicKeyBase64Url = base64UrlEncode(this.publicKey)
          const deviceId = computeDeviceId(this.publicKey)
          this.deviceId = deviceId
          console.log('[OpenClaw] Device fingerprint:', deviceId)
          
          const signedAt = Date.now()
          const clientNonce = this.serverNonce || ''
          const scopes = ['operator.read', 'operator.write'].join(',')
          const token = this.config.token || ''
          
          const payloadToSign = [
            'v2',
            deviceId,
            'cli',
            'cli',
            'operator',
            scopes,
            String(signedAt),
            token,
            clientNonce,
          ].join('|')
          
          console.log('[OpenClaw] Signing payload:', payloadToSign)
          const signature = this.signData(this.privateKey, payloadToSign)
          
          const connectId = this.generateId()
          this.pendingConnectId = connectId
          
          const connectRequest = {
            type: 'req',
            id: connectId,
            method: 'connect',
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: 'cli',
                version: '1.0.0',
                platform: 'electron',
                mode: 'cli',
              },
              role: 'operator',
              scopes: ['operator.read', 'operator.write'],
              caps: [],
              commands: [],
              permissions: {},
              auth: this.config.token ? { token: this.config.token } : {},
              locale: 'zh-CN',
              userAgent: 'airi-claw/1.0.0',
              device: {
                id: deviceId,
                publicKey: publicKeyBase64Url,
                signature: signature,
                signedAt: signedAt,
                nonce: clientNonce,
              },
            },
          }
          
          console.log('[OpenClaw] Sending connect request with device auth, id:', connectId)
          this.ws?.send(JSON.stringify(connectRequest))
        } catch (err) {
          console.error('[OpenClaw] Failed to prepare device auth:', err)
          reject(err as Error)
        }
        return
      }

       if (msg.type === 'res' && msg.id === this.pendingConnectId) {
         this.pendingConnectId = null
         if (msg.ok) {
           console.log('[OpenClaw] Handshake successful')
           this.isConnected = true
           this.reconnectAttempts = 0
           this.window?.webContents.send('openclaw:connected')
           this.flushMessageQueue()
           resolve()
         } else {
           console.error('[OpenClaw] Handshake failed:', msg.error)
           if (msg.error?.code === 'NOT_PAIRED') {
             const requestId = msg.error?.details?.requestId
             const reason = msg.error?.details?.reason || 'not-paired'
             console.log('[OpenClaw] NOT_PAIRED error, requestId:', requestId)
             
             // 在控制台显示绑定命令
             console.log('%c========================================', 'color: #667eea; font-size: 14px; font-weight: bold;')
             console.log('%c🔐 设备需要配对，请复制以下命令到终端运行：', 'color: #667eea; font-size: 14px; font-weight: bold;')
             console.log('%copenclaw devices approve ' + requestId, 'color: #4caf50; font-size: 16px; font-weight: bold; background: #f0f0f0; padding: 8px; border-radius: 4px;')
             console.log('%c========================================', 'color: #667eea; font-size: 14px; font-weight: bold;')
             
             this.window?.webContents.send('openclaw:pairing-required', {
               requestId,
               deviceId: this.deviceId,
               reason,
             })
             reject(new Error(`设备需要配对，请在终端运行: openclaw devices approve ${requestId}`))
            } else if (msg.error?.code === 'DEVICE_IDENTITY_MISMATCH' || msg.error?.details?.code === 'DEVICE_AUTH_DEVICE_ID_MISMATCH' || (msg.error?.message || '').includes('device identity mismatch')) {
              // 设备身份不匹配 - 停止重连，提示用户操作
              this.shouldStopReconnect = true
              console.log('%c========================================', 'color: #ff9800; font-size: 14px; font-weight: bold;')
              console.log('%c⚠️  设备身份不匹配', 'color: #ff9800; font-size: 14px; font-weight: bold;')
              console.log('%c请依次在终端运行以下命令：', 'color: #ff9800; font-size: 13px;')
              console.log('%c1. openclaw devices remove ' + this.deviceId, 'color: #4caf50; font-size: 16px; font-weight: bold; background: #f0f0f0; padding: 8px;')
              console.log('%c2. 重启应用后，运行 openclaw devices approve <requestId>', 'color: #4caf50; font-size: 14px;')
              console.log('%c========================================', 'color: #ff9800; font-size: 14px; font-weight: bold;')
              
              this.window?.webContents.send('openclaw:device-mismatch', {
                deviceId: this.deviceId
              })
              reject(new Error(msg.error?.message || 'Device identity mismatch'))
           } else {
             reject(new Error(msg.error?.message || 'Handshake failed'))
           }
         }
         return
       }

      if (msg.type === 'event') {
        this.handleEvent(msg)
        return
      }

      if (msg.type === 'res') {
        this.window?.webContents.send('openclaw:response', msg)
      }
    } catch (error) {
      console.error('[OpenClaw] Failed to parse message:', error)
    }
  }

  private handleEvent(event: any) {
    console.log('[OpenClaw] Handling event:', event.event)
    
    switch (event.event) {
      case 'agent.message':
        if (event.payload?.message) {
          this.window?.webContents.send('openclaw:message', {
            id: event.payload.message.id || this.generateId(),
            role: event.payload.message.role || 'assistant',
            content: event.payload.message.content || '',
            timestamp: Date.now(),
            streaming: event.payload.streaming || false,
          })
        }
        break

      case 'agent.chunk':
        if (event.payload?.chunk) {
          this.window?.webContents.send('openclaw:chunk', {
            content: event.payload.chunk,
            streaming: true,
          })
        }
        break

      case 'agent.complete':
        this.window?.webContents.send('openclaw:complete', {
          id: event.payload?.messageId,
        })
        break

      case 'agent.typing':
        this.window?.webContents.send('openclaw:typing', event.payload)
        break

      case 'agent.error':
        this.window?.webContents.send('openclaw:error', {
          message: event.payload?.error || 'Unknown error',
        })
        break

      case 'chat':
        if (event.payload?.message) {
          const msg = event.payload.message
          let content = ''
          
          if (Array.isArray(msg.content)) {
            content = msg.content
              .filter((item: any) => item.type === 'text' || typeof item.text === 'string')
              .map((item: any) => item.text || '')
              .join('')
          } else if (typeof msg.content === 'string') {
            content = msg.content
          }
          
          const message = {
            id: this.generateId(),
            role: msg.role || 'assistant',
            content: content,
            timestamp: msg.timestamp || Date.now(),
            streaming: event.payload.state === 'delta',
          }
          
          if (event.payload.state === 'final') {
            this.window?.webContents.send('openclaw:message', message)
          } else if (event.payload.state === 'delta') {
            this.window?.webContents.send('openclaw:chunk', {
              content: content,
              streaming: true,
            })
          }
        }
        break
    }
  }

  async sendMessage(content: string, extraSystemPrompt?: string, thinking?: string): Promise<void> {
    if (!this.isConnected) {
      console.log('[OpenClaw] Not connected, attempting to reconnect before sending...')
      try {
        await this.connect()
      } catch (err: any) {
        console.error('[OpenClaw] Failed to reconnect:', err)
        throw err
      }
    }

    const params: any = {
      message: content,
      agentId: this.config.agent,
      idempotencyKey: `idem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    }

    if (extraSystemPrompt) {
      params.extraSystemPrompt = extraSystemPrompt
    }

    if (thinking) {
      params.thinking = thinking
    }

    const request = {
      type: 'req',
      id: this.generateId(),
      method: 'agent',
      params,
    }

    console.log('[OpenClaw] Sending message:', request)
    this.send(request)
  }

  private send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    } else {
      console.warn('[OpenClaw] WebSocket not open, message dropped')
    }
  }

  private flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()
      this.send(msg)
    }
  }

  private scheduleReconnect() {
    if (this.shouldStopReconnect) {
      console.log('[OpenClaw] Reconnect stopped due to device identity mismatch')
      return
    }
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[OpenClaw] Max reconnect attempts reached')
      return
    }

    this.reconnectAttempts++
    console.log(`[OpenClaw] Reconnecting in 5000ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[OpenClaw] Reconnect failed:', error)
      })
    }, 5000)
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.isConnected = false
    this.messageQueue = []
    this.pendingConnectId = null
  }
}

let openClawService: OpenClawService | null = null

export function initOpenClawService(config: OpenClawConfig, window: Electron.BrowserWindow) {
  if (!openClawService) {
    openClawService = new OpenClawService(config)
    openClawService.setWindow(window)
    openClawService.connect().catch((err) => {
      console.error('[OpenClaw] Initial connection failed:', err)
    })
  }
  return openClawService
}

export function getOpenClawService() {
  return openClawService
}
