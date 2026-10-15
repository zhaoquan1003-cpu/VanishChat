import { Router } from 'express'
import config from '../config.js'
import { normalizeTokenInput } from '../utils/token.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { logService } from '../services/logService.js'

/**
 * 会话模块 HTTP 接口
 *   GET    /api/session/config            前端拉取可用档位与限制
 *   POST   /api/session/create            创建会话（生成 8 位 Token）
 *   GET    /api/session/:token/verify     校验 Token（加入前探测）
 *   GET    /api/session/:token/messages   拉取历史消息（仅内存）
 *   POST   /api/session/:token/destroy    立即销毁（全链路）
 */
export function sessionRoutes(ctx) {
  const router = Router()
  const { sessionService, messageService } = ctx

  router.get('/config', (req, res) => {
    res.json({
      ok: true,
      data: {
        tokenLength: config.session.tokenLength,
        defaultTtlHours: config.session.defaultTtlHours,
        expiryTiers: config.session.expiryTiers,
        maxTtlHours: config.session.maxTtlHours,
        maxParticipants: config.session.maxParticipants,
        maxMessages: config.session.maxMessages,
        maxFileSizeMB: Math.round(config.upload.maxFileSize / 1024 / 1024),
        maxFilesPerRequest: config.upload.maxFilesPerRequest,
        logRetentionDays: config.logs.retentionDays,
        storageDriver: ctx.store.driver,
        sweepIntervalMs: config.session.sweepIntervalMs,
      },
    })
  })

  router.post(
    '/create',
    rateLimit({ max: config.rateLimit.createPerMinute, key: 'create' }),
    async (req, res, next) => {
      try {
        const { ttlHours, title, name, creatorId } = req.body || {}
        const session = await sessionService.create({
          ttlHours,
          title,
          creator: { id: creatorId, name, ip: req.ip },
        })
        res.status(201).json({
          ok: true,
          data: {
            token: session.token,
            title: session.title,
            createdAt: session.createdAt,
            expireAt: session.expireAt,
            ttlSeconds: session.ttlSeconds,
          },
        })
      } catch (err) {
        next(err)
      }
    },
  )

  router.get(
    '/:token/verify',
    rateLimit({ max: config.rateLimit.verifyPerMinute, key: 'verify' }),
    async (req, res, next) => {
      try {
        const token = normalizeTokenInput(req.params.token)
        const data = await sessionService.verify(token)
        await logService.write({ action: 'session.verify', token, ip: req.ip, ok: true })
        res.json({ ok: true, data })
      } catch (err) {
        if (err.code) {
          await logService.write({
            action: 'session.verify',
            token: normalizeTokenInput(req.params.token),
            ip: req.ip,
            ok: false,
            code: err.code,
          })
        }
        next(err)
      }
    },
  )

  router.get('/:token/messages', async (req, res, next) => {
    try {
      const session = await sessionService.requireActive(req.params.token)
      const limit = Math.min(Number(req.query.limit) || 200, 500)
      const before = req.query.before ? Number(req.query.before) : undefined
      const messages = await messageService.list(session.token, { limit, before })
      res.json({ ok: true, data: { token: session.token, expireAt: session.expireAt, messages } })
    } catch (err) {
      next(err)
    }
  })

  router.post('/:token/destroy', async (req, res, next) => {
    try {
      const token = normalizeTokenInput(req.params.token)
      const session = await sessionService.requireActive(token).catch((err) => {
        // 已销毁 / 已过期同样按成功处理，保证接口幂等
        if (err.code === 'SESSION_NOT_FOUND' || err.code === 'SESSION_DESTROYED' || err.code === 'SESSION_EXPIRED') {
          return null
        }
        throw err
      })
      if (!session) {
        res.json({ ok: true, data: { token, destroyed: true, idempotent: true } })
        return
      }
      const result = await sessionService.destroy(token, req.body?.reason || 'manual')
      res.json({ ok: true, data: result })
    } catch (err) {
      next(err)
    }
  })

  return router
}

export default sessionRoutes
