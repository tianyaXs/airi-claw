// 流式 TTS 管理器 - 预合成模式
interface QueuedItem {
  text: string
  audioUrl?: string
  isSynthesized: boolean
  isSynthesizing: boolean
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
  
  // 长度控制
  private readonly MIN_LENGTH = 60
  private readonly TARGET_LENGTH = 150
  private readonly MAX_LENGTH = 250

  constructor(apiKey: string, endpoint: string, voice: string) {
    this.apiKey = apiKey
    this.endpoint = endpoint
    this.voice = voice
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

  // 添加增量内容
  addText(deltaText: string) {
    if (!this.enabled || !deltaText) {
      return
    }

    this.buffer += deltaText
    console.log('[StreamingTTS] 缓冲区:', this.buffer.length, '字符')

    this.checkAndCut()
  }

  // 检查并切分
  private checkAndCut() {
    if (this.buffer.length < this.MIN_LENGTH) {
      return
    }

    const cutIndex = this.findBestCutPoint()

    if (cutIndex > 0) {
      const text = this.buffer.slice(0, cutIndex).trim()
      this.buffer = this.buffer.slice(cutIndex).trimStart()

      if (text) {
        console.log('[StreamingTTS] 切分:', text.length, '字')
        
        // 添加到队列
        this.playQueue.push({
          text: this.cleanForTTS(text),
          isSynthesized: false,
          isSynthesizing: false
        })

        // 如果正在播放，开始预合成下一个
        if (this.isPlaying) {
          this.preSynthesizeNext()
        } else {
          // 没有播放，直接开始播放
          this.tryPlayNext()
        }

        // 继续检查是否还能切分
        setTimeout(() => this.checkAndCut(), 0)
      }
    }
  }

  // 寻找最佳切分点
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

  // 清理文本
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

  // 预合成队列中的下一个
  private async preSynthesizeNext() {
    // 找到第一个未合成且未在合成中的项
    const item = this.playQueue.find(i => !i.isSynthesized && !i.isSynthesizing)
    if (!item) return

    item.isSynthesizing = true
    console.log('[StreamingTTS] 预合成:', item.text.substring(0, 30) + '...')

    try {
      const result = await window.electron.ipcRenderer.invoke(
        'tts:synthesize',
        item.text,
        this.apiKey,
        this.endpoint,
        this.voice
      )

      if (result.success) {
        const data = result.data
        item.audioUrl = data.output?.audio?.url || data.output?.wav
        item.isSynthesized = true
        console.log('[StreamingTTS] 预合成完成')
      }
    } catch (error) {
      console.error('[StreamingTTS] 预合成失败:', error)
    } finally {
      item.isSynthesizing = false
    }
  }

  // 尝试播放下一个
  private tryPlayNext() {
    if (this.isPlaying || this.playQueue.length === 0) return
    this.playNext()
  }

  // 播放下一个
  private async playNext() {
    if (this.isPlaying || this.playQueue.length === 0) return

    const item = this.playQueue[0]
    if (!item.text.trim()) {
      this.playQueue.shift()
      this.tryPlayNext()
      return
    }

    this.isPlaying = true
    console.log('[StreamingTTS] 播放:', item.text.substring(0, 40) + '...')

    // 开始预合成下一个（在后台）
    this.preSynthesizeNext()

    try {
      // 如果还没合成，等待合成完成
      if (!item.isSynthesized) {
        console.log('[StreamingTTS] 等待合成...')
        item.isSynthesizing = true
        
        const result = await window.electron.ipcRenderer.invoke(
          'tts:synthesize',
          item.text,
          this.apiKey,
          this.endpoint,
          this.voice
        )

        item.isSynthesizing = false
        
        if (!result.success) {
          throw new Error(result.error || 'TTS 合成失败')
        }

        const data = result.data
        item.audioUrl = data.output?.audio?.url || data.output?.wav
        item.isSynthesized = true
      }

      // 播放音频
      if (item.audioUrl) {
        await this.playAudio(item.audioUrl)
      }

      console.log('[StreamingTTS] 播放完成')
    } catch (error) {
      console.error('[StreamingTTS] 播放失败:', error)
    } finally {
      this.isPlaying = false
      this.currentAudio = null
      this.playQueue.shift() // 移除已播放的

      // 继续播放下一个（应该已经预合成好了）
      if (this.playQueue.length > 0) {
        setTimeout(() => this.tryPlayNext(), 10)
      }
    }
  }

  // 播放音频
  private playAudio(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url)
      this.currentAudio = audio

      const cleanup = () => {
        audio.onended = null
        audio.onerror = null
        this.currentAudio = null
      }

      audio.onended = () => {
        cleanup()
        resolve()
      }

      audio.onerror = () => {
        cleanup()
        reject(new Error('播放失败'))
      }

      audio.play().catch((err) => {
        cleanup()
        reject(err)
      })
    })
  }

  // 完成
  finish() {
    if (!this.enabled) return

    // 切分剩余内容
    if (this.buffer.trim()) {
      this.playQueue.push({
        text: this.cleanForTTS(this.buffer),
        isSynthesized: false,
        isSynthesizing: false
      })
      this.buffer = ''
    }

    // 如果没有在播放，开始播放
    if (!this.isPlaying && this.playQueue.length > 0) {
      this.tryPlayNext()
    }
  }

  // 重置
  reset() {
    console.log('[StreamingTTS] 重置状态')
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio = null
    }
    this.buffer = ''
    this.playQueue = []
    this.isPlaying = false
  }
}

export default StreamingTTS
