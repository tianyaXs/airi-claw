import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCss from 'unocss/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve(__dirname, 'src/main/index.ts'), formats: ['cjs'], fileName: () => 'index.cjs' },
      rollupOptions: { output: { entryFileNames: 'index.cjs' } }
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      lib: { entry: resolve(__dirname, 'src/preload/index.ts'), formats: ['cjs'], fileName: () => 'index.cjs' },
      rollupOptions: { output: { entryFileNames: 'index.cjs' } }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: '.',
    publicDir: resolve(__dirname, 'public'),
    build: { 
      rollupOptions: { 
        input: { index: resolve(__dirname, 'index.html') },
        external: []
      }
    },
    plugins: [vue(), UnoCss()],
    resolve: { 
      alias: { '@': resolve(__dirname, 'src/renderer') }
    },
    assetsInclude: ['**/*.json']
  }
})
