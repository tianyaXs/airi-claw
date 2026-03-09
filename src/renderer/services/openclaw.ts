import nacl from 'tweetnacl'

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

export interface OpenClawConfig {
  url: string
  token?: string
  agent?: string
  autoReconnect?: boolean
  reconnectInterval?: number
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

// Base64URL 编码
function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Base64URL 解码
function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return new Uint8Array(atob(padded).split('').map(c => c.charCodeAt(0)))
}

export class OpenClawClient extends SimpleEventEmitter {
  private ws: WebSocket | null = null
  private config: Required<OpenClawConfig>
  private messageQueue: any[] = []
  private isConnected = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private currentMessageId: string | null = null
  private messageBuffer = ''
  private deviceId: string = ''
  private privateKey: Uint8Array
  private publicKey: Uint8Array
  private serverNonce: string | null = null
  private pendingConnectId: string | null = null
  private connectResolve: (() => void) | null = null
  private connectReject: ((err: Error) => void) | null = null

  constructor(config: OpenClawConfig) {
    super()
    this.config = {
      url: config.url || 'ws://127.0.0.1:18789',
      token: config.token || '',
      agent: config.agent || 'main',
      autoReconnect: config.autoReconnect !== false,
      reconnectInterval: config.reconnectInterval || 3000,
    }
    // 获取或创建设备密钥对（持久化）
    const keys = this.getOrCreateDeviceKeys()
    this.privateKey = keys.privateKey
    this.publicKey = keys.publicKey
  }

