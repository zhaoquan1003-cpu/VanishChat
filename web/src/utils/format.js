export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

export function formatClock(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 微信式时间分隔：今天显示时间，昨天显示"昨天 HH:mm"，更早显示日期 */
export function formatSeparator(ts) {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return formatClock(ts)

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${formatClock(ts)}`

  const y = d.getFullYear()
  return y === now.getFullYear()
    ? `${d.getMonth() + 1}月${d.getDate()}日 ${formatClock(ts)}`
    : `${y}年${d.getMonth() + 1}月${d.getDate()}日 ${formatClock(ts)}`
}

/** 倒计时 HH:mm:ss（超过 24h 时显示 Nd HH:mm） */
export function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00:00'
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  if (days > 0) return `${days}天${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const EXT_META = {
  pdf: { icon: '📕', color: '#e5484d' },
  doc: { icon: '📘', color: '#2b6cb0' },
  docx: { icon: '📘', color: '#2b6cb0' },
  xls: { icon: '📗', color: '#2f855a' },
  xlsx: { icon: '📗', color: '#2f855a' },
  csv: { icon: '📗', color: '#2f855a' },
  ppt: { icon: '📙', color: '#c05621' },
  pptx: { icon: '📙', color: '#c05621' },
  zip: { icon: '🗜️', color: '#805ad5' },
  rar: { icon: '🗜️', color: '#805ad5' },
  '7z': { icon: '🗜️', color: '#805ad5' },
  txt: { icon: '📄', color: '#718096' },
  md: { icon: '📝', color: '#4a5568' },
  mp3: { icon: '🎵', color: '#38a169' },
  mp4: { icon: '🎬', color: '#3182ce' },
  mov: { icon: '🎬', color: '#3182ce' },
}

export function fileIcon(name = '') {
  const ext = name.split('.').pop()?.toLowerCase()
  return EXT_META[ext] || { icon: '📄', color: '#718096' }
}

export function extLabel(name = '') {
  const ext = name.split('.').pop()
  return ext && ext.length <= 5 && ext !== name ? `.${ext.toUpperCase()}` : '文件'
}

/** 高亮 @ 与链接，让文本气泡具备微信级可读性 */
export function linkify(text = '') {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  })
}
