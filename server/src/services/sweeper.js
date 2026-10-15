import config from '../config.js'
import { logger } from '../utils/logger.js'

/**
 * 过期清扫器 —— 全链路自动销毁的触发器。
 *
 * 设计要点：
 * 1. 存储层（Redis TTL / 内存 expireAt）已经能保证「数据读不到」，
 *    清扫器负责的是「数据被真正抹掉」：批量删键 + 物理删文件 + 踢出房间。
 * 2. 每秒轮询成本过高，30s 一轮足够；即便进程在过期瞬间不在线，
 *    重启后首轮扫描会立刻补上（Redis 索引 ZSET 有 24h 宽限期）。
 * 3. 每 10 轮做一次孤儿目录 GC，兜底任何异常路径留下的磁盘残留。
 */
export class Sweeper {
  constructor({ store, sessionService, fileService }) {
    this.store = store
    this.sessionService = sessionService
    this.fileService = fileService
    this.round = 0
    this.running = false
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.tick().catch((err) => logger.error(`清扫异常：${err.message}`))
    }, config.session.sweepIntervalMs)
    this.timer.unref?.()
    logger.info(`过期清扫器已启动，间隔 ${config.session.sweepIntervalMs / 1000}s`)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick() {
    if (this.running) return { skipped: true }
    this.running = true
    try {
      this.round += 1
      const expired = await this.store.listExpired(Date.now(), 200)
      for (const session of expired) {
        try {
          await this.sessionService.destroy(session.token, 'expired')
        } catch (err) {
          logger.error(`销毁会话 ${session.token} 失败：${err.message}`)
        }
      }

      if (this.round % 10 === 1) {
        const active = await this.store.listSessionTokens()
        await this.fileService.gcOrphans(active)
      }

      // 每轮顺带清理中断的上传残留（>1h），暂存区不会长期堆积
      await this.fileService.gcStaging(60 * 60 * 1000)

      return { expired: expired.length }
    } finally {
      this.running = false
    }
  }
}

export default Sweeper
