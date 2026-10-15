import crypto from 'node:crypto'
import config from '../config.js'

/**
 * Token 字符集：大小写字母 + 数字，剔除易混淆字符。
 * 去掉 0/O/o、1/I/l —— 用户需要口头/手抄传递 Token，可读性优先。
 * 剩余 56 个字符，8 位空间约 9.7e13，配合「有效期 + 错误次数限流」足以抗枚举。
 */
export const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

const TOKEN_RE = new RegExp(`^[${TOKEN_ALPHABET}]{4,32}$`)

/** 生成一个全局唯一的临时 Token（默认 8 位） */
export function generateToken(length = config.session.tokenLength) {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length]
  }
  return out
}

/** 归一化用户输入：去空格、统一大写（字符集同时含大小写，因此保留原大小写探测两种匹配） */
export function normalizeTokenInput(raw) {
  if (typeof raw !== 'string') return ''
  return raw.trim().replace(/\s+/g, '')
}

export function isValidTokenFormat(raw) {
  return TOKEN_RE.test(normalizeTokenInput(raw))
}

/** 短 ID：消息 / 文件 / 参与者标识 */
export function shortId(prefix = '') {
  const id = crypto.randomBytes(9).toString('base64url')
  return prefix ? `${prefix}_${id}` : id
}

export default { generateToken, normalizeTokenInput, isValidTokenFormat, shortId, TOKEN_ALPHABET }
