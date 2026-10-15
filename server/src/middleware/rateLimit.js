/** 极简滑动窗口限流：按 IP + 分组统计，防止 Token 被暴力枚举 / 接口被刷 */
export function rateLimit({ windowMs = 60_000, max = 30, key = 'default' } = {}) {
  const buckets = new Map()

  // 定期清理，避免 Map 无限增长
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [k, hits] of buckets) {
      const alive = hits.filter((t) => now - t < windowMs)
      if (alive.length) buckets.set(k, alive)
      else buckets.delete(k)
    }
  }, windowMs)
  timer.unref?.()

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown'
    const id = `${key}:${ip}`
    const now = Date.now()
    const hits = (buckets.get(id) || []).filter((t) => now - t < windowMs)

    if (hits.length >= max) {
      res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        message: '操作过于频繁，请稍后再试',
      })
      return
    }
    hits.push(now)
    buckets.set(id, hits)
    next()
  }
}

export default rateLimit
