import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import config from '../config.js'
import { shortId, normalizeTokenInput } from '../utils/token.js'
import { logService } from '../services/logService.js'

/**
 * 多媒体模块 HTTP 接口
 *   POST   /api/upload                       上传文件（HTTP 通道，绑定会话）
 *   GET    /api/file/:token/:fileId          读取文件（支持 Range，视频可拖拽）
 *   DELETE /api/upload/:token/:fileId        取消上传 / 删除单个文件
 *
 * 上传采用「HTTP 上传 + WS 信令」：文件走 HTTP（可断点/可进度），
 * 上传成功后前端通过 WebSocket 发一条携带 fileId 的消息完成投递。
 * 文件生命周期与会话强绑定 —— 会话销毁时目录被递归删除。
 */
export function mediaRoutes(ctx) {
  const router = Router()
  const { sessionService, fileService, store } = ctx

  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, fileService.staging),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 12).replace(/[^.a-zA-Z0-9]/g, '')
      cb(null, `${shortId('tmp')}${ext}`)
    },
  })

  const upload = multer({
    storage,
    // busboy 默认按 latin1 解析 filename，中文文件名会变成乱码；
    // 浏览器实际发送的是 UTF-8，这里显式声明，保证「产品方案V2.pdf」不乱码
    defParamCharset: 'utf8',
    limits: {
      fileSize: config.upload.maxFileSize,
      files: config.upload.maxFilesPerRequest,
    },
  })

  const dropStaged = async (files = []) => {
    await Promise.all(files.map((f) => fsp.rm(f.path, { force: true }).catch(() => {})))
  }

  router.post('/upload', upload.array('file', config.upload.maxFilesPerRequest), async (req, res, next) => {
    const files = req.files || []
    try {
      const rawToken = req.body?.token || req.query?.token || req.headers['x-session-token']
      const token = normalizeTokenInput(rawToken)
      const session = await sessionService.requireActive(token)

      if (!files.length) {
        const err = new Error('未收到文件')
        err.code = 'NO_FILE'
        err.status = 400
        throw err
      }

      const uploadedBy = req.body?.participantId || null
      const metas = []
      for (const file of files) {
        const meta = await fileService.persist(session.token, file, { uploadedBy })
        await store.putFile(session.token, meta)
        metas.push(meta)
      }

      await logService.write({
        action: 'file.upload',
        token: session.token,
        count: metas.length,
        bytes: metas.reduce((n, m) => n + m.size, 0),
        categories: [...new Set(metas.map((m) => m.category))],
        ip: req.ip,
      })

      res.status(201).json({
        ok: true,
        data: metas.map((m) => ({
          id: m.id,
          name: m.name,
          size: m.size,
          mime: m.mime,
          category: m.category,
          url: `/api/file/${session.token}/${m.id}`,
        })),
      })
    } catch (err) {
      await dropStaged(files)
      next(err)
    }
  })

  router.get('/file/:token/:fileId', async (req, res, next) => {
    try {
      // 会话已销毁 → 文件即时不可访问，这是「退出即销毁」的必要条件
      const session = await sessionService.requireActive(req.params.token)
      const meta = await store.getFile(session.token, req.params.fileId)
      if (!meta) {
        res.status(404).json({ ok: false, code: 'FILE_NOT_FOUND', message: '文件不存在或已随会话销毁' })
        return
      }

      const full = fileService.resolvePath(meta)
      if (!full) {
        res.status(500).json({ ok: false, code: 'BAD_PATH', message: '文件路径异常' })
        return
      }

      let stat
      try {
        stat = await fsp.stat(full)
      } catch {
        res.status(410).json({ ok: false, code: 'FILE_GONE', message: '文件已被删除' })
        return
      }

      res.setHeader('Content-Type', meta.mime || 'application/octet-stream')
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('Cache-Control', 'no-store, private, max-age=0')
      res.setHeader(
        'Content-Disposition',
        `${meta.category === 'file' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      )

      const range = req.headers.range
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range)
        if (match) {
          const start = match[1] ? Number(match[1]) : 0
          const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1
          if (start >= stat.size || start > end) {
            res.status(416).setHeader('Content-Range', `bytes */${stat.size}`)
            res.end()
            return
          }
          res.status(206)
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
          res.setHeader('Content-Length', String(end - start + 1))
          fs.createReadStream(full, { start, end }).pipe(res)
          return
        }
      }

      res.setHeader('Content-Length', String(stat.size))
      fs.createReadStream(full).pipe(res)
    } catch (err) {
      next(err)
    }
  })

  router.delete('/upload/:token/:fileId', async (req, res, next) => {
    try {
      const session = await sessionService.requireActive(req.params.token)
      const meta = await store.getFile(session.token, req.params.fileId)
      if (!meta) {
        res.json({ ok: true, data: { deleted: false } })
        return
      }
      const full = fileService.resolvePath(meta)
      if (full) await fsp.rm(full, { force: true }).catch(() => {})
      await store.deleteFile(session.token, meta.id)
      res.json({ ok: true, data: { deleted: true, id: meta.id } })
    } catch (err) {
      next(err)
    }
  })

  return router
}

export default mediaRoutes
