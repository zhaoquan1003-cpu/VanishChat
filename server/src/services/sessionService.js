import config from '../config.js'
import { bus } from '../events.js'
import { generateToken, shortId, normalizeTokenInput } from '../utils/token.js'
import { logger } from '../utils/logger.js'
import { fileService } from './fileService.js'
import { logService } from './logService.js'

export class SessionError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

/**
 * 会话生命周期服务 —— 系统的核心。
 * 负责：创建 / 校验 / 加入 / 续期 / 全链路销毁。
 */
export class SessionService {
  constructor(store) {
    this.store = store
  }

  /** 归一化有效期档位：仅允许配置内的档位，或 1 ~ maxTtlHours 的自定义整数 */
  resolveTtlHours(input) {
    const tiers = config.session.expiryTiers
    if (input === undefined || input === null || input === '') return config.session.defaultTtlHours
    const hours = Number(input)
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new SessionError('INVALID_TTL', '有效期不合法')
    }
    const rounded = Math.round(hours)
    if (rounded > config.session.maxTtlHours) {
      throw new SessionError('INVALID_TTL', `有效期不得超过 ${config.session.maxTtlHours} 小时`)
    }
    if (!tiers.includes(rounded) && rounded > config.session.maxTtlHours) {
      throw new SessionError('INVALID_TTL', `有效期仅支持 ${tiers.join(' / ')} 小时`)
    }
    return rounded
  }

  /** 创建会话：生成全局唯一 Token → 写入存储 → 返回 Token */
  async create({ ttlHours, title, creator } = {}) {
    const hours = this.resolveTtlHours(ttlHours)
    const ttlSeconds = hours * 3600

    // 极小概率碰撞，重试若干次
    let token = null
    for (let i = 0; i < 8; i += 1) {
      const candidate = generateToken()
      const exists = await this.store.getSession(candidate)
      if (!exists) {
        token = candidate
        break
      }
    }
    if (!token) throw new SessionError('TOKEN_COLLISION', 'Token 生成失败，请重试', 500)

    const now = Date.now()
    const session = await this.store.createSession({
      token,
      createdAt: now,
      expireAt: now + ttlSeconds * 1000,
      ttlSeconds,
      status: 'active',
      title: (title || '').slice(0, 40) || '临时会话',
      msgSeq: 0,
      createdBy: {
        id: creator?.id || shortId('u'),
        name: (creator?.name || '发起人').slice(0, 20),
      },
    })

    await logService.write({
      action: 'session.create',
      token,
      ttlHours: hours,
      ip: creator?.ip,
    })
    logger.info(`会话创建 ${token}，有效期 ${hours}h`)
    return session
  }

  /** 读取有效会话；不存在 / 已过期 / 已销毁 分别抛出明确错误码 */
  async requireActive(token) {
    const normalized = normalizeTokenInput(token)
    if (!normalized) throw new SessionError('TOKEN_REQUIRED', '请输入会话 Token', 400)

    const session = await this.store.getSession(normalized)
    if (!session) {
      throw new SessionError('SESSION_NOT_FOUND', 'Token 无效或会话已销毁', 404)
    }
    if (session.status === 'destroyed') {
      throw new SessionError('SESSION_DESTROYED', '会话已销毁', 410)
    }
    if (session.expired) {
      throw new SessionError('SESSION_EXPIRED', '会话已过期', 410)
    }
    return session
  }

  /** 校验（加入前探测，不建立连接） */
  async verify(token) {
    const session = await this.requireActive(token)
    const participants = await this.store.listParticipants(session.token)
    const online = participants.filter((p) => p.online)
    return {
      token: session.token,
      title: session.title,
      createdAt: session.createdAt,
      expireAt: session.expireAt,
      remainingMs: Math.max(0, session.expireAt - Date.now()),
      ttlSeconds: session.ttlSeconds,
      participantCount: participants.length,
      onlineCount: online.length,
      messageCount: await this.store.countMessages(session.token),
      full: participants.length >= config.session.maxParticipants,
      maxParticipants: config.session.maxParticipants,
    }
  }

  /**
   * 加入会话。
   *
   * 席位分配规则（一对一场景下这三条缺一不可）：
   *  1. 携带 participantId 且命中 → 复用原席位（断线重连 / 刷新 / 熄屏回前台）
   *  2. 未携带或未命中，但还有空位 → 分配新席位（新访客）
   *  3. 已满员且存在离线成员 → 顶替离线最久的席位（否则房间会被"离线占位"锁死）
   *
   * 返回值中的 messages 是完整历史，因此「退出再进入」数据不丢。
   */
  async join(token, { participantId, name } = {}) {
    const session = await this.requireActive(token)
    const participants = await this.store.listParticipants(session.token)

    let participant = participantId ? participants.find((p) => p.id === participantId) : null
    let isNewSeat = false

    if (!participant) {
      const offline = participants.filter((p) => !p.online)
      if (participants.length < config.session.maxParticipants) {
        participant = {
          id: shortId('u'),
          name: (name || `访客${participants.length + 1}`).slice(0, 20),
          joinedAt: Date.now(),
        }
        isNewSeat = true
      } else if (offline.length) {
        // 顶替离线最久的席位
        participant = offline.sort((a, b) => (a.lastSeenAt || 0) - (b.lastSeenAt || 0))[0]
      } else {
        throw new SessionError('SESSION_FULL', '该会话人数已满', 409)
      }
    }

    participant.name = (name || participant.name).slice(0, 20)
    participant.online = true
    participant.lastSeenAt = Date.now()
    await this.store.putParticipant(session.token, participant)

    return {
      session,
      participant,
      isNewSeat,
      participants: await this.store.listParticipants(session.token),
    }
  }

  async markOffline(token, participantId) {
    const participants = await this.store.listParticipants(token)
    const found = participants.find((p) => p.id === participantId)
    if (!found) return null
    found.online = false
    found.lastSeenAt = Date.now()
    await this.store.putParticipant(token, found)
    return found
  }

  /** 续期（心跳/活跃时调用），返回新的 expireAt */
  async touch(token) {
    const session = await this.store.getSession(token)
    if (!session || session.status === 'destroyed') return null
    const ok = await this.store.patchSession(token, { lastActiveAt: Date.now() })
    if (!ok) return null
    bus.emit('session:tick', { token, expireAt: session.expireAt })
    return session.expireAt
  }

  /**
   * 全链路销毁：Redis 键批量删除 → 物理文件删除 → 通知在线房间。
   * 幂等：重复调用不会报错。
   */
  async destroy(token, reason = 'manual') {
    const normalized = normalizeTokenInput(token)
    if (!normalized) return { token: normalized, destroyed: false }

    const before = await this.store.getSession(normalized)
    const result = await this.store.destroySession(normalized)
    const removedFiles = await fileService.purgeSessionFiles(normalized, result.fileMetas)

    await logService.write({
      action: 'session.destroy',
      token: normalized,
      reason,
      keysRemoved: result.keysRemoved,
      filesRemoved: removedFiles,
    })

    bus.emit('session:destroyed', { token: normalized, reason })
    if (before) {
      logger.info(
        `会话销毁 ${normalized}（${reason}）：清除 ${result.keysRemoved} 个键、${removedFiles} 个文件`,
      )
    }
    return { token: normalized, destroyed: true, keysRemoved: result.keysRemoved, filesRemoved: removedFiles }
  }
}

export default SessionService
