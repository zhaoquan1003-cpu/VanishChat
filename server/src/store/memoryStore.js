import config from '../config.js'

/**
 * 内存存储适配器 —— 进程内实现，零外部依赖。
 * 用于：本地开发 / 无 Redis 环境 / 单元测试。
 *
 * 注意：进程退出即全部丢失，这是「数据不留痕」的极端形态，
 * 但多实例部署时各实例内存不共享，生产请使用 Redis 驱动。
 */
export class MemoryStore {
  constructor() {
    this.driver = 'memory'
    /** @type {Map<string, object>} token -> session */
    this.sessions = new Map()
    /** @type {Map<string, Map<string, object>>} token -> (participantId -> participant) */
    this.participants = new Map()
    /** @type {Map<string, object[]>} token -> messages */
    this.messages = new Map()
    /** @type {Map<string, Map<string, object>>} token -> (fileId -> meta) */
    this.files = new Map()
    /** @type {Map<string, object[]>} date -> log entries */
    this.logs = new Map()
  }

  async init() {
    this.timer = setInterval(() => this.#purgeLogs(), 60 * 60 * 1000)
    this.timer.unref?.()
  }

  async close() {
    if (this.timer) clearInterval(this.timer)
    this.sessions.clear()
    this.participants.clear()
    this.messages.clear()
    this.files.clear()
    this.logs.clear()
  }

  // ---------------------------------------------------------------- 会话

  async createSession(session) {
    this.sessions.set(session.token, { ...session })
    this.participants.set(session.token, new Map())
    this.messages.set(session.token, [])
    this.files.set(session.token, new Map())
    return { ...session }
  }

  async getSession(token) {
    const found = this.sessions.get(token)
    if (!found) return null
    const session = { ...found }
    session.expired = session.expireAt <= Date.now()
    session.destroyed = session.status === 'destroyed'
    return session
  }

  async refreshSession(token, { ttlSeconds, expireAt } = {}) {
    const found = this.sessions.get(token)
    if (!found) return null
    if (expireAt) found.expireAt = expireAt
    if (ttlSeconds) found.expireAt = Date.now() + ttlSeconds * 1000
    return { ...found }
  }

  async patchSession(token, patch = {}) {
    const found = this.sessions.get(token)
    if (!found) return null
    Object.assign(found, patch)
    return { ...found }
  }

  /** 返回 expireAt 已到期、但尚未被清扫的会话（sweeper 消费） */
  async listExpired(now = Date.now(), limit = 200) {
    const out = []
    for (const session of this.sessions.values()) {
      if (session.status === 'destroyed') continue
      if (session.expireAt <= now) {
        out.push({ ...session })
        if (out.length >= limit) break
      }
    }
    return out
  }

  /** 返回所有尚未销毁的 Token（孤儿文件目录 GC 用） */
  async listSessionTokens() {
    return [...this.sessions.values()]
      .filter((s) => s.status !== 'destroyed')
      .map((s) => s.token)
  }

  async nextSeq(token) {
    const found = this.sessions.get(token)
    if (!found) return 0
    found.msgSeq = (found.msgSeq || 0) + 1
    return found.msgSeq
  }

  async destroySession(token) {
    const files = [...(this.files.get(token)?.values() || [])]
    const keysRemoved =
      (this.sessions.has(token) ? 1 : 0) +
      (this.participants.get(token)?.size || 0) +
      (this.messages.get(token)?.length || 0) +
      (this.files.get(token)?.size || 0)

    const existed = this.sessions.delete(token)
    this.participants.delete(token)
    this.messages.delete(token)
    this.files.delete(token)

    return { token, existed, keysRemoved, fileMetas: files }
  }

  // ------------------------------------------------------------- 参与者

  async putParticipant(token, participant) {
    const bucket = this.participants.get(token)
    if (!bucket) return null
    bucket.set(participant.id, { ...participant })
    return { ...participant }
  }

  async removeParticipant(token, participantId) {
    this.participants.get(token)?.delete(participantId)
  }

  async listParticipants(token) {
    return [...(this.participants.get(token)?.values() || [])].map((p) => ({ ...p }))
  }

  // --------------------------------------------------------------- 消息

  async appendMessage(token, message) {
    const list = this.messages.get(token)
    if (!list) return null
    list.push({ ...message })
    if (list.length > config.session.maxMessages) {
      list.splice(0, list.length - config.session.maxMessages)
    }
    return { ...message }
  }

  async listMessages(token, { limit = 200, before } = {}) {
    let list = this.messages.get(token) || []
    if (before) list = list.filter((m) => m.ts < before)
    return list.slice(-limit).map((m) => ({ ...m }))
  }

  async countMessages(token) {
    return this.messages.get(token)?.length || 0
  }

  async markRead(token, participantId, upToTs) {
    const list = this.messages.get(token) || []
    let changed = 0
    for (const msg of list) {
      if (msg.ts > upToTs) continue
      if (!msg.readBy) msg.readBy = []
      if (!msg.readBy.includes(participantId)) {
        msg.readBy.push(participantId)
        changed += 1
      }
    }
    return changed
  }

  // --------------------------------------------------------------- 文件

  async putFile(token, meta) {
    const bucket = this.files.get(token)
    if (!bucket) return null
    bucket.set(meta.id, { ...meta })
    return { ...meta }
  }

  async getFile(token, fileId) {
    const meta = this.files.get(token)?.get(fileId)
    return meta ? { ...meta } : null
  }

  async listFileMetas(token) {
    return [...(this.files.get(token)?.values() || [])].map((f) => ({ ...f }))
  }

  async deleteFile(token, fileId) {
    return this.files.get(token)?.delete(fileId) || false
  }

  // --------------------------------------------------------------- 日志

  async writeLog(entry) {
    if (!config.logs.enabled) return
    const date = entry.date
    if (!this.logs.has(date)) this.logs.set(date, [])
    const bucket = this.logs.get(date)
    bucket.push(entry)
    if (bucket.length > 5000) bucket.shift()
  }

  async listLogs(date, limit = 200) {
    return (this.logs.get(date) || []).slice(-limit)
  }

  async stats() {
    return {
      driver: this.driver,
      sessions: this.sessions.size,
      messages: [...this.messages.values()].reduce((n, l) => n + l.length, 0),
      files: [...this.files.values()].reduce((n, m) => n + m.size, 0),
    }
  }

  #purgeLogs() {
    const cutoff = new Date(Date.now() - config.logs.retentionDays * 86400_000)
      .toISOString()
      .slice(0, 10)
    for (const date of this.logs.keys()) {
      if (date < cutoff) this.logs.delete(date)
    }
  }
}

export default MemoryStore
