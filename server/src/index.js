import http from 'node:http'
import config from './config.js'
import { logger } from './utils/logger.js'
import { createStore } from './store/index.js'
import { setStore } from './services/storeRef.js'
import { fileService } from './services/fileService.js'
import { SessionService } from './services/sessionService.js'
import { MessageService } from './services/messageService.js'
import { Sweeper } from './services/sweeper.js'
import { createApp } from './app.js'
import { createSocketServer } from './socket/index.js'

async function bootstrap() {
  const store = setStore(await createStore())
  await fileService.init()

  const sessionService = new SessionService(store)
  const messageService = new MessageService(store)
  const sweeper = new Sweeper({ store, sessionService, fileService })

  const ctx = { store, sessionService, messageService, fileService, sweeper }

  const app = createApp(ctx)
  const server = http.createServer(app)
  const io = createSocketServer(server, ctx)

  // 会话空闲即续期：仅刷新 lastActiveAt，不改变原定过期时间
  sweeper.start()

  await new Promise((resolve) => server.listen(config.port, resolve))
  logger.info(`VanishChat 服务已启动 → http://localhost:${config.port}`)
  logger.info(
    `有效期档位：${config.session.expiryTiers.join(' / ')} 小时｜默认 ${config.session.defaultTtlHours}h｜单会话上限 ${config.session.maxParticipants} 人`,
  )

  const shutdown = async (signal) => {
    logger.warn(`收到 ${signal}，正在优雅退出……`)
    sweeper.stop()
    io.close()
    server.close()
    await store.close().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('unhandledRejection', (err) => logger.error(`未捕获的 Promise 拒绝：${err?.message || err}`))
  process.on('uncaughtException', (err) => logger.error(`未捕获异常：${err?.message}\n${err?.stack}`))

  return { server, io, ctx }
}

bootstrap().catch((err) => {
  logger.error(`启动失败：${err.message}\n${err.stack}`)
  process.exit(1)
})
