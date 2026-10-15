import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..', '..')

dotenv.config({ path: path.join(rootDir, '.env') })

const env = process.env

const toInt = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) ? n : fallback
}

const toBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

const toList = (value, fallback) => {
  if (!value) return fallback
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

/** 会话有效期可选档位（小时），前端下拉直接消费 */
const expiryTiers = toList(env.SESSION_EXPIRY_TIERS, ['1', '2', '6', '12', '24', '72']).map(Number)

export const config = {
  rootDir,
  nodeEnv: env.NODE_ENV || 'development',
  port: toInt(env.PORT, 3000),
  corsOrigin: env.CORS_ORIGIN || '*',

  /**
   * 存储驱动：
   *  - 'redis'  强制使用 Redis，连不上直接启动失败（生产建议）
   *  - 'memory' 强制纯内存（单进程演示 / 无 Redis 环境）
   *  - 'auto'   先尝试 Redis，失败自动降级为内存并打印告警（默认）
   */
  storeDriver: (env.STORE_DRIVER || 'auto').toLowerCase(),
  redis: {
    url: env.REDIS_URL || 'redis://127.0.0.1:6379',
    keyPrefix: env.REDIS_KEY_PREFIX || 'vc',
    connectTimeout: toInt(env.REDIS_CONNECT_TIMEOUT, 1500),
  },

  session: {
    tokenLength: toInt(env.TOKEN_LENGTH, 8),
    defaultTtlHours: toInt(env.SESSION_DEFAULT_TTL_HOURS, 24),
    expiryTiers,
    maxTtlHours: toInt(env.SESSION_MAX_TTL_HOURS, 24 * 30),
    maxParticipants: toInt(env.SESSION_MAX_PARTICIPANTS, 2),
    /** 单会话消息条数上限，防止内存被无限撑爆（内存存储尤其重要） */
    maxMessages: toInt(env.SESSION_MAX_MESSAGES, 5000),
    /** 会话空闲多久后允许被回收（0 表示仅按 expireAt 判定） */
    sweepIntervalMs: toInt(env.SESSION_SWEEP_INTERVAL_MS, 30_000),
  },

  upload: {
    dir: env.UPLOAD_DIR ? path.resolve(rootDir, env.UPLOAD_DIR) : path.join(rootDir, 'storage', 'uploads'),
    maxFileSize: toInt(env.MAX_FILE_SIZE_MB, 25) * 1024 * 1024,
    maxFilesPerRequest: toInt(env.MAX_FILES_PER_REQUEST, 9),
  },

  logs: {
    /** 行为日志独立保留周期（天），仅记录行为不记录消息内容 */
    retentionDays: toInt(env.LOG_RETENTION_DAYS, 30),
    enabled: toBool(env.LOG_ENABLED, true),
  },

  rateLimit: {
    /** 单 IP 每分钟可发起的「创建会话」次数 */
    createPerMinute: toInt(env.RATE_CREATE_PER_MINUTE, 10),
    /** 单 IP 每分钟可发起的「校验 Token」次数，防暴力枚举 */
    verifyPerMinute: toInt(env.RATE_VERIFY_PER_MINUTE, 30),
  },
}

export default config
