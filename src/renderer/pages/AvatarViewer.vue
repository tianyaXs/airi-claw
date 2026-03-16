<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Application } from '@pixi/app'
import { extensions } from '@pixi/extensions'
import { Ticker, TickerPlugin } from '@pixi/ticker'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { OpenClawClient } from '../services/openclaw'
import ChatInput from '../components/ChatInput.vue'
import { loadConfig, getConfig } from '../utils/config'
import { initTTS, getTTS } from '../services/tts'
import { StreamingTTS } from '../services/streaming-tts'
import { EmojiActionController } from '../services/emoji-action'

const canvasContainerRef = ref<HTMLDivElement>()
const isLoading = ref(true)
const error = ref('')
const connectionStatus = ref<'connecting' | 'connected' | 'disconnected'>('disconnected')
const isSpeaking = ref(false)
const currentMessage = ref('')
const chatHistory = ref<Array<{ role: string; content: string; timestamp: number }>>([])
const ttsEnabled = ref(false)

// 配置界面
const showConfig = ref(false)
const configForm = ref({
  openclawUrl: '',
  openclawToken: '',
  ttsApiKey: ''
})

let pixiApp: Application | null = null
let streamingTTS: StreamingTTS | null = null
let emojiController: EmojiActionController | null = null

// 窗口拖拽
const isWindowDragging = ref(false)
let dragStartX = 0
let dragStartY = 0
let windowStartX = 0
let windowStartY = 0
let currentDeltaX = 0
let currentDeltaY = 0

async function startWindowDrag(e: MouseEvent | TouchEvent) {
  isWindowDragging.value = true
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
  dragStartX = clientX
  dragStartY = clientY
  currentDeltaX = 0
  currentDeltaY = 0
  
  // 获取当前窗口位置
  try {
    const pos = await window.electron.ipcRenderer.invoke('window:get-position')
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      windowStartX = pos.x
      windowStartY = pos.y
    }
  } catch (err) {
    console.error('Failed to get window position:', err)
  }
  
  document.addEventListener('mousemove', onWindowDrag)
  document.addEventListener('mouseup', stopWindowDrag)
  document.addEventListener('touchmove', onWindowDrag)
  document.addEventListener('touchend', stopWindowDrag)
}

function onWindowDrag(e: MouseEvent | TouchEvent) {
  if (!isWindowDragging.value) return
  e.preventDefault()

  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

  currentDeltaX = clientX - dragStartX
  currentDeltaY = clientY - dragStartY
}

async function stopWindowDrag() {
  if (!isWindowDragging.value) return
  
  isWindowDragging.value = false
  document.removeEventListener('mousemove', onWindowDrag)
  document.removeEventListener('mouseup', stopWindowDrag)
  document.removeEventListener('touchmove', onWindowDrag)
  document.removeEventListener('touchend', stopWindowDrag)
  
  // 只在结束时发送一次位置更新
  if (currentDeltaX !== 0 || currentDeltaY !== 0) {
    const newX = Math.round(windowStartX + currentDeltaX)
    const newY = Math.round(windowStartY + currentDeltaY)
    try {
      await window.electron.ipcRenderer.invoke('window:set-position', newX, newY)
    } catch (err) {
      console.error('Failed to set window position:', err)
    }
  }
}
let live2dModel: Live2DModel | null = null
let openclawClient: OpenClawClient | null = null
let messageTimeout: ReturnType<typeof setTimeout> | null = null
let mouseMoveHandler: ((e: MouseEvent) => void) | null = null
let focusLoopId: ReturnType<typeof setInterval> | null = null

const CANVAS_WIDTH = 400
const CANVAS_HEIGHT = 500
const RESOLUTION = 2

function handleMinimize() {
  window.electron.ipcRenderer.invoke('window:minimize')
}

function handleClose() {
  window.electron.ipcRenderer.invoke('window:close')
}

function setScaleAndPosition() {
  if (!live2dModel) return
  
  const initialWidth = live2dModel.width
  const initialHeight = live2dModel.height
  
  const offsetFactor = 2.0
  const heightScale = (CANVAS_HEIGHT * 0.95 / initialHeight * offsetFactor)
  const widthScale = (CANVAS_WIDTH * 0.95 / initialWidth * offsetFactor)
  let scale = Math.min(heightScale, widthScale)
  
  if (Number.isNaN(scale) || scale <= 0) {
    scale = 1e-6
  }
  
  live2dModel.scale.set(scale)
  live2dModel.anchor.set(0.5, 0.5)
  live2dModel.position.set(CANVAS_WIDTH / 2, CANVAS_HEIGHT)
}

