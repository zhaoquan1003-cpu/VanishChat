import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import compression from 'compression'
import cors from 'cors'
import config from './config.js'
import { notFound, errorHandler } from './middleware/errorHandler.js'
import { sessionRoutes } from './routes/session.js'
import { mediaRoutes } from './routes/media.js'
import { systemRoutes } from './routes/system.js'

export function createApp(ctx) {
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', true)

  app.use(compression())
  app.use(cors({ origin: config.corsOrigin, credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))

  // 全站不缓存：临时会话系统，任何中间层缓存都是数据残留风险
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    next()
  })

  app.use('/api/session', sessionRoutes(ctx))
  app.use('/api', mediaRoutes(ctx))
  app.use('/api', systemRoutes(ctx))

  app.use('/api', notFound)

  // 前端静态资源（pnpm/npm run build:web 产物），开发时由 Vite dev server 承担
  const distDir = path.join(config.rootDir, 'web', 'dist')
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, maxAge: 0 }))
    app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
      res.sendFile(path.join(distDir, 'index.html'))
    })
  } else {
    app.get('/', (req, res) => {
      res.type('html').send(`<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>VanishChat 服务端已启动</title>
<body style="font-family:system-ui;max-width:640px;margin:80px auto;padding:0 20px;line-height:1.7;color:#1f2329">
<h2>VanishChat 服务端已就绪</h2>
<p>前端产物尚未构建。请任选其一：</p>
<ul>
  <li>开发模式：另开终端执行 <code>npm run dev:web</code>，访问 <code>http://localhost:5173</code></li>
  <li>生产模式：执行 <code>npm run build:web</code> 后刷新本页</li>
</ul>
<p>API 健康检查：<a href="/api/health">/api/health</a></p>
</body></html>`)
    })
  }

  app.use(errorHandler)
  return app
}

export default createApp
