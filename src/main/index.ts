import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain } from 'electron'

const __dirname = dirname(fileURLToPath(import.meta.url))

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

  // IPC 处理
  ipcMain.handle('window:minimize', () => window.minimize())
  ipcMain.handle('window:close', () => window.close())
  ipcMain.handle('window:get-position', () => {
    const pos = window.getPosition()
    return { x: pos[0], y: pos[1] }
  })
  ipcMain.handle('window:set-position', (_event, x: number, y: number) => {
    if (typeof x === 'number' && typeof y === 'number' && !isNaN(x) && !isNaN(y)) {
      window.setPosition(Math.round(x), Math.round(y))
    }
  })

  if (process.platform === 'darwin') {
    window.setWindowButtonVisibility(false)
  }

  window.setAlwaysOnTop(true, 'screen-saver', 1)
  window.setFullScreenable(false)
  window.setVisibleOnAllWorkspaces(true)
  window.on('ready-to-show', () => window.show())

  // 加载开发服务器
  const devServerUrl = 'http://localhost:5173'
  await window.loadURL(devServerUrl)
  window.webContents.openDevTools({ mode: 'detach' })

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