async function initLive2D() {
  try {
    if (!canvasContainerRef.value) {
      error.value = 'Canvas container not found'
      return
    }
    
    isLoading.value = true
    error.value = ''
    
    const cubismCore = (window as any).Live2DCubismCore
    if (typeof cubismCore === 'undefined') {
      throw new Error('Live2D Cubism SDK not loaded')
    }
    
    Live2DModel.registerTicker(Ticker)
    extensions.add(TickerPlugin)
    
    pixiApp = new Application({
      width: CANVAS_WIDTH * RESOLUTION,
      height: CANVAS_HEIGHT * RESOLUTION,
      backgroundAlpha: 0,
      preserveDrawingBuffer: true,
      autoDensity: false,
      resolution: 1,
    })
    
    pixiApp.stage.scale.set(RESOLUTION)
    
    const canvas = pixiApp.view as HTMLCanvasElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.objectFit = 'cover'
    canvas.style.display = 'block'
    
    canvasContainerRef.value.appendChild(canvas)
    
    const modelUrl = getConfig().live2d.modelPath
    live2dModel = await Live2DModel.from(modelUrl, {
      autoInteract: false,
      autoUpdate: true,
    })
    
    pixiApp.stage.addChild(live2dModel)
    setScaleAndPosition()
    
    // 初始化 Emoji 动作控制器
    emojiController = new EmojiActionController()
    emojiController.bind(live2dModel)
    
    live2dModel.on('hit', (hitAreas: string[]) => {
      if (hitAreas.includes('body') && live2dModel) {
        live2dModel.motion('tap_body')
      }
    })
    
    // 初始化完成，EmojiActionController 会自动启动待机循环

    // 鼠标跟随：直接操作 focusController，绕过坐标转换问题
    // focusController.focus(x, y) 接受 [-1, 1] 范围的归一化坐标
    // x: -1=左, 1=右；y: -1=上, 1=下
    const applyFocus = (winRelX: number, winRelY: number) => {
      if (!live2dModel) return
      const fc = (live2dModel as any).internalModel?.focusController
      if (!fc) return
      // 窗口宽高
      const W = window.innerWidth
      const H = window.innerHeight
      // 归一化到 [-1, 1]，中心为 (0, 0)
      const nx = (winRelX / W) * 2 - 1
      // Y 轴翻转：鼠标在上（Y小）时，人物向上看（Y负）
      const ny = 1 - (winRelY / H) * 2
      fc.focus(nx, ny)
    }

    mouseMoveHandler = (e: MouseEvent) => {
      applyFocus(e.clientX, e.clientY)
    }
    document.addEventListener('mousemove', mouseMoveHandler)

    // 轮询全局屏幕坐标（支持鼠标在窗口外时继续跟随）
    focusLoopId = setInterval(async () => {
      if (!live2dModel) return
      try {
        const pt = await window.electron.ipcRenderer.invoke('screen:get-cursor-point')
        applyFocus(pt.x, pt.y)
      } catch {}
    }, 50) // 20fps 轮询足够，窗口内由 mousemove 补充

    isLoading.value = false
  } catch (err) {
    const errorMsg = (err as Error).message || String(err)
    error.value = '加载失败: ' + errorMsg
    console.error('[Live2D] Error:', err)
    isLoading.value = false
  }
}

