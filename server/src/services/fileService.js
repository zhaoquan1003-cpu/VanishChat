import fs from 'node:fs/promises'
import path from 'node:path'
import config from '../config.js'
import { logger } from '../utils/logger.js'
import { shortId } from '../utils/token.js'

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif', '.avif'])
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.3gp'])
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.amr', '.opus', '.flac'])

/**
 * 文件服务 —— 「会话绑定 + 临时存储」的落地实现。
 *
 * 目录结构：
 *   storage/tmp/<random>            上传落地的暂存区（校验会话前的缓冲区）
 *   storage/uploads/<token>/<id>    正式存放区，一个会话一个目录
 *
 * 会话销毁时整目录递归删除，保证物理层零残留。
 */
export class FileService {
  constructor() {
    this.root = config.upload.dir
    this.staging = path.join(path.dirname(this.root), 'tmp')
  }

  async init() {
    await fs.mkdir(this.root, { recursive: true })
    await fs.mkdir(this.staging, { recursive: true })
    await this.gcStaging(0)
  }

  tokenDir(token) {
    return path.join(this.root, token)
  }

  /** 多媒体类型归类，决定前端渲染方式 */
  categorize(mime = '', filename = '') {
    const ext = path.extname(filename || '').toLowerCase()
    const lower = String(mime).toLowerCase()
    if (lower.startsWith('image/') || IMAGE_EXT.has(ext)) return 'image'
    if (lower.startsWith('video/') || VIDEO_EXT.has(ext)) return 'video'
    if (lower.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio'
    return 'file'
  }

  /**
   * 把暂存文件搬入会话目录并登记元数据。
   * 失败时清理暂存文件，避免 tmp 目录堆积。
   */
  async persist(token, staged, { uploadedBy } = {}) {
    const ext = path.extname(staged.originalname || '').slice(0, 12).replace(/[^.a-zA-Z0-9]/g, '')
    const id = shortId('f')
    const dir = this.tokenDir(token)
    await fs.mkdir(dir, { recursive: true })

    const target = path.join(dir, `${id}${ext}`)
    try {
      await fs.rename(staged.path, target)
    } catch {
      // 跨盘符等情况 rename 失败，降级为复制 + 删除
      await fs.copyFile(staged.path, target)
      await fs.rm(staged.path, { force: true })
    }

    return {
      id,
      token,
      name: (staged.originalname || '未命名文件').slice(0, 180),
      size: staged.size,
      mime: staged.mimetype || 'application/octet-stream',
      ext,
      category: this.categorize(staged.mimetype, staged.originalname),
      storedName: path.basename(target),
      uploadedBy: uploadedBy || null,
      uploadedAt: Date.now(),
    }
  }

  /** 元数据 → 磁盘绝对路径（带穿越防护） */
  resolvePath(meta) {
    if (!meta || !meta.storedName) return null
    const name = path.basename(meta.storedName)
    const dir = this.tokenDir(path.basename(meta.token))
    const full = path.join(dir, name)
    if (!full.startsWith(dir)) return null
    return full
  }

  /** 会话销毁时递归删除整个会话目录 */
  async purgeSessionFiles(token, fileMetas = []) {
    const dir = this.tokenDir(path.basename(token))
    let removed = 0
    for (const meta of fileMetas) {
      if (await this.#fileExists(this.resolvePath(meta))) removed += 1
    }
    await fs.rm(dir, { recursive: true, force: true })
    return removed
  }

  /**
   * 孤儿目录回收 —— 兜底安全网。
   * 进程在会话过期时刻不在线时，Redis TTL 仍会清数据，但磁盘文件需要靠这里补删。
   */
  async gcOrphans(activeTokens) {
    const active = new Set(activeTokens)
    let entries = []
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true })
    } catch {
      return 0
    }
    let removed = 0
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (active.has(entry.name)) continue
      await fs.rm(path.join(this.root, entry.name), { recursive: true, force: true })
      removed += 1
    }
    if (removed) logger.warn(`孤儿文件目录回收：清理 ${removed} 个已销毁会话的残留目录`)
    return removed
  }

  async diskUsage() {
    let bytes = 0
    let files = 0
    const walk = async (dir) => {
      let entries = []
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else {
          try {
            const stat = await fs.stat(full)
            bytes += stat.size
            files += 1
          } catch {
            /* 忽略瞬时文件 */
          }
        }
      }
    }
    await walk(this.root)
    return { bytes, files }
  }

  async #fileExists(file) {
    if (!file) return false
    try {
      await fs.access(file)
      return true
    } catch {
      return false
    }
  }

  /** 清理上传暂存区：maxAgeMs=0 表示全清（启动时），否则只清超龄文件（中断的上传） */
  async gcStaging(maxAgeMs = 0) {
    try {
      const entries = await fs.readdir(this.staging, { withFileTypes: true })
      const now = Date.now()
      let removed = 0
      await Promise.all(
        entries.map(async (entry) => {
          const full = path.join(this.staging, entry.name)
          if (maxAgeMs > 0) {
            try {
              const stat = await fs.stat(full)
              if (now - stat.mtimeMs < maxAgeMs) return
            } catch {
              return
            }
          }
          await fs.rm(full, { force: true, recursive: true })
          removed += 1
        }),
      )
      if (removed) logger.info(`清理上传暂存区 ${removed} 个残留文件`)
      return removed
    } catch {
      return 0
    }
  }
}

export const fileService = new FileService()
export default FileService
