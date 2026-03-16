<script setup lang="ts">import { ref, nextTick, computed } from 'vue'

const props = defineProps<{
  ttsEnabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'send', message: string): void
  (e: 'clear'): void
  (e: 'minimize'): void
  (e: 'close'): void
  (e: 'tts-toggle', enabled: boolean): void
  (e: 'update:ttsEnabled', enabled: boolean): void
  (e: 'open-config'): void
}>()

function toggleTTS() {
  const newValue = !props.ttsEnabled
  console.log('[ChatInput] TTS 切换, 当前:', props.ttsEnabled, '新值:', newValue)
  emit('update:ttsEnabled', newValue)
  emit('tts-toggle', newValue)
}

const message = ref('')
const isComposing = ref(false)
const isInputOpen = ref(false)
const isNotebookOpen = ref(false)
const currentPage = ref(0)
const chatHistory = defineModel<Array<{ role: string; content: string; timestamp: number }>>('chatHistory', { default: () => [] })
const notebookContentRef = ref<HTMLDivElement>()

const ITEMS_PER_PAGE = 6

const totalPages = computed(() => Math.ceil(chatHistory.value.length / ITEMS_PER_PAGE))

const paginatedHistory = computed(() => {
  const start = currentPage.value * ITEMS_PER_PAGE
  const end = start + ITEMS_PER_PAGE
  return chatHistory.value.slice(start, end)
})

function handleSend() {
  const trimmed = message.value.trim()
  if (!trimmed) return
  emit('send', trimmed)
  message.value = ''
  isInputOpen.value = false
}

function handleKeydown(event: KeyboardEvent) {
  if (isComposing.value) return
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
  }
}

function handleCompositionStart() {
  isComposing.value = true
}

function handleCompositionEnd() {
  isComposing.value = false
}

function toggleInput() {
  isInputOpen.value = !isInputOpen.value
  if (isInputOpen.value) {
    isNotebookOpen.value = false
  }
}

function toggleNotebook() {
  isNotebookOpen.value = !isNotebookOpen.value
  if (isNotebookOpen.value) {
    isInputOpen.value = false
    currentPage.value = Math.max(0, totalPages.value - 1)
    nextTick(() => scrollToBottom())
  }
}

function prevPage() {
  if (currentPage.value > 0) {
    currentPage.value--
  }
}

function nextPage() {
  if (currentPage.value < totalPages.value - 1) {
    currentPage.value++
  }
}

function clearHistory() {
  if (confirm('确定要清除所有聊天记录吗？')) {
    emit('clear')
    currentPage.value = 0
  }
}

function handleMinimize() {
  emit('minimize')
}

function handleClose() {
  emit('close')
}

function handleOpenConfig() {
  emit('open-config')
}

