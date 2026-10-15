import { computed, reactive, ref } from 'vue'
import { io } from 'socket.io-client'
import { saveParticipant, loadParticipant, sessionState } from '../store/session.js'

/**
 * 聊天内核：封装 Socket.io 连接、房间加入、消息收发、断线重连。
 *
 * 关键约定
 * · 断线自动重连时带着 participantId 重新 join，服务端会复用同一席位，
 *   因此「刷新 / 熄屏 / 切后台回来」都不会丢身份与历史。
 * · 本地占位消息（pending）与服务器消息通过 localId 对齐，
 *   实现微信式的「先插一条灰条 → 上传/发送成功后就地变实」。
 */
export function useChat() {
  const state = reactive({
    status: 'idle', // idle | connecting | connected | reconnecting | destroyed | error
    session: null,
    participant: null,
    participants: [],
    messages: [],
    pending: [],
    typingName: '',
    expireAt: 0,
    error: '',
    destroyReason: '',
    lastReadTs: 0,
    networkOnline: navigator.onLine !== false,
  })

  const token = ref('')
  let socket = null
  let pingTimer = null
  let typingTimer = null
  let typingFlag = false
  let manualClose = false

  const selfId = computed(() => state.participant?.id || '')
  const others = computed(() => state.participants.filter((p) => p.id !== selfId.value))
  const peerOnline = computed(() => others.value.some((p) => p.online))
  const onlineCount = computed(() => state.participants.filter((p) => p.online).length)
  const isSelf = (message) => !!message && message.senderId === selfId.value

  function upsertMessage(message) {
    if (!message) return
    if (message.localId) {
      const idx = state.pending.findIndex((p) => p.localId === message.localId)
      if (idx >= 0) state.pending.splice(idx, 1)
    }
    const idx = state.messages.findIndex((m) => m.id === message.id)
    if (idx >= 0) {
      state.messages[idx] = message
      return
    }
    const last = state.messages[state.messages.length - 1]
    if (!last || message.seq >= last.seq) state.messages.push(message)
    else {
      const at = state.messages.findIndex((m) => m.seq > message.seq)
      state.messages.splice(at < 0 ? state.messages.length : at, 0, message)
    }
    if (state.messages.length > 3000) state.messages.splice(0, state.messages.length - 3000)
  }

  function reset() {
    state.session = null
    state.participant = null
    state.participants = []
    state.messages = []
    state.pending = []
    state.typingName = ''
    state.expireAt = 0
    state.lastReadTs = 0
  }

  /** 建立连接并加入房间，返回服务端下发的会话快照 */
  function connect({ token: tk, name } = {}) {
    token.value = String(tk || '').trim()
    manualClose = false
    reset()
    state.status = state.status === 'connected' ? 'reconnecting' : 'connecting'
    state.error = ''

    if (socket) {
      socket.removeAllListeners()
      socket.disconnect()
      socket = null
    }

    socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 700,
      reconnectionDelayMax: 6000,
      reconnectionAttempts: Infinity,
      timeout: 12000,
    })

    socket.on('connect', () => {
      const remembered = loadParticipant(token.value)
      socket.emit(
        'session:join',
        {
          token: token.value,
          participantId: remembered?.id,
          name: name || remembered?.name || sessionState.profile.name,
        },
        (res) => {
          if (!res?.ok) {
            state.status = res?.code === 'SESSION_EXPIRED' || res?.code === 'SESSION_DESTROYED'
              ? 'destroyed'
              : 'error'
            state.error = res?.message || '加入会话失败'
            return
          }
          state.status = 'connected'
          state.session = res.session
          state.participant = res.participant
          state.participants = res.participants || []
          state.expireAt = res.session.expireAt
          state.messages = res.messages || []
          saveParticipant(token.value, res.participant)
        },
      )
    })

    socket.on('disconnect', (reason) => {
      if (manualClose) return
      state.status = 'reconnecting'
      state.error = `连接已断开（${reason}），正在重连…`
    })

    socket.on('connect_error', (err) => {
      state.status = 'reconnecting'
      state.error = `连接失败：${err.message}`
    })

    socket.io.on('reconnect', () => {
      state.error = ''
    })

    socket.on('msg:new', ({ message }) => upsertMessage(message))

    socket.on('presence:update', ({ participants, onlineCount: count }) => {
      state.participants = participants || []
      if (typeof count === 'number' && count <= 1) state.typingName = ''
    })

    socket.on('typing', ({ participantId, name, typing }) => {
      if (participantId === selfId.value) return
      state.typingName = typing ? name || '对方' : ''
    })

    socket.on('msg:read', ({ upToTs }) => {
      state.lastReadTs = Math.max(state.lastReadTs, Number(upToTs) || 0)
    })

    socket.on('session:tick', ({ expireAt }) => {
      if (expireAt) state.expireAt = expireAt
    })

    socket.on('session:destroyed', ({ reason }) => {
      state.status = 'destroyed'
      state.destroyReason = reason
      state.participants = []
      disconnect(false)
    })

    socket.on('error', ({ code, message }) => {
      if (code === 'SESSION_EXPIRED' || code === 'SESSION_DESTROYED') {
        state.status = 'destroyed'
        state.destroyReason = code === 'SESSION_EXPIRED' ? 'expired' : 'manual'
      }
      state.error = message || '发生错误'
    })

    // 心跳：维持在线状态并同步剩余有效期
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = setInterval(() => {
      if (socket?.connected && state.status === 'connected') socket.emit('presence:ping')
    }, 45_000)

    const onNetwork = () => {
      state.networkOnline = navigator.onLine !== false
      if (state.networkOnline && socket && !socket.connected && !manualClose) socket.connect()
    }
    window.addEventListener('online', onNetwork)
    window.addEventListener('offline', onNetwork)

    return new Promise((resolve) => {
      const off = () => {
        socket?.off('session:ready', off)
      }
      const wait = setInterval(() => {
        if (state.status === 'connected' || state.status === 'error' || state.status === 'destroyed') {
          clearInterval(wait)
          off()
          resolve(state.status)
        }
      }, 80)
      setTimeout(() => clearInterval(wait), 15_000)
    })
  }

  function disconnect(close = true) {
    manualClose = close
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = null
    if (socket) {
      if (close) socket.emit('session:leave')
      socket.removeAllListeners()
      socket.disconnect()
      socket = null
    }
    if (close) state.status = 'idle'
  }

  // ------------------------------------------------------------ 发送相关

  function addPending(item) {
    state.pending.push(item)
    return item
  }

  function updatePending(localId, patch) {
    const found = state.pending.find((p) => p.localId === localId)
    if (found) Object.assign(found, patch)
  }

  function removePending(localId) {
    const idx = state.pending.findIndex((p) => p.localId === localId)
    if (idx >= 0) state.pending.splice(idx, 1)
  }

  /** 发送消息（文本 / 多媒体统一入口），返回 Promise<message> */
  function send(payload) {
    return new Promise((resolve, reject) => {
      if (!socket || state.status !== 'connected') {
        reject(new Error('尚未连接，请稍候重试'))
        return
      }
      socket.emit('msg:send', payload, (res) => {
        if (res?.ok) resolve(res.message)
        else reject(new Error(res?.message || '发送失败'))
      })
    })
  }

  function sendText(content, localId) {
    return send({ type: 'text', content, localId })
  }

  /** 输入状态节流广播：最多 2.5s 一次，停止输入 1.8s 后自动置为 false */
  function setTyping(typing) {
    if (!socket || state.status !== 'connected') return
    if (typing && !typingFlag) {
      typingFlag = true
      socket.emit('typing', { typing: true })
    }
    if (typingTimer) clearTimeout(typingTimer)
    typingTimer = setTimeout(() => {
      typingFlag = false
      socket?.emit('typing', { typing: false })
    }, 1800)
  }

  function markRead(upToTs) {
    if (!socket || state.status !== 'connected') return
    socket.emit('msg:read', { upToTs: upToTs || Date.now() })
  }

  /** 主动销毁会话（全链路删除） */
  function destroySession(reason = 'manual') {
    return new Promise((resolve) => {
      if (!socket || !socket.connected) {
        resolve({ ok: false })
        return
      }
      socket.emit('session:destroy', { reason }, (res) => {
        state.status = 'destroyed'
        state.destroyReason = reason
        resolve(res || { ok: false })
      })
    })
  }

  return {
    state,
    token,
    selfId,
    others,
    peerOnline,
    onlineCount,
    isSelf,
    connect,
    disconnect,
    send,
    sendText,
    setTyping,
    markRead,
    destroySession,
    addPending,
    updatePending,
    removePending,
    upsertMessage,
  }
}

export default useChat
