import { reactive, readonly } from 'vue'
import api from '../api/http.js'

const PROFILE_KEY = 'vc.profile'
const LAST_TOKEN_KEY = 'vc.lastToken'
const PARTICIPANT_PREFIX = 'vc.participant.'

const readJSON = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback
  } catch {
    return fallback
  }
}

const writeJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式下 localStorage 可能不可用，忽略 */
  }
}

export const sessionState = reactive({
  config: {
    tokenLength: 8,
    defaultTtlHours: 24,
    expiryTiers: [1, 2, 6, 12, 24, 72],
    maxParticipants: 2,
    maxFileSizeMB: 25,
    maxFilesPerRequest: 9,
    logRetentionDays: 30,
    storageDriver: 'memory',
    loaded: false,
  },
  profile: readJSON(PROFILE_KEY, { name: '', participantId: '' }),
  lastToken: localStorage.getItem(LAST_TOKEN_KEY) || '',
  history: readJSON('vc.history', []),
})

export function setProfile(name) {
  sessionState.profile.name = String(name || '').trim().slice(0, 20)
  writeJSON(PROFILE_KEY, sessionState.profile)
}

/**
 * 记住参与者在某个 Token 下的身份。
 * 存在 sessionStorage：关闭标签页即消失，符合「临时」的产品基调，
 * 但同标签页内刷新 / 断线重连仍能保持同一身份与历史。
 */
export function saveParticipant(token, participant) {
  try {
    sessionStorage.setItem(
      `${PARTICIPANT_PREFIX}${token}`,
      JSON.stringify({ id: participant.id, name: participant.name }),
    )
  } catch {
    /* ignore */
  }
  sessionState.profile.participantId = participant.id
}

export function loadParticipant(token) {
  try {
    return JSON.parse(sessionStorage.getItem(`${PARTICIPANT_PREFIX}${token}`) || 'null')
  } catch {
    return null
  }
}

export function rememberToken(token) {
  sessionState.lastToken = token
  try {
    localStorage.setItem(LAST_TOKEN_KEY, token)
  } catch {
    /* ignore */
  }
}

export function pushHistory(entry) {
  const list = sessionState.history.filter((item) => item.token !== entry.token)
  list.unshift(entry)
  sessionState.history = list.slice(0, 8)
  writeJSON('vc.history', sessionState.history)
}

export function removeHistory(token) {
  sessionState.history = sessionState.history.filter((item) => item.token !== token)
  writeJSON('vc.history', sessionState.history)
}

let configPromise = null
/** 拉取服务端配置（档位、文件上限、存储驱动），全站共享一次请求 */
export async function ensureConfig(force = false) {
  if (sessionState.config.loaded && !force) return sessionState.config
  if (configPromise && !force) return configPromise
  configPromise = api
    .getConfig()
    .then((data) => {
      Object.assign(sessionState.config, data, { loaded: true })
      return sessionState.config
    })
    .catch(() => {
      sessionState.config.loaded = true
      return sessionState.config
    })
    .finally(() => {
      configPromise = null
    })
  return configPromise
}

export const sessionReadonly = readonly(sessionState)
