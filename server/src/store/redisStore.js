import Redis from 'ioredis'
import config from '../config.js'

/**
 * Redis 7.x 存储适配器 —— 纯内存存储（不开启 RDB/AOF 时进程内即全部数据）。
 *
 * Key 设计（prefix 默认 vc）：
 *   vc:sessions:expiry        ZSET   member=token  score=expireAt   → 过期扫描
 *   vc:s:{token}              HASH   会话基础信息（含 msgSeq 计数器）
 *   vc:s:{token}:parts        HASH   participantId -> participant JSON
 *   vc:s:{token}:msgs         LIST   消息（RPUSH，仅内存）
 *   vc:s:{token}:files        HASH   fileId -> 文件元数据 JSON
 *   vc:log:{YYYY-MM-DD}       LIST   行为日志（仅行为，不含消息内容）
 *
 * 所有会话相关 Key 统一设置 PEXPIREAT = 会话过期时间，
 * 到点由 Redis 自身兜底清除；清扫器（sweeper）负责磁盘文件与房间广播。
 */
export class RedisStore {
  constructor() {
    this.driver = 'redis'
    const { url, keyPrefix } = config.redis
    this.prefix = keyPrefix
    this.client = new Redis(url, {
      keyPrefix: `${keyPrefix}:`,
      connectTimeout: config.redis.connectTimeout,
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    })
    /** 索引 ZSET 的宽限期：保证进程重启后仍能发现过期 Token 去清理物理文件 */
    this.indexGraceMs = 24 * 60 * 60 * 1000
  }

  async init() {
    await this.client.connect()
    await this.client.ping()
  }

  async close() {
    try {
      await this.client.quit()
    } catch {
      this.client.disconnect()
    }
  }

  /** 供 socket.io 集群适配器复用同一条连接池 */
  duplicate() {
    return this.client.duplicate()
  }

  get key() {
    return {
      index: 'sessions:expiry',
      session: (t) => `s:${t}`,
      parts: (t) => `s:${t}:parts`,
      msgs: (t) => `s:${t}:msgs`,
      files: (t) => `s:${t}:files`,
      log: (d) => `log:${d}`,
    }
  }