async function initOpenClaw() {
  connectionStatus.value = 'connecting'
  
  const cfg = getConfig()
  openclawClient = new OpenClawClient({
    url: cfg.openclaw.url,
    agent: cfg.openclaw.agent,
    token: cfg.openclaw.token,
    systemPrompt: cfg.openclaw.systemPrompt,
    thinking: cfg.openclaw.thinking,
    autoReconnect: true,
    reconnectInterval: 5000,
  })
  
  openclawClient.on('connected', () => {
    console.log('[OpenClaw] Connected to gateway')
    connectionStatus.value = 'connected'
  })
  
  openclawClient.on('disconnected', () => {
    console.log('[OpenClaw] Disconnected from gateway')
    connectionStatus.value = 'disconnected'
  })
  
  openclawClient.on('pairingRequired', (request: { requestId: string; deviceId: string; reason: string }) => {
    console.log('[OpenClaw] Pairing required:', request)
    connectionStatus.value = 'disconnected'
    
    // 在控制台醒目地打印配对命令
    console.log('%c========================================', 'color: #667eea; font-size: 14px; font-weight: bold;')
    console.log('%c设备需要配对，请复制以下命令到终端运行：', 'color: #667eea; font-size: 14px; font-weight: bold;')
    console.log('%copenclaw devices approve ' + request.requestId, 'color: #4caf50; font-size: 16px; font-weight: bold; background: #f0f0f0; padding: 8px; border-radius: 4px;')
    console.log('%c========================================', 'color: #667eea; font-size: 14px; font-weight: bold;')
    
    // 以人物对话形式显示配对提示，命令放在最前面方便复制
    const command = `openclaw devices approve ${request.requestId}`
    const pairingMessage = `初次见面！请帮我绑定设备~

${command}

复制上面的命令到终端运行，我就能为您服务啦！✨`
    
    showMessage(pairingMessage)
  })
  
  openclawClient.on('message', (message: { role: string; content: string }) => {
    chatHistory.value.push({
      role: message.role,
      content: message.content,
      timestamp: Date.now()
    })
    if (message.role === 'assistant') {
      // 完成流式 TTS，播放剩余内容
      // 注意：文字显示改为在 TTS 播放时通过回调显示
      if (streamingTTS && ttsEnabled.value) {
        streamingTTS.finish()
      } else {
        // 没有 TTS 时，直接显示文字
        showMessage(message.content)
      }
    }
  })
  
  openclawClient.on('chunk', (data: { content: string, fullContent: string }) => {
    // 流式过程中检测 emoji 触发表情（语音播报前检测）
    if (emojiController) {
      emojiController.triggerFromText(data.content)
    }

    // 流式 TTS - 添加文本到队列
    if (streamingTTS && ttsEnabled.value) {
      streamingTTS.addText(data.content)
    }
  })
  
  openclawClient.on('error', (err: Error) => {
    console.error('[OpenClaw] Error:', err)
    connectionStatus.value = 'disconnected'
    
    // 检查是否是配对错误，显示提示消息
    if (err.message?.includes('openclaw devices approve')) {
      const match = err.message.match(/openclaw devices approve (\S+)/)
      const requestId = match ? match[1] : ''
      showPairingMessage(requestId)
    }
  })
  
  openclawClient.on('pairingRequired', (data: { requestId: string }) => {
    console.log('[OpenClaw] Pairing required:', data.requestId)
    showPairingMessage(data.requestId)
  })
  
  openclawClient.on('deviceMismatch', (data: { deviceId: string }) => {
    console.log('[OpenClaw] Device mismatch:', data.deviceId)
    showMessage(`⚠️ 设备身份不匹配\n\n请在终端运行：\nopenclaw devices remove ${data.deviceId}\n\n然后重启应用，会自动弹出新的配对命令`)
  })
  
  try {
    await openclawClient.connect()
  } catch (err: any) {
    console.error('[OpenClaw] Failed to connect:', err)
    connectionStatus.value = 'disconnected'
    const errorMessage = err?.message || ''
    if (errorMessage.includes('device identity mismatch') || errorMessage.includes('Device identity mismatch')) {
      const deviceId = err?.deviceId || '未知'
      showMessage(`⚠️ 设备身份不匹配\n\n请在终端运行：\nopenclaw devices remove ${deviceId}\n\n然后重启应用，会自动弹出新的配对命令`)
    } else if (errorMessage.includes('gateway token missing') || errorMessage.includes('gateway.remote.token')) {
      showMessage('🔑 网关需要 Token\n\n请在「配置」中填写 OpenClaw Token\n与网关的 gateway.auth.token 一致')
    }
  }
}

