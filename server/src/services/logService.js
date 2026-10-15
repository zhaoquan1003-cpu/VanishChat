import config from '../config.js'
import { storeRef } from './storeRef.js'

const today = () => new Date().toISOString().slice(0, 10)

/**
 * 行为日志服务。
 *
 * 硬性约束：只记录「谁在什么时候做了什么」，绝不写入消息正文、
 * 文件名以外的内容、也不落 Token 与消息的对应关系明细。
 * 日志保留周期独立于会话（默认 30 天）。
 */
export class LogService {
  async write(entry) {
    if (!config.logs.enabled) return
    const store = storeRef.current
    if (!store) return
    const record = {
      date: today(),
      ts: Date.now(),
      ...entry,
    }
    // 双保险：剥离可能被误传的消息内容字段
    delete record.content
    delete record.message
    try {
      await store.writeLog(record)
    } catch {
      /* 日志失败绝不影响主流程 */
    }
  }

  async list(date = today(), limit = 200) {
    const store = storeRef.current
    if (!store) return []
    return store.listLogs(date, limit)
  }
}

export const logService = new LogService()
export default logService