  async #pexpireAt(token, expireAt) {
    const t = String(expireAt)
    await this.client
      .pipeline()
      .pexpireat(this.key.session(token), t)
      .pexpireat(this.key.parts(token), t)
      .pexpireat(this.key.msgs(token), t)
      .pexpireat(this.key.files(token), t)
      .exec()
  }

  // ---------------------------------------------------------------- 会话

  async createSession(session) {
    const k = this.key
    const flat = {
      token: session.token,
      createdAt: String(session.createdAt),
      expireAt: String(session.expireAt),
      ttlSeconds: String(session.ttlSeconds),
      status: session.status || 'active',
      title: session.title || '',
      msgSeq: '0',
      createdById: session.createdBy?.id || '',
      createdByName: session.createdBy?.name || '',
    }
    await this.client
      .pipeline()
      .hset(k.session(session.token), flat)
      .zadd(k.index, session.expireAt, session.token)
      .pexpireat(k.session(session.token), session.expireAt)
      .pexpireat(k.parts(session.token), session.expireAt)
      .pexpireat(k.msgs(session.token), session.expireAt)
      .pexpireat(k.files(session.token), session.expireAt)
      .pexpireat(k.index, session.expireAt + this.indexGraceMs)
      .exec()
    return { ...session }
  }

  async getSession(token) {
    const raw = await this.client.hgetall(this.key.session(token))
    if (!raw || !raw.token) return null
    const session = {
      token: raw.token,
      createdAt: Number(raw.createdAt),
      expireAt: Number(raw.expireAt),
      ttlSeconds: Number(raw.ttlSeconds),
      status: raw.status,
      title: raw.title,
      msgSeq: Number(raw.msgSeq || 0),
      createdBy: { id: raw.createdById, name: raw.createdByName },
    }
    session.expired = session.expireAt <= Date.now()
    session.destroyed = session.status === 'destroyed'
    return session
  }

  async refreshSession(token, { ttlSeconds, expireAt } = {}) {
    const session = await this.getSession(token)
    if (!session) return null
    const next = expireAt || Date.now() + ttlSeconds * 1000
    await this.client
      .multi()
      .hset(this.key.session(token), 'expireAt', String(next))
      .zadd(this.key.index, next, token)
      .exec()
    await this.#pexpireAt(token, next)
    await this.client.pexpireat(this.key.index, next + this.indexGraceMs)
    return { ...session, expireAt: next, expired: false }
  }

  async patchSession(token, patch = {}) {
    const flat = {}
    for (const [key, value] of Object.entries(patch)) {
      flat[key] = String(value)
    }
    if (Object.keys(flat).length) await this.client.hset(this.key.session(token), flat)
    return this.getSession(token)
  }

  async listExpired(now = Date.now(), limit = 200) {
    const tokens = await this.client.zrangebyscore(this.key.index, '-inf', now, 'LIMIT', 0, limit)
    if (!tokens.length) return []
    const out = []
    for (const token of tokens) {
      const session = await this.getSession(token)
      if (session && session.status !== 'destroyed') out.push(session)
    }
    return out
  }

  async nextSeq(token) {
    return this.client.hincrby(this.key.session(token), 'msgSeq', 1)
  }

  async destroySession(token) {
    const k = this.key
    const fileMap = await this.client.hgetall(k.files(token))
    const fileMetas = Object.values(fileMap).map((v) => JSON.parse(v))

    // 用 SCAN 匹配该 Token 的全部 Key，确保「无残留」而不是只删已知的几个
    const pattern = `${this.prefix}:s:${token}*`
    let cursor = '0'
    let keysRemoved = 0
    const doomed = []
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
      cursor = next
      // ioredis 的 scan 结果带 keyPrefix 已还原，需再转回带前缀的真实 key
      for (const key of keys) doomed.push(key)
    } while (cursor !== '0')

    if (doomed.length) {
      // 连接已配置 keyPrefix，命令层无需再次拼接前缀
      const plain = doomed.map((key) => key.replace(`${this.prefix}:`, ''))
      keysRemoved = await this.client.del(...plain)
    }
    await this.client.zrem(k.index, token)
    return { token, existed: fileMetas.length > 0 || keysRemoved > 0, keysRemoved, fileMetas }
  }

  /** 房间名 → 反查（集群模式踢人用） */
  async listSessionTokens() {
    return this.client.zrange(this.key.index, 0, -1)
  }

  // ------------------------------------------------------------- 参与者

  async putParticipant(token, participant) {
    await this.client.hset(this.key.parts(token), participant.id, JSON.stringify(participant))
    return participant
  }

  async removeParticipant(token, participantId) {
    await this.client.hdel(this.key.parts(token), participantId)
  }

  async listParticipants(token) {
    const map = await this.client.hgetall(this.key.parts(token))
    return Object.values(map).map((v) => JSON.parse(v))
  }

  // --------------------------------------------------------------- 消息

  async appendMessage(token, message) {
    const k = this.key
    await this.client
      .pipeline()
      .rpush(k.msgs(token), JSON.stringify(message))
      .ltrim(k.msgs(token), -config.session.maxMessages, -1)
      .exec()
    return message
  }

  async listMessages(token, { limit = 200, before } = {}) {
    const raw = await this.client.lrange(this.key.msgs(token), -config.session.maxMessages, -1)
    let list = raw.map((v) => JSON.parse(v))
    if (before) list = list.filter((m) => m.ts < before)
    return list.slice(-limit)
  }

  async countMessages(token) {
    return this.client.llen(this.key.msgs(token))
  }

  async markRead(token, participantId, upToTs) {
    const k = this.key
    const raw = await this.client.lrange(k.msgs(token), 0, -1)
    let changed = 0
    const pipeline = this.client.pipeline()
    raw.forEach((value, index) => {
      const msg = JSON.parse(value)
      if (msg.ts > upToTs) return
      if (!msg.readBy) msg.readBy = []
      if (msg.readBy.includes(participantId)) return
      msg.readBy.push(participantId)
      changed += 1
      pipeline.lset(k.msgs(token), index, JSON.stringify(msg))
    })
    if (changed) await pipeline.exec()
    return changed
  }

  // --------------------------------------------------------------- 文件

  async putFile(token, meta) {
    await this.client.hset(this.key.files(token), meta.id, JSON.stringify(meta))
    return meta
  }

  async getFile(token, fileId) {
    const raw = await this.client.hget(this.key.files(token), fileId)
    return raw ? JSON.parse(raw) : null
  }

  async listFileMetas(token) {
    const map = await this.client.hgetall(this.key.files(token))
    return Object.values(map).map((v) => JSON.parse(v))
  }

  async deleteFile(token, fileId) {
    return (await this.client.hdel(this.key.files(token), fileId)) > 0
  }

  // --------------------------------------------------------------- 日志

  async writeLog(entry) {
    if (!config.logs.enabled) return
    const key = this.key.log(entry.date)
    await this.client
      .multi()
      .rpush(key, JSON.stringify(entry))
      .ltrim(key, -20_000, -1)
      .expire(key, config.logs.retentionDays * 86400)
      .exec()
  }

  async listLogs(date, limit = 200) {
    const raw = await this.client.lrange(this.key.log(date), -limit, -1)
    return raw.map((v) => JSON.parse(v))
  }

  async stats() {
    const info = await this.client.info('memory')
    const used = /used_memory_human:(\S+)/.exec(info)?.[1]
    const dbSize = await this.client.dbsize()
    const sessions = await this.client.zcard(this.key.index)
    return { driver: this.driver, usedMemory: used, keys: dbSize, sessions }
  }
}

export default RedisStore