function showMessage(content: string) {
  isSpeaking.value = true
  
  // 解析完整消息中的表情标签
  if (emojiController) {
    emojiController.triggerFromText(content)
  }
  
  // 去掉表情标签和动作标签，只保留纯文本
  let cleanContent = content
    .replace(/\[表情:\w+\]/g, '')
    .replace(/\[动作:\w+\]/g, '')
    .trim()
  
  // 截断过长的消息，保留前200字符
  currentMessage.value = cleanContent.length > 200 ? cleanContent.slice(0, 200) + '...' : cleanContent
  
  // TTS 已由 StreamingTTS 在流式过程中处理，这里不再重复播放
  
  if (messageTimeout) {
    clearTimeout(messageTimeout)
  }
  
  // 根据消息长度计算显示时间：每50ms一个字符，最少4000ms，最多15000ms
  const displayTime = Math.min(Math.max(cleanContent.length * 50, 4000), 15000)
  
  messageTimeout = setTimeout(() => {
    isSpeaking.value = false
    currentMessage.value = ''
    // 播报结束，恢复 neutral
    if (emojiController) {
      emojiController.reset()
    }
  }, displayTime)
}

// 显示配对提示消息
function showPairingMessage(requestId: string) {
  isSpeaking.value = true
  currentMessage.value = `连接失败，请在终端运行：\nopenclaw devices approve ${requestId || '<request-id>'}`
  
  if (messageTimeout) {
    clearTimeout(messageTimeout)
  }
  
  // 显示较长时间（15秒），让用户有足够时间看到命令
  messageTimeout = setTimeout(() => {
    isSpeaking.value = false
    currentMessage.value = ''
  }, 15000)
}

async function handleSendMessage(content: string) {
  if (!content.trim()) return
  
  // 重置流式 TTS
  if (streamingTTS) {
    streamingTTS.reset()
  }
  
  chatHistory.value.push({
    role: 'user',
    content: content.trim(),
    timestamp: Date.now()
  })
  
  if (openclawClient) {
    try {
      await openclawClient.sendMessage(content.trim())
    } catch (err: any) {
      console.error('[OpenClaw] Failed to send message:', err)
      // 获取错误消息（支持 Error 对象和字符串）
      const errorMessage = err?.message || String(err) || ''
      console.error('[OpenClaw] Error message:', errorMessage)
      
      // 检查是否是配对错误
      if (errorMessage.includes('openclaw devices approve')) {
        const match = errorMessage.match(/openclaw devices approve (\S+)/)
        const requestId = match ? match[1] : ''
        const command = `openclaw devices approve ${requestId}`
        showMessage(`🔐 设备需要配对\n\n请在终端运行：\n\n${command}`)
      } else if (errorMessage.includes('gateway token missing') || errorMessage.includes('gateway.remote.token')) {
        showMessage('🔑 网关需要 Token\n\n请在「配置」中填写 OpenClaw Token\n与网关的 gateway.auth.token 一致')
      } else if (errorMessage.includes('unauthorized') || errorMessage.includes('token')) {
        showMessage('🔑 Token 验证失败\n\n请在配置中检查\nOpenClaw Token 是否正确')
      } else if (errorMessage.includes('配对') || errorMessage.includes('pairing')) {
        showMessage('❌ 连接失败\n请检查设备已配对~')
      } else if (errorMessage.includes('WebSocket error') || errorMessage.includes('ECONNREFUSED')) {
        showMessage('🌐 无法连接\n\nOpenClaw 服务器未启动\n请检查配置~')
      } else {
        // 其他错误 - 显示完整错误信息
        if (errorMessage.includes('device identity mismatch')) {
           const deviceId = err?.deviceId || '未知'
           showMessage(`⚠️ 设备身份不匹配\n\n请在终端运行：\nopenclaw devices remove ${deviceId}\n\n然后重启应用，会自动弹出新的配对命令`)
        }
      }
    }
  } else {
    showMessage('客户端未初始化，请重启应用~')
  }
}

function handleTTSToggle(enabled: boolean) {
  console.log('[TTS] 语音朗读:', enabled ? '开启' : '关闭')
  // 控制 StreamingTTS
  if (streamingTTS) {
    streamingTTS.setEnabled(enabled)
  }
}

// 打开配置界面
function openConfig() {
  const config = getConfig()
  configForm.value = {
    openclawUrl: config.openclaw?.url || 'ws://127.0.0.1:18789',
    openclawToken: config.openclaw?.token || '',
    ttsApiKey: config.tts?.apiKey || ''
  }
  showConfig.value = true
}

// 关闭配置界面
function closeConfig() {
  showConfig.value = false
}

