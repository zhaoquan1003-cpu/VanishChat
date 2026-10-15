import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import config from '../config.js'
import { bus } from '../events.js'
import { logger } from '../utils/logger.js'

const ROOM = (token) => `chat:${token}`

/** 简易令牌桶：防止单连接刷消息 / 刷输入状态 */
function createBucket(capacity, refillPerSec) {
  let tokens = capacity
  let last = Date.now()
  return () => {
    const now = Date.now()
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec)
    last = now
    if (tokens < 1) return false
    tokens -= 1
    return true
  }
}

/**
 * Socket.io 通信层 —— Token 房间模式的承载。
 *
 * 事件契约
 *  客户端 → 服务端
 *    session:join    { token, participantId?, name? }
 *    msg:send        { type, content?, file?, localId? }
 *    msg:read        { upToTs }
 *    typing          { typing }
 *    session:leave   {}
 *    session:destroy {}                        主动提前结束（全链路销毁）
 *    presence:ping   {}
 *  服务端 → 客户端
 *    session:ready   { session, participant, participants, messages }
 *    presence:update { participants, onlineCount }
 *    msg:new         { message }
 *    msg:read        { participantId, upToTs }
 *    typing          { participantId, name, typing }
 *    session:tick    { expireAt }
 *    session:destroyed { reason }
 *    error           { code, message }
 */
