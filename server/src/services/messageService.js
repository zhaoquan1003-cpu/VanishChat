import { shortId } from '../utils/token.js'

export const MESSAGE_TYPES = ['text', 'image', 'video', 'audio', 'file', 'system']

const MAX_TEXT_LENGTH = 4000

export class MessageError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
    this.status = 400
  }
}

/**
 * 消息服务：校验 → 补全元数据 → 写入临时存储（仅内存）。
 * 服务端始终重新生成 id / seq / ts，不信任客户端时间戳。
 */
export class MessageService {
  constructor(store) {
    this.store = store
  }

  async #build(token, payload, participant) {
    const type = payload?.type || 'text'
    if (!MESSAGE_TYPES.includes(type)) {
      throw new MessageError('INVALID_TYPE', `不支持的消息类型：${type}`)
    }

    const base = {
      id: shortId('m'),
      token,
      type,
      seq: await this.store.nextSeq(token),
      ts: Date.now(),
      senderId: participant.id,
      senderName: participant.name,
      localId: typeof payload?.localId === 'string' ? payload.localId.slice(0, 64) : undefined,
      readBy: [participant.id],
    }

    if (type === 'text') {
      const content = String(payload?.content ?? '').slice(0, MAX_TEXT_LENGTH)
      if (!content.trim()) throw new MessageError('EMPTY_MESSAGE', '消息内容为空')
      return { ...base, content }
    }

    if (type === 'system') {
      return { ...base, senderId: 'system', content: String(payload?.content ?? '').slice(0, 500) }
    }

    // 多媒体消息必须携带已登记的 fileId，防止跨会话引用
    const fileId = payload?.file?.id
    if (!fileId) throw new MessageError('FILE_REQUIRED', '缺少文件标识')
    const meta = await this.store.getFile(token, fileId)
    if (!meta) throw new MessageError('FILE_NOT_FOUND', '文件不存在或不属于当前会话')

    return {
      ...base,
      content: String(payload?.content ?? '').slice(0, 500),
      file: {
        id: meta.id,
        name: meta.name,
        size: meta.size,
        mime: meta.mime,
        category: meta.category,
        url: `/api/file/${token}/${meta.id}`,
        thumbnail: meta.thumbnail || undefined,
        width: payload?.file?.width,
        height: payload?.file?.height,
        duration: payload?.file?.duration,
      },
    }
  }

  async send(token, payload, participant) {
    const message = await this.#build(token, payload, participant)
    await this.store.appendMessage(token, message)
    return message
  }

  async list(token, { limit = 200, before } = {}) {
    return this.store.listMessages(token, { limit, before })
  }

  async system(token, content) {
    const message = {
      id: shortId('sys'),
      token,
      type: 'system',
      seq: await this.store.nextSeq(token),
      ts: Date.now(),
      senderId: 'system',
      senderName: '系统',
      content,
      readBy: [],
    }
    await this.store.appendMessage(token, message)
    return message
  }

  async markRead(token, participantId, upToTs) {
    return this.store.markRead(token, participantId, upToTs)
  }
}

export default MessageService