// 保存配置
async function saveConfig() {
  try {
    // 更新内存中的配置
    const config = getConfig()
    config.openclaw.url = configForm.value.openclawUrl
    config.openclaw.token = configForm.value.openclawToken
    if (!config.tts) {
      config.tts = {
        apiKey: '',
        endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        voice: 'Momo',
        enabled: false
      }
    }
    config.tts.apiKey = configForm.value.ttsApiKey
    
    // 保存到 localStorage
    localStorage.setItem('airi-claw-config', JSON.stringify({
      openclaw: config.openclaw,
      tts: config.tts
    }))
    
    showMessage('配置已保存~')
    closeConfig()
    
    // 提示重启应用
    setTimeout(() => {
      showMessage('请重启应用使配置生效~')
    }, 2000)
  } catch (err) {
    console.error('[Config] Failed to save:', err)
    showMessage('保存配置失败~')
  }
}

// 加载本地配置
function loadLocalConfig() {
  try {
    const saved = localStorage.getItem('airi-claw-config')
    if (saved) {
      const parsed = JSON.parse(saved)
      const config = getConfig()
      if (parsed.openclaw) {
        config.openclaw = { ...config.openclaw, ...parsed.openclaw }
      }
      if (parsed.tts) {
        config.tts = { ...config.tts, ...parsed.tts }
      }
      console.log('[Config] Loaded from localStorage')
    }
  } catch (err) {
    console.error('[Config] Failed to load from localStorage:', err)
  }
}

// 重置设备身份（清除主进程 device-keys.json 并重新生成密钥）
async function resetDevice() {
  if (!confirm('确定要重置设备身份吗？这会清除保存的设备密钥，需在终端执行 openclaw devices remove <deviceId> 后重新配对。')) return
  try {
    if (openclawClient) {
      const result = await openclawClient.resetDeviceKeys()
      if (result.success) {
        showMessage('设备身份已重置，正在重新连接…')
        connectionStatus.value = 'connecting'
        try {
          await openclawClient.connect()
        } catch (e) {
          // 连接会触发 NOT_PAIRED，界面会显示配对命令
        }
      } else {
        showMessage('重置失败：' + (result.error || '请重试'))
      }
    } else {
      showMessage('请重启应用后再试~')
    }
  } catch (err) {
    console.error('[Device] Failed to reset:', err)
    showMessage('重置失败，请重试~')
  }
}

function cleanup() {
  if (messageTimeout) {
    clearTimeout(messageTimeout)
  }
  if (mouseMoveHandler) {
    document.removeEventListener('mousemove', mouseMoveHandler)
    mouseMoveHandler = null
  }
  if (focusLoopId) {
    clearInterval(focusLoopId)
    focusLoopId = null
  }
  if (emojiController) {
    emojiController.unbind()
    emojiController = null
  }
  if (live2dModel) {
    try {
      live2dModel.destroy()
    } catch (e) {
      console.warn('[Live2D] Error destroying model:', e)
    }
    live2dModel = null
  }
  if (pixiApp) {
    try {
      pixiApp.destroy(true)
    } catch (e) {
      console.warn('[Live2D] Error destroying app:', e)
    }
    pixiApp = null
  }
  if (openclawClient) {
    openclawClient.disconnect()
    openclawClient = null
  }
}

onMounted(async () => {
  await loadConfig()
  
  // 加载本地保存的配置
  loadLocalConfig()

  // 初始化 TTS
  const config = getConfig()
  initTTS({
    apiKey: config.tts?.apiKey || '',
    endpoint: config.tts?.endpoint,
    voice: config.tts?.voice,
    enabled: false, // 默认关闭
  })

  // 初始化流式 TTS
  if (config.tts?.apiKey) {
    streamingTTS = new StreamingTTS(
      config.tts.apiKey,
      config.tts.endpoint || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      config.tts.voice || 'Momo'
    )

    // 设置回调
    streamingTTS.setCallbacks({
      // 口型同步
      onLipSync: (value) => {
        if (emojiController) {
          emojiController.setLipSync(value)
        }
      },
      // 文字流式显示
      onTextDisplay: (text, isNewChunk) => {
        currentMessage.value = text
        if (isNewChunk) {
          isSpeaking.value = true
          // 清除之前的超时
          if (messageTimeout) clearTimeout(messageTimeout)
          // 根据文字长度设置显示时间
          const displayTime = Math.min(Math.max(text.length * 50, 4000), 15000)
          messageTimeout = setTimeout(() => {
            isSpeaking.value = false
            currentMessage.value = ''
            streamingTTS?.clearDisplayedText()
            // 播报结束恢复 neutral
            if (emojiController) {
              emojiController.reset()
            }
          }, displayTime)
        }
      },
      onPlaybackStart: () => {
        console.log('[Avatar] TTS 播放开始')
      },
      onPlaybackEnd: () => {
        console.log('[Avatar] TTS 播放结束')
      }
    })
  }

  setTimeout(() => {
    initLive2D()
    initOpenClaw()
  }, 100)
})