  // 从 localStorage 获取或创建设备密钥对
  private getOrCreateDeviceKeys(): { privateKey: Uint8Array; publicKey: Uint8Array } {
    const storageKey = 'airi_claw_device_keys'
    const stored = localStorage.getItem(storageKey)
    
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        return {
          privateKey: base64UrlDecode(parsed.privateKey),
          publicKey: base64UrlDecode(parsed.publicKey)
        }
      } catch (err) {
        console.warn('[OpenClaw] Failed to parse stored device keys, generating new ones')
      }
    }
    
    // 生成新的 Ed25519 密钥对
    const keyPair = nacl.sign.keyPair()
    const keys = { privateKey: keyPair.secretKey, publicKey: keyPair.publicKey }
    
    // 持久化到 localStorage
    localStorage.setItem(storageKey, JSON.stringify({
      privateKey: base64UrlEncode(keys.privateKey),
      publicKey: base64UrlEncode(keys.publicKey)
    }))
    
    return keys
  }

  private async computeFingerprint(publicKeyRaw: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', publicKeyRaw.buffer as ArrayBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private signData(privateKey: Uint8Array, data: string): string {
    const encoder = new TextEncoder()
    // tweetnacl 的 sign 需要 64 字节密钥（私钥+公钥）
    const signature = nacl.sign.detached(encoder.encode(data), privateKey)
    return base64UrlEncode(signature)
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('[OpenClaw] Connecting to:', this.config.url)
        this.ws = new WebSocket(this.config.url)
        this.connectResolve = resolve
        this.connectReject = reject

        this.ws.onopen = () => {
          console.log('[OpenClaw] WebSocket connected')
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data)
        }

        this.ws.onclose = () => {
          console.log('[OpenClaw] WebSocket closed')
          this.isConnected = false
          this.pendingConnectId = null
          this.emit('disconnected')
          if (this.config.autoReconnect) {
            this.scheduleReconnect()
          }
        }

        this.ws.onerror = (error) => {
          console.error('[OpenClaw] WebSocket error:', error)
          this.emit('error', error)
          this.connectReject?.(new Error('WebSocket error'))
          this.connectReject = null
          this.connectResolve = null
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  private async handleMessage(data: string) {
    try {
      const msg = JSON.parse(data)
      console.log('[OpenClaw] Received:', msg.type, msg.event || msg.method, 'id:', msg.id)

      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        console.log('[OpenClaw] Received challenge, preparing device auth...')
        this.serverNonce = msg.payload?.nonce
        
        try {
          // 使用持久化的 Ed25519 密钥对
          const publicKeyBase64Url = base64UrlEncode(this.publicKey)
          
          // 计算 deviceId (公钥 fingerprint)
          const deviceId = await this.computeFingerprint(this.publicKey)
          this.deviceId = deviceId
          console.log('[OpenClaw] Device fingerprint:', deviceId)
          
          // v2 签名 payload (OpenClaw 只支持 v1/v2，不支持 v3)
          const signedAt = Date.now()
          const clientNonce = this.serverNonce || ''
          const scopes = ['operator.read', 'operator.write'].join(',')
          // 使用配置的 token 或空字符串
          const token = this.config.token || ''
          
          const payloadToSign = [
            'v2',
            deviceId,
            'cli',           // clientId
            'cli',           // clientMode
            'operator',      // role
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
                publicKey: publicKeyBase64Url,  // raw public key in base64url
                signature: signature,            // base64url encoded signature
                signedAt: signedAt,
                nonce: clientNonce,
              },
            },
          }
          
          console.log('[OpenClaw] Sending connect request with device auth, id:', connectId)
          this.ws?.send(JSON.stringify(connectRequest))
        } catch (err) {
          console.error('[OpenClaw] Failed to prepare device auth:', err)
          this.connectReject?.(err as Error)
          this.connectReject = null
          this.connectResolve = null
        }
        return
      }

      if (msg.type === 'res' && msg.id === this.pendingConnectId) {
        this.pendingConnectId = null
        if (msg.ok) {
          console.log('[OpenClaw] Handshake successful')
          this.isConnected = true
          this.reconnectAttempts = 0
          this.emit('connected')
          this.flushMessageQueue()
          this.connectResolve?.()
        } else {
          console.error('[OpenClaw] Handshake failed:', msg.error)
          // 处理配对错误
          if (msg.error?.code === 'NOT_PAIRED') {
            const requestId = msg.error?.details?.requestId
            const reason = msg.error?.details?.reason || 'not-paired'
            this.emit('pairingRequired', {
              requestId,
              deviceId: this.deviceId,
              reason,
            } as PairingRequest)
            // 配对失败时停止自动重连，但下次手动发送消息时会重新尝试
            this.connectReject?.(new Error(`设备需要配对，请在终端运行: openclaw devices approve ${requestId}`))
          } else {
            this.connectReject?.(new Error(msg.error?.message || 'Handshake failed'))
          }
        }
        this.connectResolve = null
        this.connectReject = null
        return
      }

      if (msg.type === 'res') {
        console.log('[OpenClaw] Received response:', msg.method || 'unknown', 'ok:', msg.ok)
        if (msg.id === this.currentMessageId) {
          if (msg.ok) {
            console.log('[OpenClaw] Message sent successfully')
          } else {
            console.error('[OpenClaw] Message failed:', msg.error)
          }
          this.currentMessageId = null
        }
        this.emit('response', msg)
        return
      }

      if (msg.type === 'event') {
        this.handleEvent(msg)
        return
      }
    } catch (error) {
      console.error('[OpenClaw] Failed to parse message:', error)
    }
  }

  private handleEvent(event: any) {
    console.log('[OpenClaw] Handling event:', event.event, 'payload:', event.payload)
    switch (event.event) {
      case 'agent.message':
        console.log('[OpenClaw] agent.message received:', event.payload?.message)
        if (event.payload?.message) {
          const message: OpenClawMessage = {
            id: event.payload.message.id || this.generateId(),
            role: event.payload.message.role || 'assistant',
            content: event.payload.message.content || '',
            timestamp: Date.now(),
            streaming: event.payload.streaming || false,
          }
          console.log('[OpenClaw] Emitting message:', message)
          this.emit('message', message)
        }
        break

      case 'agent.chunk':
        if (event.payload?.chunk) {
          this.messageBuffer += event.payload.chunk
          this.emit('chunk', {
            content: event.payload.chunk,
            fullContent: this.messageBuffer,
            streaming: true,
          })
        }
        break

      case 'agent.complete':
        this.emit('complete', {
          content: this.messageBuffer,
          id: event.payload?.messageId,
        })
        this.messageBuffer = ''
        break

      case 'agent.typing':
        this.emit('typing', event.payload)
        break

      case 'agent.error':
        this.emit('error', new Error(event.payload?.error || 'Unknown error'))
        break

      case 'chat':
        if (event.payload?.message) {
          const msg = event.payload.message
          let content = ''
          
          // content 可能是数组或字符串
          if (Array.isArray(msg.content)) {
            // 提取数组中的文本内容
            content = msg.content
              .filter((item: any) => item.type === 'text' || typeof item.text === 'string')
              .map((item: any) => item.text || '')
              .join('')
          } else if (typeof msg.content === 'string') {
            content = msg.content
          }
          
          const message: OpenClawMessage = {
            id: this.generateId(),
            role: msg.role || 'assistant',
            content: content,
            timestamp: msg.timestamp || Date.now(),
            streaming: event.payload.state === 'delta',
          }
          
          if (event.payload.state === 'final') {
            console.log('[OpenClaw] Emitting final message:', message)
            this.emit('message', message)
          } else if (event.payload.state === 'delta') {
            // 流式更新
            this.messageBuffer = content
            this.emit('chunk', {
              content: content,
              fullContent: content,
              streaming: true,
            })
          }
        }
        break

      case 'system.presence':
        this.emit('presence', event.payload)
        break

      default:
        console.log('[OpenClaw] Unhandled event:', event.event)
    }
  }

  async sendMessage(content: string): Promise<void> {
    // 如果未连接，先尝试重连
    if (!this.isConnected) {
      console.log('[OpenClaw] Not connected, attempting to reconnect before sending...')
      // 临时启用自动重连（之前可能因为配对失败被禁用）
      const originalAutoReconnect = this.config.autoReconnect
      this.config.autoReconnect = true
      try {
        await this.connect()
        console.log('[OpenClaw] Reconnected successfully')
      } catch (err) {
        console.error('[OpenClaw] Failed to reconnect:', err)
        // 如果还是配对错误，恢复原设置
        this.config.autoReconnect = originalAutoReconnect
        // 重连失败，提示用户可能需要配对
        throw new Error('连接失败，请确保 OpenClaw Gateway 已启动并且设备已配对')
      }
    }

    const request = {
      type: 'req',
      id: this.generateId(),
      method: 'agent',
      params: {
        message: content,
        agentId: this.config.agent,
        idempotencyKey: `idem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      },
    }

    console.log('[OpenClaw] Sending message:', request)
    this.send(request)
    this.currentMessageId = request.id
  }

  private send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const json = JSON.stringify(data)
      console.log('[OpenClaw] WebSocket sending:', json.substring(0, 200))
      this.ws.send(json)
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
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[OpenClaw] Max reconnect attempts reached')
      this.emit('error', new Error('Max reconnect attempts reached'))
      return
    }

    this.reconnectAttempts++
    console.log(`[OpenClaw] Reconnecting in ${this.config.reconnectInterval}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        console.error('[OpenClaw] Reconnect failed:', error)
      })
    }, this.config.reconnectInterval)
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
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
    // 注意：privateKey 和 publicKey 现在是持久化的，不在这里清除
    this.pendingConnectId = null
    this.connectResolve = null
    this.connectResolve = null
    this.connectReject = null
  }

  isReady(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN
  }
}
