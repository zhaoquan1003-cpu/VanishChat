import config from '../config.js'
import { logger } from '../utils/logger.js'
import MemoryStore from './memoryStore.js'
import RedisStore from './redisStore.js'

/**
 * 存储适配层工厂。
 * 上层业务（会话/消息/文件/清扫）只依赖统一接口，不感知底层是 Redis 还是内存。
 */
export async function createStore() {
  const driver = (config.storeDriver || 'auto').toLowerCase()

  if (driver === 'memory') {
    const store = new MemoryStore()
    await store.init()
    logger.warn('存储驱动：内存（进程内）。数据仅存活于当前进程，适合本地开发与演示。')
    return store
  }

  const redis = new RedisStore()
  redis.client.on('error', (err) => {
    logger.error(`Redis 连接异常：${err.message}`)
  })

  try {
    await redis.init()
    logger.info(`存储驱动：Redis 7.x（${config.redis.url}）—— 纯内存存储，支持 TTL 自动过期`)
    return redis
  } catch (err) {
    await redis.close().catch(() => {})

    if (driver === 'redis') {
      logger.error(`强制使用 Redis 但连接失败：${err.message}`)
      throw err
    }

    logger.warn(`Redis 不可用（${err.message}），已自动降级为内存存储`)
    const store = new MemoryStore()
    await store.init()
    return store
  }
}

export default createStore
