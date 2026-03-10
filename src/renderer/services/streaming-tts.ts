// 流式 TTS 管理器 - 支持真实口型同步和文字流式显示
import { LipSyncDriver } from './lip-sync-driver'

interface QueuedItem {
  text: string
  audioUrl?: string
  isSynthesized: boolean
  isSynthesizing: boolean
}

export interface StreamingTTSCallbacks {
  onLipSync?: (value: number) => void
  onTextDisplay?: (text: string, isNewChunk: boolean) => void
  onPlaybackStart?: () => void
  onPlaybackEnd?: () => void
}

export class StreamingTTS {
  private buffer = ''
  private isPlaying = false
  private playQueue: QueuedItem[] = []
  private apiKey: string
  private endpoint: string
  private voice: string
  private currentAudio: HTMLAudioElement | null = null
  private enabled = false
  private lipSyncDriver = new LipSyncDriver()
  private lipSyncUnsubscribe: (() => void) | null = null
  private callbacks: StreamingTTSCallbacks = {}
  private displayedText = ''
  private isProcessing = false  // 防止并发处理
  
  private readonly MIN_LENGTH = 60
  private readonly TARGET_LENGTH = 150
  private readonly MAX_LENGTH = 250

  constructor(apiKey: string, endpoint: string, voice: string) {
    this.apiKey = apiKey
    this.endpoint = endpoint
    this.voice = voice
  }

