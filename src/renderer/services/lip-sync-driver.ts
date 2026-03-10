/**
 * 音频口型同步驱动器
 * 使用 Web Audio API AnalyserNode 实时分析音频音量来驱动口型
 */
export class LipSyncDriver {
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaElementAudioSourceNode | null = null
  private dataArray: Uint8Array | null = null
  private rafId: number | null = null
  private callbacks: Array<(value: number) => void> = []
  
  private readonly SMOOTHING = 0.7
  private readonly MIN_DB = -60
  private readonly MAX_DB = -10
  private currentValue = 0

  async connect(audio: HTMLAudioElement): Promise<void> {
    this.disconnect()

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 256
      this.analyser.smoothingTimeConstant = this.SMOOTHING
      
      this.source = this.audioContext.createMediaElementSource(audio)
      this.source.connect(this.analyser)
      this.analyser.connect(this.audioContext.destination)
      
      const bufferLength = this.analyser.frequencyBinCount
      this.dataArray = new Uint8Array(bufferLength)
      
      this.startAnalyzing()
      
      console.log('[LipSyncDriver] Connected')
    } catch (error) {
      console.error('[LipSyncDriver] Connection failed:', error)
      throw error
    }
  }

  disconnect(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    
    if (this.source) {
      try { this.source.disconnect() } catch {}
      this.source = null
    }
    
    if (this.analyser) {
      try { this.analyser.disconnect() } catch {}
      this.analyser = null
    }
    
    if (this.audioContext) {
      try { this.audioContext.close() } catch {}
      this.audioContext = null
    }
    
    this.dataArray = null
    this.currentValue = 0
    this.notifyCallbacks(0)
  }

  onValueChange(callback: (value: number) => void): () => void {
    this.callbacks.push(callback)
    return () => {
      const idx = this.callbacks.indexOf(callback)
      if (idx > -1) this.callbacks.splice(idx, 1)
    }
  }

  getCurrentValue(): number {
    return this.currentValue
  }

  private startAnalyzing(): void {
    const analyze = () => {
      if (!this.analyser || !this.dataArray) return

      const dataArray: any = this.dataArray
      this.analyser.getByteTimeDomainData(dataArray)

      // 计算 RMS
      let sum = 0
      for (let i = 0; i < this.dataArray.length; i++) {
        const x = (this.dataArray[i] - 128) / 128.0
        sum += x * x
      }
      const rms = Math.sqrt(sum / this.dataArray.length)

      // 分贝归一化
      const db = 20 * Math.log10(rms + 1e-10)
      const normalized = Math.max(0, Math.min(1, (db - this.MIN_DB) / (this.MAX_DB - this.MIN_DB)))

      // 应用曲线
      this.currentValue = Math.pow(normalized, 0.8) * 1.2
      if (this.currentValue > 1) this.currentValue = 1

      this.notifyCallbacks(this.currentValue)
      this.rafId = requestAnimationFrame(analyze)
    }

    this.rafId = requestAnimationFrame(analyze)
  }

  private notifyCallbacks(value: number): void {
    this.callbacks.forEach(cb => {
      try { cb(value) } catch {}
    })
  }
}

export default LipSyncDriver
