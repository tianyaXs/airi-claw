import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import AvatarViewer from './pages/AvatarViewer.vue'
import 'uno.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', component: AvatarViewer }]
})

createApp(App).use(router).mount('#app')