  setCallbacks(callbacks: StreamingTTSCallbacks) {
    this.callbacks = callbacks
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (!enabled) {
      this.reset()
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  addText(deltaText: string) {
    if (!this.enabled || !deltaText) return
    this.buffer += deltaText
    this.scheduleProcess()
  }

  // 调度处理，避免并发
  private scheduleProcess() {
    if (this.isProcessing) return
    this.isProcessing = true
    
    // 使用微任务确保在当前调用栈清空后处理
    Promise.resolve().then(() => {
      this.processBuffer()
      this.isProcessing = false
      
      // 如果 buffer 还有足够内容，继续处理
      if (this.buffer.length >= this.MIN_LENGTH) {
        this.scheduleProcess()
      }
    })
  }

  private processBuffer() {
    while (this.buffer.length >= this.MIN_LENGTH) {
      const cutIndex = this.findBestCutPoint()
      if (cutIndex <= 0) break

      const text = this.buffer.slice(0, cutIndex).trim()
      this.buffer = this.buffer.slice(cutIndex).trimStart()

      if (text) {
        console.log('[StreamingTTS] Queue chunk:', text.substring(0, 40))
        this.playQueue.push({
          text: this.cleanForTTS(text),
          isSynthesized: false,
          isSynthesizing: false
        })

        if (this.isPlaying) {
          this.preSynthesizeNext()
        } else {
          this.tryPlayNext()
        }
      }
    }
  }

  private findBestCutPoint(): number {
    const len = this.buffer.length
    if (len < this.MIN_LENGTH) return 0

    const searchEnd = Math.min(len, this.MAX_LENGTH)

    // 1. Markdown 标题
    const headerMatch = this.buffer.match(/\n#{1,3}\s+/g)
    if (headerMatch) {
      for (const match of headerMatch) {
        const idx = this.buffer.indexOf(match)
        if (idx >= this.TARGET_LENGTH && idx <= searchEnd) return idx
      }
    }

    // 2. 分隔线
    const separatorMatch = this.buffer.match(/\n---\s*\n/)
    if (separatorMatch) {
      const idx = this.buffer.indexOf(separatorMatch[0])
      if (idx >= this.MIN_LENGTH && idx <= searchEnd) {
        return idx + separatorMatch[0].length
      }
    }

    // 3. 空行
    const paragraphMatches = this.buffer.match(/\n\n+/g)
    if (paragraphMatches) {
      let lastIdx = 0
      for (const match of paragraphMatches) {
        const idx = this.buffer.indexOf(match, lastIdx)
        lastIdx = idx + 1
        if (idx >= this.TARGET_LENGTH && idx <= searchEnd) {
          return idx + match.length
        }
      }
    }

    // 4. 句子结束
    for (let i = Math.min(len, this.TARGET_LENGTH + 20); i >= this.MIN_LENGTH; i--) {
      if (/[。！？]/.test(this.buffer[i])) return i + 1
    }

    // 5. 逗号/分号
    for (let i = Math.min(len, this.TARGET_LENGTH); i >= this.MIN_LENGTH; i--) {
      if (/[，；]/.test(this.buffer[i])) return i + 1
    }

    // 6. 硬切
    if (len >= this.TARGET_LENGTH) return this.TARGET_LENGTH

    return 0
  }

  private cleanForTTS(text: string): string {
    return text
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\n---\s*\n/g, '\n')
      .replace(/\|[-:|\s]+\|/g, '')
      .replace(/\|/g, ' ')
      .replace(/\*\*?|\*\*?/g, '')
      .replace(/[\ud800-\udfff]/g, '')
      .replace(/[\u200b-\u200f\ufeff]/g, '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  private async preSynthesizeNext() {
    // 跳过正在播放的 item（playQueue[0]），只预合成后面的
    const item = this.playQueue.slice(1).find(i => !i.isSynthesized && !i.isSynthesizing)
    if (!item) return

    item.isSynthesizing = true
    console.log('[StreamingTTS] Pre-synth:', item.text.substring(0, 30))

    try {
      const result = await this.synthesize(item.text)
      if (result.success && result.url) {
        item.audioUrl = result.url
        item.isSynthesized = true
      }
    } catch (error) {
      console.error('[StreamingTTS] Pre-synth failed:', error)
    } finally {
      item.isSynthesizing = false
    }
  }

  private async synthesize(text: string): Promise<{success: boolean, url?: string}> {
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'tts:synthesize',
        text,
        this.apiKey,
        this.endpoint,
        this.voice
      )

      if (result.success) {
        const data = result.data
        // 尝试多种可能的 URL 格式
        const url = data.output?.audio?.url 
          || data.output?.wav 
          || data.output?.audio_url 
          || data.audio?.url 
          || data.wav 
          || data.url
        if (url) {
          console.log('[StreamingTTS] Got URL:', url.substring(0, 60) + '...')
          return { success: true, url }
        }
        console.warn('[StreamingTTS] No URL in response:', data)
      }
      return { success: false }
    } catch (error) {
      console.error('[StreamingTTS] Synth error:', error)
      return { success: false }
    }
  }

  private tryPlayNext() {
    if (this.isPlaying || this.playQueue.length === 0) return
    this.playNext()
  }

  private async playNext() {
    if (this.isPlaying || this.playQueue.length === 0) return

    const item = this.playQueue[0]
    if (!item.text.trim()) {
      this.playQueue.shift()
      this.tryPlayNext()
      return
    }

    this.isPlaying = true
    console.log('[StreamingTTS] Play:', item.text.substring(0, 40))

    // 预合成下一个（后台）
    this.preSynthesizeNext()

    try {
      if (!item.isSynthesized) {
        console.log('[StreamingTTS] Wait synth...')
        const result = await this.synthesize(item.text)
        if (!result.success || !result.url) {
          throw new Error('TTS failed')
        }
        item.audioUrl = result.url
        item.isSynthesized = true
      }

      if (item.audioUrl) {
        await this.playAudio(item.audioUrl, item.text)
      }
    } catch (error) {
      console.error('[StreamingTTS] Play failed:', error)
      // 失败后从队列移除，继续播放下一个
    } finally {
      this.isPlaying = false
      this.cleanupAudio()
      this.playQueue.shift()

      if (this.playQueue.length > 0) {
        setTimeout(() => this.tryPlayNext(), 10)
      } else {
        this.callbacks.onPlaybackEnd?.()
      }
    }
  }

  private playAudio(url: string, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio()
      // 设置跨域属性，允许 Web Audio API 分析
      audio.crossOrigin = 'anonymous'
      audio.src = url
      this.currentAudio = audio

      // 连接口型同步
      this.lipSyncDriver.connect(audio).then(() => {
        // 清理旧订阅
        if (this.lipSyncUnsubscribe) {
          this.lipSyncUnsubscribe()
        }
        // 订阅新的口型值
        this.lipSyncUnsubscribe = this.lipSyncDriver.onValueChange((value) => {
          this.callbacks.onLipSync?.(value)
        })
      }).catch(err => {
        console.warn('[StreamingTTS] Lip sync failed:', err)
      })

      audio.onplay = () => {
        this.callbacks.onPlaybackStart?.()
        this.displayedText += (this.displayedText ? ' ' : '') + text
        this.callbacks.onTextDisplay?.(this.displayedText, true)
      }

      audio.onended = () => {
        resolve()
      }

      audio.onerror = () => {
        reject(new Error('Playback error'))
      }

      audio.play().catch(reject)
    })
  }

  private cleanupAudio() {
    if (this.lipSyncUnsubscribe) {
      this.lipSyncUnsubscribe()
      this.lipSyncUnsubscribe = null
    }
    this.lipSyncDriver.disconnect()
    this.currentAudio = null
  }

  finish() {
    if (!this.enabled) return

    if (this.buffer.trim()) {
      this.playQueue.push({
        text: this.cleanForTTS(this.buffer),
        isSynthesized: false,
        isSynthesizing: false
      })
      this.buffer = ''
    }

    if (!this.isPlaying && this.playQueue.length > 0) {
      this.tryPlayNext()
    }
  }

  reset() {
    console.log('[StreamingTTS] Reset')
    if (this.currentAudio) {
      this.currentAudio.pause()
    }
    this.cleanupAudio()
    this.buffer = ''
    this.playQueue = []
    this.isPlaying = false
    this.isProcessing = false
    this.displayedText = ''
  }

  getDisplayedText(): string {
    return this.displayedText
  }

  clearDisplayedText() {
    this.displayedText = ''
  }
}

export default StreamingTTS