function scrollToBottom() {
  if (notebookContentRef.value) {
    notebookContentRef.value.scrollTop = notebookContentRef.value.scrollHeight
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 展开/收起长消息
const expandedItems = ref<Set<number>>(new Set())

function toggleExpand(index: number) {
  if (expandedItems.value.has(index)) {
    expandedItems.value.delete(index)
  } else {
    expandedItems.value.add(index)
  }
}

function isExpanded(index: number): boolean {
  return expandedItems.value.has(index)
}

const MAX_MESSAGE_LENGTH = 120 // 最大显示字符数

function shouldTruncate(content: string): boolean {
  return content.length > MAX_MESSAGE_LENGTH
}

function truncateContent(content: string): string {
  if (content.length <= MAX_MESSAGE_LENGTH) return content
  return content.slice(0, MAX_MESSAGE_LENGTH) + '...'
}
</script>

<template>
  <div class="desk-scene">
    <!-- 桌面 -->
    <div class="desk-surface">
      <div class="wood-grain"></div>
      
      <!-- 简单的笔 -->
      <button
        class="simple-pen"
        :class="{ active: isInputOpen }"
        @click="toggleInput"
        title="写消息"
      >
        <div class="pen-visual">
          <div class="pen-top"></div>
          <div class="pen-middle"></div>
          <div class="pen-bottom"></div>
        </div>

        <div v-if="chatHistory.length > 0" class="notification-dot"></div>
      </button>
      
      <!-- 线圈本 -->
      <button 
        class="spiral-notebook" 
        :class="{ active: isNotebookOpen }"
        @click="toggleNotebook"
        title="聊天记录"
      >
        <div class="notebook-visual">
          <div class="spiral-rings">
            <div class="ring" v-for="n in 4" :key="n"></div>
          </div>
          
          <div class="cover">
            <div class="cover-pattern">
              <div class="pattern-dot" v-for="n in 6" :key="n"></div>
            </div>
            <div class="bookmark"></div>
          </div>
          
          <div class="pages"></div>
        </div>
        
        <div v-if="chatHistory.length > 0" class="page-badge">{{ chatHistory.length }}</div>
      </button>
      
      <!-- 橡皮擦 -->
      <button class="cute-eraser" @click="clearHistory" title="清除记录">
        <div class="eraser-visual">
          <div class="eraser-body">
            <div class="eraser-strip blue"></div>
            <div class="eraser-strip white"></div>
          </div>
          <div class="eraser-face">
            <div class="face-dot"></div>
          </div>
        </div>
      </button>

      <!-- 小相框（系统控制） -->
      <button class="photo-frame" title="窗口控制">
        <div class="frame-body">
          <div class="frame-photo">
            <div class="scenery">
              <div class="sun"></div>
              <div class="cloud"></div>
              <div class="hill"></div>
            </div>
          </div>
          <div class="frame-stand"></div>
        </div>
        <div class="frame-menu">
          <button class="menu-btn config" @click.stop="handleOpenConfig" title="配置">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          <button 
            class="menu-btn tts" 
            :class="{ active: props.ttsEnabled }"
            @click.stop="toggleTTS" 
            :title="props.ttsEnabled ? '关闭语音朗读' : '开启语音朗读'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 5L6 9H2v6h4l5 4V5z"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" v-if="props.ttsEnabled"/>
              <line x1="23" y1="9" x2="17" y2="15" v-if="!props.ttsEnabled"/>
              <line x1="17" y1="9" x2="23" y2="15" v-if="!props.ttsEnabled"/>
            </svg>
          </button>
          <button class="menu-btn minimize" @click.stop="handleMinimize" title="最小化">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 12H4"/>
            </svg>
          </button>
          <button class="menu-btn close" @click.stop="handleClose" title="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </button>
    </div>
    
    <!-- 桌腿 -->
    <div class="desk-legs">
      <div class="leg left"></div>
      <div class="leg right"></div>
    </div>
    
    <!-- 输入对话框 -->
    <transition name="pop">
      <div v-if="isInputOpen" class="input-popup">
        <div class="paper-dialog">
          <div class="paper-pattern">
            <div class="line" v-for="n in 6" :key="n"></div>
          </div>
          
          <textarea
            v-model="message"
            class="paper-input"
            placeholder="写点什么..."
            rows="4"
            @keydown="handleKeydown"
            @compositionstart="handleCompositionStart"
            @compositionend="handleCompositionEnd"
          />
          
          <div class="dialog-footer">
            <button class="btn-cancel" @click="isInputOpen = false">取消</button>
            <button class="btn-send" :disabled="!message.trim()" @click="handleSend">发送</button>
          </div>
        </div>
      </div>
    </transition>
    
    <!-- 翻页笔记本 -->
    <transition name="pop">
      <div v-if="isNotebookOpen" class="notebook-popup">
        <div class="open-book">
          <!-- 左页 -->
          <div class="book-page left">
            <div class="page-number">-{{ currentPage * 2 + 1 }}-</div>
            
            <div ref="notebookContentRef" class="page-content">
              <div 
                v-for="(msg, index) in paginatedHistory" 
                :key="index"
                class="history-item"
                :class="[msg.role, { expanded: isExpanded(index) }]"
              >
                <div class="item-header">
                  <span class="avatar">{{ msg.role === 'user' ? '😊' : '🤖' }}</span>
                  <span class="time">{{ formatTime(msg.timestamp) }}</span>
                </div>
                <div class="item-text-wrapper">
                  <div class="item-text" :class="{ truncated: !isExpanded(index) && shouldTruncate(msg.content) }">
                    {{ isExpanded(index) ? msg.content : truncateContent(msg.content) }}
                  </div>
                  <button 
                    v-if="shouldTruncate(msg.content)" 
                    class="expand-btn"
                    @click="toggleExpand(index)"
                  >
                    {{ isExpanded(index) ? '收起' : '展开' }}
                  </button>
                </div>
              </div>
              
              <div v-if="chatHistory.length === 0" class="empty-history">
                还没有聊天记录~
              </div>
            </div>
          </div>
          
          <!-- 书脊 -->
          <div class="book-spine"></div>
          
          <!-- 右页 -->
          <div class="book-page right">
            <div class="page-number">-{{ currentPage * 2 + 2 }}-</div>
            
            <div class="page-content decoration">
              <div class="cute-doodle">✨</div>
              <div class="cute-doodle star">⭐</div>
              <div class="cute-doodle heart">💕</div>
            </div>
          </div>
          
          <!-- 翻页控制 -->
          <div class="page-controls">
            <button 
              class="page-btn" 
              :disabled="currentPage === 0"
              @click="prevPage"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
            
            <span class="page-indicator">{{ currentPage + 1 }} / {{ totalPages || 1 }}</span>
            
            <button 
              class="page-btn" 
              :disabled="currentPage >= totalPages - 1"
              @click="nextPage"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          </div>
          
          <!-- 关闭按钮 -->
          <button class="book-close" @click="isNotebookOpen = false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.desk-scene {
  position: relative;
  width: 100%;
  max-width: 360px;
  margin: 0 auto;
}

/* 桌面 */
.desk-surface {
  position: relative;
  background: linear-gradient(180deg, #f5e6d3 0%, #e8d5c0 100%);
  border-radius: 20px 20px 8px 8px;
  padding: 25px 35px 18px;
  box-shadow: 
    0 4px 0 #d4c4a8,
    0 8px 0 #c4b498,
    0 12px 20px rgba(0, 0, 0, 0.15),
    inset 0 2px 0 rgba(255, 255, 255, 0.4);
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 35px;
  min-height: 90px;
}

.wood-grain {
  position: absolute;
  inset: 0;
  border-radius: 20px 20px 8px 8px;
  opacity: 0.08;
  background-image: repeating-linear-gradient(
    90deg,
    transparent,
    transparent 30px,
    rgba(160, 120, 80, 0.5) 30px,
    rgba(160, 120, 80, 0.5) 32px
  );
  pointer-events: none;
}

/* 简单的笔 */
.simple-pen {
  position: relative;
  background: none;
  border: none;
  cursor: pointer;
  padding: 5px;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.simple-pen:hover {
  transform: translateY(-6px);
}

.simple-pen.active {
  transform: translateY(-10px);
}

.pen-visual {
  width: 24px;
  height: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  filter: drop-shadow(2px 2px 3px rgba(0,0,0,0.2));
}

.pen-top {
  width: 20px;
  height: 10px;
  background: linear-gradient(180deg, #ff9999 0%, #ff7777 100%);
  border-radius: 10px 10px 3px 3px;
}

.pen-middle {
  width: 18px;
  height: 55px;
  background: linear-gradient(90deg, #f4d03f 0%, #f9e79f 50%, #f4d03f 100%);
  border-radius: 2px;
}

.pen-bottom {
  width: 0;
  height: 0;
  border-left: 9px solid transparent;
  border-right: 9px solid transparent;
  border-top: 12px solid #c0c0c0;
  position: relative;
}

.pen-bottom::before {
  content: '';
  position: absolute;
  left: -3px;
  top: -12px;
  width: 0;
  height: 0;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  border-top: 5px solid #666;
}

.notification-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 14px;
  height: 14px;
  background: #ff6b6b;
  border-radius: 50%;
  border: 2px solid #f5e6d3;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

/* 线圈本 */
.spiral-notebook {
  position: relative;
  background: none;
  border: none;
  cursor: pointer;
  padding: 5px;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.spiral-notebook:hover {
  transform: translateY(-8px) scale(1.05);
}

.spiral-notebook.active {
  transform: translateY(-12px) scale(1.1);
}

.notebook-visual {
  width: 55px;
  height: 70px;
  position: relative;
}

.spiral-rings {
  position: absolute;
  left: -3px;
  top: 8px;
  bottom: 8px;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  z-index: 2;
}

.ring {
  width: 8px;
  height: 6px;
  background: linear-gradient(180deg, #c0c0c0 0%, #a0a0a0 100%);
  border-radius: 3px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

.cover {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, #a8d8ea 0%, #8ecae6 100%);
  border-radius: 6px 10px 10px 6px;
  box-shadow: 
    -2px 2px 6px rgba(0,0,0,0.15),
    inset 1px 0 0 rgba(255,255,255,0.3);
  overflow: hidden;
}

.cover-pattern {
  position: absolute;
  inset: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-content: flex-start;
  opacity: 0.4;
}

.pattern-dot {
  width: 8px;
  height: 8px;
  background: white;
  border-radius: 50%;
}

.bookmark {
  position: absolute;
  top: -3px;
  right: 12px;
  width: 12px;
  height: 20px;
  background: linear-gradient(180deg, #ff9999 0%, #ff7777 100%);
  border-radius: 0 0 6px 6px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.pages {
  position: absolute;
  right: -3px;
  top: 3px;
  bottom: 3px;
  width: 6px;
  background: linear-gradient(90deg, #f5f5f5 0%, #e8e8e8 100%);
  border-radius: 0 4px 4px 0;
}

.page-badge {
  position: absolute;
  top: -5px;
  right: -8px;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 11px;
  font-size: 11px;
  font-weight: 700;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  border: 2px solid #f5e6d3;
}

/* 橡皮擦 */
.cute-eraser {
  position: relative;
  background: none;
  border: none;
  cursor: pointer;
  padding: 5px;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.cute-eraser:hover {
  transform: translateY(-8px) rotate(-5deg) scale(1.05);
}

.cute-eraser:active {
  transform: translateY(-4px) scale(0.95);
}

.eraser-visual {
  width: 38px;
  height: 28px;
  position: relative;
}

.eraser-body {
  width: 100%;
  height: 100%;
  display: flex;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 2px 3px 6px rgba(0,0,0,0.2);
  transform: rotate(-8deg);
}

.eraser-strip {
  flex: 1;
  height: 100%;
}

.eraser-strip.blue {
  background: linear-gradient(180deg, #7ec8e0 0%, #5aa8c8 100%);
}

.eraser-strip.white {
  background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%);
}

.eraser-face {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.face-dot {
  width: 20px;
  height: 4px;
  background: rgba(0,0,0,0.3);
  border-radius: 2px;
}

/* 桌腿 */
.desk-legs {
  display: flex;
  justify-content: space-between;
  padding: 0 50px;
}

.leg {
  width: 18px;
  height: 22px;
  background: linear-gradient(90deg, #c4b498 0%, #d4c4a8 50%, #c4b498 100%);
  border-radius: 0 0 4px 4px;
  box-shadow: 0 3px 6px rgba(0,0,0,0.15);
}

.leg.left {
  transform: rotate(-2deg);
}

.leg.right {
  transform: rotate(2deg);
}

/* 小相框 */
.photo-frame {
  position: relative;
  background: none;
  border: none;
  cursor: pointer;
  padding: 5px;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.photo-frame:hover {
  transform: translateY(-6px) rotate(2deg);
}

.frame-body {
  width: 50px;
  height: 65px;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}

.frame-photo {
  width: 44px;
  height: 50px;
  background: linear-gradient(135deg, #fff 0%, #f5f5f5 100%);
  border: 3px solid #d4a574;
  border-radius: 4px;
  box-shadow: 
    0 3px 8px rgba(0,0,0,0.2),
    inset 0 1px 0 rgba(255,255,255,0.5);
  overflow: hidden;
  position: relative;
}

.scenery {
  width: 100%;
  height: 100%;
  position: relative;
  background: linear-gradient(180deg, #87ceeb 0%, #b8e6f0 50%, #90ee90 50%, #7dd87d 100%);
}

.sun {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 10px;
  height: 10px;
  background: #ffd700;
  border-radius: 50%;
  box-shadow: 0 0 5px rgba(255, 215, 0, 0.6);
}

.cloud {
  position: absolute;
  top: 8px;
  left: 3px;
  width: 16px;
  height: 8px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 8px;
}

.cloud::before {
  content: '';
  position: absolute;
  top: -4px;
  left: 3px;
  width: 8px;
  height: 8px;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
}

.hill {
  position: absolute;
  bottom: 0;
  left: -5px;
  width: 60px;
  height: 15px;
  background: #6bc96b;
  border-radius: 50% 50% 0 0;
}

.frame-stand {
  width: 30px;
  height: 8px;
  background: linear-gradient(180deg, #c49464 0%, #a67b52 100%);
  border-radius: 0 0 4px 4px;
  margin-top: -2px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.frame-menu {
  position: absolute;
  top: -45px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  opacity: 0;
  visibility: hidden;
  transition: all 0.2s ease;
  background: rgba(0, 0, 0, 0.8);
  padding: 8px;
  border-radius: 20px;
  backdrop-filter: blur(10px);
}

.photo-frame:hover .frame-menu,
.frame-menu:hover {
  opacity: 1;
  visibility: visible;
  top: -50px;
}

.menu-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

.menu-btn:hover {
  transform: scale(1.1);
}

.menu-btn.minimize:hover {
  background: rgba(255, 193, 7, 0.3);
  color: #ffc107;
}

.menu-btn.close:hover {
  background: rgba(255, 107, 107, 0.3);
  color: #ff6b6b;
}

.menu-btn.tts:hover {
  background: rgba(102, 126, 234, 0.3);
  color: #667eea;
}

.menu-btn.tts.active {
  background: rgba(102, 126, 234, 0.5);
  color: #fff;
}

.menu-btn.config:hover {
  background: rgba(255, 193, 7, 0.3);
  color: #ffc107;
}

.menu-btn svg {
  width: 14px;
  height: 14px;
}

/* 输入对话框 */
.input-popup {
  position: absolute;
  left: 50%;
  bottom: 75px;
  transform: translateX(-50%);
  width: 300px;
  z-index: 200;
}

.paper-dialog {
  background: #fffef8;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 
    0 15px 40px rgba(0,0,0,0.25),
    0 5px 15px rgba(0,0,0,0.1);
  position: relative;
  overflow: hidden;
}

.paper-pattern {
  position: absolute;
  left: 35px;
  top: 15px;
  bottom: 15px;
  display: flex;
  flex-direction: column;
  gap: 28px;
  pointer-events: none;
}

.line {
  width: 200px;
  height: 1px;
  background: #ffe0e0;
}

.paper-input {
  width: 100%;
  min-height: 120px;
  padding: 5px 5px 5px 45px;
  background: transparent;
  border: none;
  outline: none;
  color: #4a4a4a;
  font-size: 15px;
  line-height: 28px;
  resize: none;
  font-family: inherit;
}

.paper-input::placeholder {
  color: #ccc;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
  padding-top: 15px;
  border-top: 1px dashed #e0e0e0;
}

.btn-cancel,
.btn-send {
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.btn-cancel {
  background: #f5f5f5;
  color: #888;
}

.btn-cancel:hover {
  background: #e8e8e8;
}

.btn-send {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 3px 10px rgba(102, 126, 234, 0.3);
}

.btn-send:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
}

.btn-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 笔记本弹出 */
.notebook-popup {
  position: absolute;
  left: 50%;
  bottom: 75px;
  transform: translateX(-50%);
  width: 400px;
  z-index: 200;
}

.open-book {
  display: flex;
  background: linear-gradient(90deg, #faf8f3 0%, #fffef8 50%, #faf8f3 100%);
  border-radius: 12px;
  box-shadow: 
    0 20px 60px rgba(0,0,0,0.3),
    0 8px 20px rgba(0,0,0,0.15);
  position: relative;
  min-height: 280px;
  overflow: hidden;
}

.book-page {
  flex: 1;
  padding: 15px 20px;
  position: relative;
}

.book-page.left {
  border-right: 1px solid #e8e4dc;
}

.page-number {
  text-align: center;
  font-size: 11px;
  color: #c0b8a8;
  margin-bottom: 10px;
  font-family: Georgia, serif;
}

.page-content {
  height: 200px;
  overflow-y: auto;
  background-image: repeating-linear-gradient(
    transparent,
    transparent 31px,
    #f0ece0 31px,
    #f0ece0 32px
  );
  line-height: 32px;
  padding: 0 5px;
}

.page-content.decoration {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: none;
}

.cute-doodle {
  font-size: 32px;
  position: absolute;
  opacity: 0.6;
}

.cute-doodle.star {
  top: 40px;
  right: 40px;
  font-size: 20px;
}

.cute-doodle.heart {
  bottom: 50px;
  left: 50px;
  font-size: 24px;
}

.book-spine {
  position: absolute;
  left: 50%;
  top: 10px;
  bottom: 10px;
  width: 3px;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    #d8d0c0 15%,
    #d8d0c0 85%,
    transparent 100%
  );
  transform: translateX(-50%);
}

.history-item {
  margin-bottom: 8px;
  padding: 4px 0;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2px;
}

.avatar {
  font-size: 14px;
}

.time {
  font-size: 10px;
  color: #bbb;
}

.item-text-wrapper {
  padding-left: 20px;
}

.item-text {
  font-size: 13px;
  color: #4a4a4a;
  line-height: 1.6;
  word-wrap: break-word;
  white-space: pre-wrap;
  word-break: break-all;
}

.item-text.truncated {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.expand-btn {
  margin-top: 6px;
  padding: 2px 10px;
  font-size: 11px;
  color: #667eea;
  background: transparent;
  border: 1px solid #667eea;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.expand-btn:hover {
  background: #667eea;
  color: white;
}

.history-item {
  margin-bottom: 12px;
  padding: 8px 0;
  border-bottom: 1px dashed #f0ece0;
}

.history-item:last-child {
  border-bottom: none;
}

.empty-history {
  text-align: center;
  padding: 60px 20px;
  color: #ccc;
  font-size: 13px;
}

/* 翻页控制 */
.page-controls {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.9);
  padding: 6px 12px;
  border-radius: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.page-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #f5f5f5;
  border: none;
  color: #666;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.page-btn:hover:not(:disabled) {
  background: #e8e8e8;
  transform: scale(1.1);
}

.page-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.page-btn svg {
  width: 16px;
  height: 16px;
}

.page-indicator {
  font-size: 12px;
  color: #888;
  font-weight: 500;
  min-width: 50px;
  text-align: center;
}

.book-close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.05);
  border: none;
  color: #999;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.book-close:hover {
  background: rgba(0, 0, 0, 0.1);
  color: #666;
  transform: rotate(90deg);
}

.book-close svg {
  width: 14px;
  height: 14px;
}

/* 动画 */
.pop-enter-active,
.pop-leave-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(20px) scale(0.9);
}

/* 滚动条 */
.page-content::-webkit-scrollbar {
  width: 3px;
}

.page-content::-webkit-scrollbar-track {
  background: transparent;
}

.page-content::-webkit-scrollbar-thumb {
  background: rgba(139, 115, 85, 0.3);
  border-radius: 2px;
}
</style>