onUnmounted(() => {
  cleanup()
})
</script>

<template>
  <div class="airi-claw-container">
    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 中间：虚拟形象 -->
      <div class="avatar-wrapper">
        <div ref="canvasContainerRef" class="canvas-container" />
        
        <!-- 气泡对话框 -->
        <transition name="bubble">
          <div v-if="isSpeaking" class="speech-bubble">
            <div class="bubble-content">{{ currentMessage }}</div>
            <div class="bubble-arrow"></div>
          </div>
        </transition>
        
        <!-- 加载/错误提示 -->
        <div v-if="isLoading" class="overlay-message">
          <span>加载中...</span>
        </div>
        <div v-if="error" class="overlay-message error">
          <span>{{ error }}</span>
          <button @click="initLive2D">重试</button>
        </div>
      </div>
      
      <!-- 窗口拖拽手柄 -->
      <div
        class="drag-handle"
        :class="connectionStatus"
        @mousedown="startWindowDrag"
        @touchstart="startWindowDrag"
        title="拖动移动窗口"
      >
        <div class="move-arrows">
          <div class="arrow up">▲</div>
          <div class="arrow-row">
            <div class="arrow left">◀</div>
            <div class="arrow center">◆</div>
            <div class="arrow right">▶</div>
          </div>
          <div class="arrow down">▼</div>
        </div>
      </div>

    </div>
    
    <!-- 底部输入区（包含书本） -->
    <div class="input-area">
        <ChatInput 
        v-model:chatHistory="chatHistory"
        :ttsEnabled="ttsEnabled"
        @update:ttsEnabled="ttsEnabled = $event"
        @send="handleSendMessage"
        @clear="chatHistory = []"
        @minimize="handleMinimize"
        @close="handleClose"
        @tts-toggle="handleTTSToggle"
        @open-config="openConfig"
      />
    </div>

    <!-- 配置弹窗 -->
    <div v-if="showConfig" class="config-modal" @click="closeConfig">
      <div class="config-content" @click.stop>
        <h3>应用配置</h3>

        <div class="config-section">
          <h4>OpenClaw 设置</h4>
          <div class="config-item">
            <label>服务器地址</label>
            <input v-model="configForm.openclawUrl" type="text" placeholder="ws://127.0.0.1:18789" />
          </div>
          <div class="config-item">
            <label>Token</label>
            <input v-model="configForm.openclawToken" type="password" placeholder="输入 Token" />
          </div>
        </div>

        <div class="config-section">
          <h4>TTS 设置</h4>
          <div class="config-item">
            <label>API Key (阿里云 DashScope)</label>
            <input v-model="configForm.ttsApiKey" type="password" placeholder="sk-..." />
          </div>
        </div>

        <div class="config-section">
          <h4>设备管理</h4>
          <p style="font-size: 12px; color: rgba(255, 255, 255, 0.6); margin-bottom: 12px;">
            如果遇到"设备身份不匹配"错误，点击下方按钮重置设备身份
          </p>
          <button class="btn-reset" @click="resetDevice">重置设备身份</button>
        </div>

        <div class="config-actions">
          <button class="btn-secondary" @click="closeConfig">取消</button>
          <button class="btn-primary" @click="saveConfig">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.airi-claw-container {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: transparent;
  overflow: hidden;
  position: relative;
}

.main-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 60px 100px;
  position: relative;
}

.badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: #ff6b6b;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 虚拟形象区域 */
.avatar-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.canvas-container {
  width: 100%;
  height: 100%;
}

