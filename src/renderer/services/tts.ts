// TTS 服务 - 使用阿里云百炼 COSYVOICE 模型
// 通过 Electron IPC 调用主进程来绕过 CORS
export interface TTSConfig {
  apiKey: string
  endpoint?: string
  voice?: string
  enabled: boolean
}

class TTSService {
  private config: TTSConfig
  private audioContext: AudioContext | null = null
  private currentSource: AudioBufferSourceNode | null = null
  private isPlaying = false

  constructor(config: TTSConfig) {
    this.config = {
      endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      voice: 'Stella',
      apiKey: config.apiKey || '',
      enabled: config.enabled !== undefined ? config.enabled : false,
    }
    console.log('[TTS] 初始化配置:', { 
      endpoint: this.config.endpoint, 
      voice: this.config.voice,
      enabled: this.config.enabled,
      hasApiKey: !!this.config.apiKey 
    })
  }

  updateConfig(config: Partial<TTSConfig>) {
    this.config = { ...this.config, ...config }
  }

  getConfig(): TTSConfig {
    return { ...this.config }
  }

  setEnabled(enabled: boolean) {
    this.config.enabled = enabled
    if (!enabled) {
      this.stop()
    }
  }

  isEnabled(): boolean {
    return this.config.enabled
  }

  stop() {
    if (this.currentSource) {
      try {
        this.currentSource.stop()
      } catch (e) {}
      this.currentSource = null
    }
    this.isPlaying = false
  }

  async speak(text: string): Promise<void> {
    if (!this.config.enabled) {
      console.log('[TTS] 已禁用，跳过播放')
      return
    }

    if (!this.config.apiKey) {
      console.warn('[TTS] 未配置 API Key')
      return
    }

    this.stop()

    try {
      const cleanText = text.replace(/[\ud800-\udfff]/g, '').trim()
      if (!cleanText) {
        console.log('[TTS] 清理后文本为空，跳过')
        return
      }

      console.log('[TTS] 开始合成:', cleanText.substring(0, 50) + '...')

      // 使用 IPC 调用主进程
      const result = await window.electron.ipcRenderer.invoke(
        'tts:synthesize',
        cleanText,
        this.config.apiKey,
        this.config.endpoint,
        this.config.voice
      )

      if (!result.success) {
        throw new Error(result.error || 'TTS 合成失败')
      }

      const data = result.data
      console.log('[TTS] 合成成功')

      // 处理返回的音频数据
      if (data.output?.audio?.url) {
        await this.playAudioUrl(data.output.audio.url)
      } else if (data.output?.audio?.base64) {
        await this.playBase64Audio(data.output.audio.base64)
      } else if (data.output?.wav) {
        await this.playAudioUrl(data.output.wav)
      } else {
        console.error('[TTS] 响应格式不正确:', data)
      }
    } catch (error) {
      console.error('[TTS] 合成失败:', error)
    }
  }

  private async playAudioUrl(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url)
      
      audio.onended = () => {
        this.isPlaying = false
        resolve()
      }
      
      audio.onerror = (e) => {
        this.isPlaying = false
        reject(new Error('音频播放失败'))
      }
      
      this.isPlaying = true
      audio.play().catch(reject)
    })
  }

  private async playBase64Audio(base64Data: string): Promise<void> {
    try {
      const binaryString = atob(base64Data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      }

      const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer)

      this.currentSource = this.audioContext.createBufferSource()
      this.currentSource.buffer = audioBuffer
      this.currentSource.connect(this.audioContext.destination)

      this.isPlaying = true
      this.currentSource.start()

      this.currentSource.onended = () => {
        this.isPlaying = false
        this.currentSource = null
      }
    } catch (error) {
      this.isPlaying = false
      console.error('[TTS] 播放 base64 音频失败:', error)
      throw error
    }
  }
}

let ttsInstance: TTSService | null = null

export function initTTS(config: TTSConfig): TTSService {
  ttsInstance = new TTSService(config)
  return ttsInstance
}

export function getTTS(): TTSService | null {
  return ttsInstance
}

export default TTSService
