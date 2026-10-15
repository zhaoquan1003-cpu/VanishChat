import multer from 'multer'
import config from '../config.js'
import { logger } from '../utils/logger.js'

export const notFound = (req, res) => {
  res.status(404).json({ ok: false, code: 'NOT_FOUND', message: `无此接口：${req.method} ${req.path}` })
}

export const errorHandler = (err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const map = {
      LIMIT_FILE_SIZE: `文件超过 ${Math.round(config.upload.maxFileSize / 1024 / 1024)}MB 上限`,
      LIMIT_FILE_COUNT: `单次最多上传 ${config.upload.maxFilesPerRequest} 个文件`,
      LIMIT_UNEXPECTED_FILE: '上传字段不合法',
    }
    res.status(413).json({
      ok: false,
      code: err.code,
      message: map[err.code] || `上传失败：${err.message}`,
    })
    return
  }

  const status = err.status || 500
  if (status >= 500) logger.error(`${req.method} ${req.path} → ${err.message}\n${err.stack}`)

  res.status(status).json({
    ok: false,
    code: err.code || 'INTERNAL_ERROR',
    message: status >= 500 ? '服务器开小差了，请稍后再试' : err.message,
  })
}

export default errorHandler
