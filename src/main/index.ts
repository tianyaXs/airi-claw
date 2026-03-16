import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain, screen, protocol } from 'electron'
import { initOpenClawService } from './openclaw'

const __dirname = dirname(fileURLToPath(import.meta.url))

// 获取资源路径
function getAssetPath(relativePath: string): string {
  if (process.env.NODE_ENV === 'development') {
    return join(__dirname, '../../public', relativePath)
  } else {
    // 生产环境：资源在 app.asar 中
    return join(__dirname, '../../public', relativePath)
  }
}

// 读取配置文件
const configPath = join(__dirname, '../../config.json')
let config: any = {
  openclaw: { url: 'ws://127.0.0.1:18789', token: '', agent: 'main' },
  live2d: { modelPath: '/assets/live2d/models/hiyori/Hiyori.model3.json' },
  window: { width: 400, height: 700 }
}

try {
  const configContent = readFileSync(configPath, 'utf-8')
  config = JSON.parse(configContent)
  console.log('[Config] Loaded config:', configPath)
} catch (err) {
  console.warn('[Config] Failed to load config, using defaults:', err)
}

async function createWindow() {
  const window = new BrowserWindow({
    title: 'AIRI Claw',
    width: config.window?.width || 400,
    height: config.window?.height || 700,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
    },
  })

  // 设置 CSP 响应头（开发模式允许 unsafe-eval）
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: blob: https://* http://*.aliyuncs.com; " +
          "media-src 'self' blob: https://* http://*.aliyuncs.com; " +
          "connect-src 'self' ws://127.0.0.1:18789 ws://localhost:18789 http://localhost:5173 https://dashscope.aliyuncs.com https://*.aliyuncs.com http://*.aliyuncs.com;"
        ]
      }
    })
  })

  // IPC 处理
  ipcMain.handle('window:minimize', () => window.minimize())
  ipcMain.handle('window:close', () => window.close())
  // 输入框获得焦点时降低窗口层级，让系统输入法候选框显示在窗口上方；失焦时恢复
  ipcMain.handle('window:set-input-focus', (_event, hasFocus: boolean) => {
    if (process.platform !== 'darwin') return
    if (hasFocus) {
      window.setAlwaysOnTop(true, 'floating', 0)
    } else {
      window.setAlwaysOnTop(true, 'screen-saver', 1)
    }
  })
  ipcMain.handle('window:get-position', () => {
    const pos = window.getPosition()
    return { x: pos[0], y: pos[1] }
  })
  ipcMain.handle('window:set-position', (_event, x: number, y: number) => {
    if (typeof x === 'number' && typeof y === 'number' && !isNaN(x) && !isNaN(y)) {
      window.setPosition(Math.round(x), Math.round(y))
    }
  })

  // 获取资源路径
  ipcMain.handle('app:get-asset-path', (_event, relativePath: string) => {
    return getAssetPath(relativePath)
  })

  // 全局鼠标屏幕坐标（用于窗口外鼠标跟随）
  ipcMain.handle('screen:get-cursor-point', () => {
    const pt = screen.getCursorScreenPoint()
    const pos = window.getPosition()
    return { x: pt.x - pos[0], y: pt.y - pos[1] }
  })

  // TTS 语音合成
  ipcMain.handle('tts:synthesize', async (_event, text: string, apiKey: string, endpoint: string, voice: string) => {
    try {
      console.log('[TTS] 主进程合成请求:', text.substring(0, 50))
      
      // 清理文本
      const cleanText = text.replace(/[\ud800-\udfff]/g, '').trim()
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'qwen3-tts-flash',
          input: {
            text: cleanText,
            voice: voice || 'Momo',
            language_type: 'Chinese',
          },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`TTS 请求失败: ${response.status} ${errorText}`)
      }

      const data = await response.json()
      console.log('[TTS] 主进程合成成功')
      return { success: true, data }
    } catch (error: any) {
      console.error('[TTS] 主进程合成失败:', error)
      return { success: false, error: error.message }
    }
  })

  if (process.platform === 'darwin') {
    window.setWindowButtonVisibility(false)
  }

  window.setAlwaysOnTop(true, 'screen-saver', 1)
  window.setFullScreenable(false)
  window.setVisibleOnAllWorkspaces(true)
  window.on('ready-to-show', () => window.show())

  // 初始化 OpenClaw 服务（在主进程中运行，绕过 CORS）
  initOpenClawService({
    url: config.openclaw?.url || 'ws://127.0.0.1:18789',
    token: config.openclaw?.token || '',
    agent: config.openclaw?.agent || 'main'
  }, window)

  // 加载页面 - 开发模式或生产模式
  if (process.env.NODE_ENV === 'development') {
    // 开发模式：加载开发服务器
    const devServerUrl = 'http://localhost:5173'
    await window.loadURL(devServerUrl)
    window.webContents.openDevTools({ mode: 'detach' })
  } else {
    // 生产模式：加载打包后的文件
    const indexPath = join(__dirname, '../renderer/index.html')
    console.log('[Main] Loading production build:', indexPath)
    await window.loadFile(indexPath)
  }

  return window
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.airi.claw')
  createWindow().catch(console.error)
  
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
