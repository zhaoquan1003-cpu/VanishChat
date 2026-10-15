import { Router } from 'express'
import config from '../config.js'
import { logService } from '../services/logService.js'

/**
 * 系统模块接口
 *   GET /api/health            健康检查 / 运行指标
 *   GET /api/logs?date=        行为日志（需 ADMIN_TOKEN，仅记录行为不含消息内容）
 */
export function systemRoutes(ctx) {
  const router = Router()
  const { store, sessionService } = ctx

  router.get('/health', async (req, res) => {
    const stats = await store.stats().catch(() => ({}))
    const disk = await ctx.fileService.diskUsage().catch(() => ({}))
    res.json({
      ok: true,
      data: {
        status: 'up',
        uptime: Math.round(process.uptime()),
        nodeEnv: config.nodeEnv,
        now: Date.now(),
        store: { driver: store.driver, ...stats },
        disk,
        session: {
          sweepIntervalMs: config.session.sweepIntervalMs,
          defaultTtlHours: config.session.defaultTtlHours,
          expiryTiers: config.session.expiryTiers,
          maxParticipants: config.session.maxParticipants,
        },
        persistence: 'none —— 全链路仅内存存储，会话销毁即物理删除',
      },
    })
  })

  router.get('/logs', async (req, res, next) => {
    try {
      const adminToken = process.env.ADMIN_TOKEN
      const provided = req.headers['x-admin-token']
      if (!adminToken || provided !== adminToken) {
        res.status(403).json({ ok: false, code: 'FORBIDDEN', message: '未开启或凭证错误' })
        return
      }
      const date = req.query.date || new Date().toISOString().slice(0, 10)
      const logs = await logService.list(date, Math.min(Number(req.query.limit) || 200, 1000))
      res.json({ ok: true, data: { date, retentionDays: config.logs.retentionDays, logs } })
    } catch (err) {
      next(err)
    }
  })

  /** 仅调试用：查看某会话的实时结构（不含消息正文） */
  router.get('/debug/:token', async (req, res, next) => {
    try {
      if (process.env.DEBUG !== 'true' && config.nodeEnv === 'production') {
        res.status(403).json({ ok: false, code: 'FORBIDDEN', message: '生产环境已关闭' })
        return
      }
      const session = await sessionService.requireActive(req.params.token)
      const participants = await store.listParticipants(session.token)
      const files = await store.listFileMetas(session.token)
      res.json({
        ok: true,
        data: {
          session: { ...session, msgSeq: undefined },
          participants: participants.map((p) => ({ id: p.id, name: p.name, online: !!p.online })),
          messageCount: await store.countMessages(session.token),
          files: files.map((f) => ({ id: f.id, name: f.name, size: f.size, category: f.category })),
        },
      })
    } catch (err) {
      next(err)
    }
  })

  return router
}

export default systemRoutes
