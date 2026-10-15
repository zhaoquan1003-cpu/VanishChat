import { ref } from 'vue'

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif']
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', '3gp']
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'amr', 'opus', 'flac']

export function classify(file) {
  const ext = (file?.name || '').split('.').pop()?.toLowerCase() || ''
  const mime = (file?.type || '').toLowerCase()
  if (mime.startsWith('image/') || IMAGE_EXT.includes(ext)) return 'image'
  if (mime.startsWith('video/') || VIDEO_EXT.includes(ext)) return 'video'
  if (mime.startsWith('audio/') || AUDIO_EXT.includes(ext)) return 'audio'
  return 'file'
}

/** 读取图片宽高，让气泡按真实比例渲染，避免"图片跳一下" */
export function probeImage(file) {
  return new Promise((resolve) => {
    if (classify(file) !== 'image') {
      resolve(null)
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    const done = (result) => {
      img.onload = img.onerror = null
      resolve(result)
    }
    img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight, previewUrl: url })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      done(null)
    }
    img.src = url
  })
}

/** 读取音视频时长（秒） */
export function probeDuration(file) {
  const category = classify(file)
  if (category !== 'video' && category !== 'audio') return Promise.resolve(null)
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement(category === 'video' ? 'video' : 'audio')
    const finish = (value) => {
      el.onloadedmetadata = el.onerror = null
      if (category === 'video') URL.revokeObjectURL(url)
      resolve(value)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      const duration = Number.isFinite(el.duration) ? el.duration : null
      if (category === 'video') {
        finish({ duration, width: el.videoWidth, height: el.videoHeight, previewUrl: url })
      } else {
        finish({ duration, previewUrl: url })
      }
    }
    el.onerror = () => finish({ duration: null })
    el.src = url
  })
}

/**
 * 文件上传（HTTP 通道，绑定会话）。
 * 用 XHR 而非 fetch 是因为需要上传进度事件 —— 移动端弱网下进度是刚需。
 */
export function useUpload() {
  const tasks = ref([])

  function upload(token, file, { participantId, onProgress, signal } = {}) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const form = new FormData()
      form.append('file', file, file.name || `file-${Date.now()}`)
      form.append('token', token)
      if (participantId) form.append('participantId', participantId)

      xhr.open('POST', '/api/upload', true)
      xhr.responseType = 'text'

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.min(0.999, event.loaded / event.total), event.loaded, event.total)
        }
      }

      xhr.onload = () => {
        let payload = null
        try {
          payload = JSON.parse(xhr.responseText || '{}')
        } catch {
          payload = null
        }
        if (xhr.status >= 200 && xhr.status < 300 && payload?.ok) {
          onProgress?.(1, file.size, file.size)
          resolve(payload.data[0])
        } else {
          const err = new Error(payload?.message || `上传失败（${xhr.status}）`)
          err.code = payload?.code || `HTTP_${xhr.status}`
          reject(err)
        }
      }

      xhr.onerror = () => reject(Object.assign(new Error('网络异常，上传中断'), { code: 'NETWORK_ERROR' }))
      xhr.ontimeout = () => reject(Object.assign(new Error('上传超时，请重试'), { code: 'TIMEOUT' }))
      xhr.onabort = () => reject(Object.assign(new Error('已取消上传'), { code: 'ABORTED' }))

      if (signal) {
        if (signal.aborted) {
          xhr.abort()
          return
        }
        signal.addEventListener('abort', () => xhr.abort(), { once: true })
      }

      xhr.send(form)
      resolve.abort = () => xhr.abort()
    })
  }

  return { tasks, upload }
}

export default useUpload
