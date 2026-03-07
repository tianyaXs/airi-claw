<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  (e: 'minimize'): void
  (e: 'close'): void
}>()

const isMenuOpen = ref(false)

function handleMinimize() {
  isMenuOpen.value = false
  emit('minimize')
}

function handleClose() {
  isMenuOpen.value = false
  emit('close')
}

function toggleMenu() {
  isMenuOpen.value = !isMenuOpen.value
}
</script>

<template>
  <div class="window-controls">
    <div class="drag-region" />
    
    <!-- 设置按钮 -->
    <div class="settings-wrapper">
      <button 
        class="settings-btn" 
        :class="{ active: isMenuOpen }"
        @click="toggleMenu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      
      <!-- 下拉菜单 -->
      <transition name="menu">
        <div v-if="isMenuOpen" class="settings-menu">
          <button class="menu-item" @click="handleMinimize">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 12H4"/>
            </svg>
            <span>最小化</span>
          </button>
          <button class="menu-item close" @click="handleClose">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
            <span>关闭</span>
          </button>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.window-controls {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  z-index: 1000;
  -webkit-app-region: drag;
}

.drag-region {
  flex: 1;
  height: 100%;
}

.settings-wrapper {
  position: relative;
  -webkit-app-region: no-drag;
}

.settings-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.settings-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: rotate(30deg);
}

.settings-btn.active {
  background: rgba(102, 126, 234, 0.8);
  border-color: rgba(102, 126, 234, 0.5);
  transform: rotate(90deg);
}

.settings-btn svg {
  width: 18px;
  height: 18px;
}

.settings-menu {
  position: absolute;
  top: 44px;
  right: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(20px);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px;
  min-width: 140px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  cursor: pointer;
  border-radius: 8px;
  transition: all 0.2s;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.menu-item.close:hover {
  background: rgba(255, 107, 107, 0.3);
  color: #ff6b6b;
}

.menu-item svg {
  width: 16px;
  height: 16px;
}

.menu-enter-active,
.menu-leave-active {
  transition: all 0.2s ease;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
}
</style>
