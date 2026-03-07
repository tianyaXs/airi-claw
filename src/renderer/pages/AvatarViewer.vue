<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Application } from '@pixi/app'
import { extensions } from '@pixi/extensions'
import { Ticker, TickerPlugin } from '@pixi/ticker'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { OpenClawClient } from '../services/openclaw'
import ChatInput from '../components/ChatInput.vue'
import { loadConfig, getConfig } from '../utils/config'

const canvasContainerRef = ref<HTMLDivElement>()
const isLoading = ref(true)
const error = ref('')
const connectionStatus = ref<'connecting' | 'connected' | 'disconnected'>('disconnected')
const isSpeaking = ref(false)
const currentMessage = ref('')
const chatHistory = ref<Array<{ role: string; content: string; timestamp: number }>>([])

let pixiApp: Application | null = null

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
      autoInteract: true,
      autoUpdate: true,
    })
    
    pixiApp.stage.addChild(live2dModel)
    setScaleAndPosition()
    
    live2dModel.on('hit', (hitAreas: string[]) => {
      if (hitAreas.includes('body') && live2dModel) {
        live2dModel.motion('tap_body')
      }
    })
    
    try {
      const internalModel = (live2dModel as any).internalModel
      if (internalModel?.motionManager?.groups?.Idle !== undefined) {
        live2dModel.motion('Idle')
      }
    } catch (motionErr) {
      console.warn('[Live2D] Could not start idle motion:', motionErr)
    }
    
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
      showMessage(message.content)
    }
  })
  
  openclawClient.on('chunk', (data: { content: string, fullContent: string }) => {
    isSpeaking.value = true
    currentMessage.value = data.fullContent
  })
  
  openclawClient.on('error', (err: Error) => {
    console.error('[OpenClaw] Error:', err)
    connectionStatus.value = 'disconnected'
  })
  
  try {
    await openclawClient.connect()
  } catch (err) {
    console.error('[OpenClaw] Failed to connect:', err)
    connectionStatus.value = 'disconnected'
  }
}

function showMessage(content: string) {
  isSpeaking.value = true
  // 截断过长的消息，保留前200字符
  currentMessage.value = content.length > 200 ? content.slice(0, 200) + '...' : content
  
  if (messageTimeout) {
    clearTimeout(messageTimeout)
  }
  
  // 根据消息长度计算显示时间：每50ms一个字符，最少4000ms，最多15000ms
  const displayTime = Math.min(Math.max(content.length * 50, 4000), 15000)
  
  messageTimeout = setTimeout(() => {
    isSpeaking.value = false
    currentMessage.value = ''
  }, displayTime)
}

async function handleSendMessage(content: string) {
  if (!content.trim()) return
  
  chatHistory.value.push({
    role: 'user',
    content: content.trim(),
    timestamp: Date.now()
  })
  
  if (openclawClient?.isReady()) {
    try {
      await openclawClient.sendMessage(content.trim())
    } catch (err) {
      console.error('[OpenClaw] Failed to send message:', err)
      showMessage('发送消息失败')
    }
  } else {
    showMessage('未连接到 OpenClaw Gateway')
  }
}

function cleanup() {
  if (messageTimeout) {
    clearTimeout(messageTimeout)
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
      <!-- 左侧工具栏 -->
      <div class="left-toolbar">
        <!-- 可以在这里添加其他工具按钮 -->
      </div>
      
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
        @send="handleSendMessage" 
        @clear="chatHistory = []"
        @minimize="handleMinimize"
        @close="handleClose"
      />
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

/* 左侧工具栏 */
.left-toolbar {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 100;
}

.toolbar-btn {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  position: relative;
}

.toolbar-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: scale(1.05);
}

.toolbar-btn.active {
  background: rgba(102, 126, 234, 0.8);
  border-color: rgba(102, 126, 234, 0.5);
}

.toolbar-btn svg {
  width: 22px;
  height: 22px;
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
</style>
