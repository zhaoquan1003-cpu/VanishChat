import { createRouter, createWebHashHistory } from 'vue-router'
import { sessionState } from './store/session.js'

const HomeView = () => import('./views/HomeView.vue')
const ChatView = () => import('./views/ChatView.vue')
const AboutView = () => import('./views/AboutView.vue')

export const router = createRouter({
  // 用 hash 路由：静态托管 / Nginx 无需额外 rewrite 规则，Docker 部署零配置
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { title: 'VanishChat' } },
    { path: '/chat/:token', name: 'chat', component: ChatView, meta: { title: '会话' } },
    { path: '/about', name: 'about', component: AboutView, meta: { title: '关于' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