.canvas-container canvas {
  max-width: 100%;
  max-height: 100%;
}

/* 气泡对话框 */
.speech-bubble {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 280px;
  max-height: 200px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 16px;
  padding: 14px 18px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  z-index: 50;
  overflow: hidden;
}

.bubble-content {
  color: #333;
  font-size: 14px;
  line-height: 1.5;
  word-wrap: break-word;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 170px;
  overflow-y: auto;
  padding-right: 4px;
}

/* 气泡内容滚动条 */
.bubble-content::-webkit-scrollbar {
  width: 4px;
}

.bubble-content::-webkit-scrollbar-track {
  background: transparent;
}

.bubble-content::-webkit-scrollbar-thumb {
  background: rgba(139, 115, 85, 0.3);
  border-radius: 2px;
}

.bubble-arrow {
  position: absolute;
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid rgba(255, 255, 255, 0.95);
}

.bubble-enter-active,
.bubble-leave-active {
  transition: all 0.3s ease;
}

.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}

/* 窗口拖拽手柄 - 透明带箭头 */
.drag-handle {
  position: absolute;
  right: 16px;
  top: 50px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 1.5px solid rgba(255, 255, 255, 0.25);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  transition: all 0.2s;
  user-select: none;
}

.drag-handle:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.4);
  transform: scale(1.08);
}

.drag-handle:active {
  cursor: grabbing;
  transform: scale(0.95);
}

/* 连接状态边框颜色 */
.drag-handle.connecting {
  border-color: rgba(255, 193, 7, 0.5);
  box-shadow: 0 0 15px rgba(255, 193, 7, 0.2);
}

.drag-handle.connected {
  border-color: rgba(76, 175, 80, 0.5);
  box-shadow: 0 0 15px rgba(76, 175, 80, 0.2);
}

.drag-handle.disconnected {
  border-color: rgba(244, 67, 54, 0.5);
  box-shadow: 0 0 15px rgba(244, 67, 54, 0.2);
}

/* 箭头布局 */
.move-arrows {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.arrow-row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.arrow {
  font-size: 8px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1;
}

.arrow.up, .arrow.down {
  font-size: 7px;
}

.arrow.center {
  font-size: 6px;
  color: rgba(255, 255, 255, 0.5);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* 遮罩消息 */
.overlay-message {
  position: absolute;
  padding: 12px 20px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(10px);
  border-radius: 8px;
  color: white;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.overlay-message.error {
  background: rgba(255, 107, 107, 0.9);
}

.overlay-message button {
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.2);
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.overlay-message button:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* 输入区 - 课桌容器 */
.input-area {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 30px 20px 10px;
  background: linear-gradient(
    to top,
    rgba(139, 115, 85, 0.3) 0%,
    rgba(139, 115, 85, 0.1) 50%,
    transparent 100%
  );
  z-index: 100;
  display: flex;
  justify-content: center;
}

/* 配置弹窗 */
.config-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.config-content {
  background: rgba(30, 30, 30, 0.95);
  border-radius: 16px;
  padding: 24px;
  width: 90%;
  max-width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  color: white;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */
}

.config-content::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Opera */
}

.config-content h3 {
  margin: 0 0 20px 0;
  font-size: 18px;
  font-weight: 600;
  text-align: center;
}

.config-content h4 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 8px;
}

.config-section {
  margin-bottom: 20px;
}

.config-item {
  margin-bottom: 12px;
}

.config-item label {
  display: block;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 4px;
}

.config-item input {
  width: 100%;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: white;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.config-item input:focus {
  border-color: rgba(255, 255, 255, 0.4);
}

.config-item input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.config-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 20px;
}

.config-actions button {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.2);
}

.btn-primary {
  background: #4CAF50;
  color: white;
}

.btn-primary:hover {
  background: #45a049;
}

.btn-reset {
  width: 100%;
  padding: 10px 16px;
  background: rgba(255, 107, 107, 0.2);
  border: 1px solid rgba(255, 107, 107, 0.5);
  border-radius: 6px;
  color: #ff6b6b;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-reset:hover {
  background: rgba(255, 107, 107, 0.3);
  border-color: rgba(255, 107, 107, 0.7);
}

/* 动作测试面板 */
.motion-test-panel {
  position: absolute;
  left: 16px;
  top: 50px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 12px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