export function createSocketServer(httpServer, ctx) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigin, credentials: true },
    transports: ['websocket', 'polling'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1e6,
    path: '/socket.io',
  })

  // 多实例水平扩容：Redis 适配器让房间广播跨进程生效
  if (ctx.store.driver === 'redis' && typeof ctx.store.duplicate === 'function') {
    try {
      io.adapter(createAdapter(ctx.store.duplicate(), ctx.store.duplicate()))
      logger.info('Socket.io 已挂载 Redis 适配器 —— 支持多实例水平扩容')
    } catch (err) {
      logger.warn(`Redis 适配器挂载失败，退化为单实例模式：${err.message}`)
    }
  }

  const { sessionService, messageService } = ctx

  const fail = (cb, code, message) => {
    if (typeof cb === 'function') cb({ ok: false, code, message })
  }

  const guard = async (socket, token) => {
    if (!socket.data.token || socket.data.token !== token) {
      throw Object.assign(new Error('尚未加入该会话'), { code: 'NOT_JOINED' })
    }
    const session = await sessionService.requireActive(token)
    return session
  }

  io.on('connection', (socket) => {
    const sendBucket = createBucket(30, 10)
    socket.data.joinedAt = Date.now()

    // -------------------------------------------------- 加入会话（房间）
    socket.on('session:join', async (payload = {}, cb) => {
      try {
        const { token, participantId, name } = payload
        const result = await sessionService.join(token, { participantId, name })
        const { session, participant, isNewSeat } = result

        // 同一连接重复加入时先退出旧房间
        if (socket.data.token && socket.data.token !== session.token) {
          socket.leave(ROOM(socket.data.token))
        }
        socket.data.token = session.token
        socket.data.participantId = participant.id
        socket.data.participantName = participant.name
        socket.join(ROOM(session.token))

        const participants = await ctx.store.listParticipants(session.token)
        const messages = await messageService.list(session.token, { limit: 200 })

        const beforeOnline = participants.filter((p) => p.online && p.id !== participant.id).length

        // 只有"新面孔加入且房间里已有人在等"时才落一条系统消息，避免重连刷屏
        if (isNewSeat && beforeOnline > 0) {
          const sysMsg = await messageService.system(session.token, `${participant.name} 已加入会话`)
          io.to(ROOM(session.token)).emit('msg:new', { message: sysMsg })
        }

        if (typeof cb === 'function') {
          cb({
            ok: true,
            session: {
              token: session.token,
              title: session.title,
              createdAt: session.createdAt,
              expireAt: session.expireAt,
              ttlSeconds: session.ttlSeconds,
              maxParticipants: config.session.maxParticipants,
            },
            participant,
            participants: participants.map((p) => ({
              id: p.id,
              name: p.name,
              online: !!p.online,
              lastSeenAt: p.lastSeenAt,
            })),
            messages,
          })
        }

        socket.to(ROOM(session.token)).emit('presence:update', {
          participants: participants.map((p) => ({ id: p.id, name: p.name, online: !!p.online })),
          onlineCount: participants.filter((p) => p.online).length,
        })
      } catch (err) {
        logger.warn(`session:join 失败：${err.message}`)
        fail(cb, err.code || 'JOIN_FAILED', err.message)
        socket.emit('error', { code: err.code || 'JOIN_FAILED', message: err.message })
      }
    })

    // ------------------------------------------------------------ 发消息
    socket.on('msg:send', async (payload = {}, cb) => {
      try {
        if (!sendBucket()) throw Object.assign(new Error('发送过于频繁，请稍后再试'), { code: 'RATE_LIMITED' })
        const session = await guard(socket, socket.data.token)
        const participants = await ctx.store.listParticipants(session.token)
        const participant = participants.find((p) => p.id === socket.data.participantId)
        if (!participant) throw Object.assign(new Error('会话成员身份失效'), { code: 'NOT_JOINED' })

        const message = await messageService.send(session.token, payload, participant)
        io.to(ROOM(session.token)).emit('msg:new', { message })
        if (typeof cb === 'function') cb({ ok: true, message })
      } catch (err) {
        fail(cb, err.code || 'SEND_FAILED', err.message)
      }
    })

    // ------------------------------------------------------------ 已读回执
    socket.on('msg:read', async (payload = {}) => {
      try {
        if (!socket.data.token) return
        const upToTs = Number(payload.upToTs) || Date.now()
        await messageService.markRead(socket.data.token, socket.data.participantId, upToTs)
        socket.to(ROOM(socket.data.token)).emit('msg:read', {
          participantId: socket.data.participantId,
          upToTs,
        })
      } catch {
        /* 忽略 */
      }
    })

    // ------------------------------------------------------------ 输入状态
    socket.on('typing', (payload = {}) => {
      if (!socket.data.token) return
      socket.to(ROOM(socket.data.token)).emit('typing', {
        participantId: socket.data.participantId,
        name: socket.data.participantName,
        typing: !!payload.typing,
      })
    })

    // ------------------------------------------------------------ 离开会话
    const leave = async (reason = 'leave') => {
      const token = socket.data.token
      const participantId = socket.data.participantId
      if (!token || !participantId) return
      await sessionService.markOffline(token, participantId).catch(() => {})
      socket.leave(ROOM(token))
      const participants = await ctx.store.listParticipants(token).catch(() => [])
      socket.to(ROOM(token)).emit('presence:update', {
        participants: participants.map((p) => ({ id: p.id, name: p.name, online: !!p.online })),
        onlineCount: participants.filter((p) => p.online).length,
      })
      socket.data.token = null
      socket.data.participantId = null
      logger.debug(`成员离开会话 ${token}（${reason}）`)
    }

    socket.on('session:leave', () => leave('leave').catch(() => {}))

    // ------------------------------------------- 主动结束会话（全链路销毁）
    socket.on('session:destroy', async (payload = {}, cb) => {
      try {
        const session = await guard(socket, socket.data.token)
        await sessionService.destroy(session.token, payload.reason || 'manual')
        if (typeof cb === 'function') cb({ ok: true })
      } catch (err) {
        fail(cb, err.code || 'DESTROY_FAILED', err.message)
      }
    })

    // ------------------------------------------------------------ 心跳续期
    socket.on('presence:ping', async () => {
      if (!socket.data.token) return
      const expireAt = await sessionService.touch(socket.data.token).catch(() => null)
      if (expireAt) socket.emit('session:tick', { expireAt })
    })

    socket.on('disconnect', () => {
      leave('disconnect').catch(() => {})
    })
  })

  // 会话被销毁（用户主动 or 清扫器判定过期）→ 通知房间并清场
  bus.on('session:destroyed', ({ token, reason }) => {
    const room = ROOM(token)
    io.to(room).emit('session:destroyed', { token, reason })
    io.in(room).socketsLeave(room)
  })

  return io
}

export default createSocketServer
