<template>
  <div class="app-shell chat">
    <NavBar :title="navTitle" :subtitle="navSubtitle" :dot="true" :dot-on="peerOnline" back @back="goHome">
      <template #right>
        <button class="nav-action" @click="showMenu">···</button>
      </template>
    </NavBar>

    <!-- 连接状态条 -->
    <Transition name="slide-fade">
      <div v-if="banner" class="banner" :class="banner.tone">
        <span>{{ banner.text }}</span>
        <button v-if="banner.retry" @click="reconnect">重试</button>
      </div>
    </Transition>

    <!-- 有效期倒计时条：让"临时"这件事始终可见 -->
    <div v-if="state.status === 'connected'" class="expire-bar" :class="{ warn: remainingMs < 10 * 60 * 1000 }">
      <span class="expire-icon">⏳</span>
      <span>会话剩余 {{ countdownText }}</span>
      <span class="expire-sep">·</span>
      <span>Token {{ token }}</span>
    </div>

    <MessageList
      ref="listRef"
      :messages="state.messages"
      :pending="state.pending"
      :self-id="selfId"
      :last-read-ts="state.lastReadTs"
      :typing-name="state.typingName"
      :peer-online="peerOnline"
      @open-media="openViewer"
      @retry="retryPending"
      @cancel="cancelPending"
    />

    <div class="input-wrap" :style="{ paddingBottom: activePanel ? '0px' : 'var(--safe-bottom)' }">
      <ChatInput
        ref="inputRef"
        :disabled="state.status !== 'connected'"
        :placeholder="inputPlaceholder"
        @send="sendText"
        @typing="onTyping"
        @pick-files="handleFiles"
        @toggle-panel="togglePanel"
        @notify="notify"
        @recorded="handleRecorded"
        @focus-change="onInputFocus"
      />
    </div>

    <EmojiPanel v-if="activePanel === 'emoji'" @pick="insertEmoji" />
    <PlusPanel
      v-else-if="activePanel === 'plus'"
      :max-size-m-b="config.maxFileSizeMB"
      :max-files="config.maxFilesPerRequest"
      @pick="onPanelPick"
    />

    <MediaViewer
      :visible="viewer.visible"
      :message="viewer.message"
      :kind="viewer.kind"
      @close="viewer.visible = false"
    />

    <!-- 会话终结浮层 -->
    <Transition name="fade">
      <div v-if="state.status === 'destroyed'" class="overlay">
        <div class="overlay-card">
          <span class="overlay-icon">🕳️</span>
          <h3>{{ destroyTitle }}</h3>
          <p>{{ destroyDesc }}</p>
          <ul class="overlay-list">
            <li>内存中的会话数据已清空</li>
            <li>上传的图片 / 文件已物理删除</li>
            <li>服务端未保留任何消息副本</li>
          </ul>
          <button class="wx-btn-primary" @click="goHome">返回首页</button>
        </div>
      </div>
    </Transition>

    <!-- 上传队列角标 -->
    <div v-if="uploadingCount > 0" class="upload-badge">{{ uploadingCount }} 个文件上传中</div>
  </div>
</template>

<script setup>
import { computed, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDialog, useMessage } from 'naive-ui'
import NavBar from '../components/NavBar.vue'
import MessageList from '../components/MessageList.vue'
import ChatInput from '../components/ChatInput.vue'
import EmojiPanel from '../components/EmojiPanel.vue'
import PlusPanel from '../components/PlusPanel.vue'
import MediaViewer from '../components/MediaViewer.vue'
import { useChat } from '../composables/useChat.js'
import { useViewport } from '../composables/useViewport.js'
import { useUpload, classify, probeImage, probeDuration } from '../composables/useUpload.js'
import { ensureConfig, sessionState, setProfile, loadParticipant, removeHistory } from '../store/session.js'
import { copyText } from '../utils/clipboard.js'
import { formatCountdown } from '../utils/format.js'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const token = String(route.params.token || '')
const chat = useChat()
const { state, selfId, peerOnline, isSelf } = chat
const { upload } = useUpload()
const viewport = useViewport()

const listRef = ref(null)
const inputRef = ref(null)
const activePanel = ref('')
const uploadingCount = ref(0)
const now = ref(Date.now())
const viewer = reactive({ visible: false, message: null, kind: 'image' })

const config = computed(() => sessionState.config)

const navTitle = computed(() => {
  const peer = state.participants.find((p) => p.id !== selfId.value)
  if (peer) return peer.name
  return state.session?.title || '临时会话'
})

const navSubtitle = computed(() => {
  if (state.typingName) return `${state.typingName} 正在输入…`
  if (state.status === 'destroyed') return '会话已结束'
  if (state.status !== 'connected') return '连接中…'
  return peerOnline.value ? '对方在线' : '对方不在线，消息将在其上线后可见'
})

const inputPlaceholder = computed(() => {
  if (state.status === 'connected') return ''
  return state.status === 'connecting' ? '正在建立连接…' : '连接已断开，重连中…'
})

const remainingMs = computed(() => Math.max(0, (state.expireAt || 0) - now.value))
const countdownText = computed(() => formatCountdown(remainingMs.value))

const banner = computed(() => {
  if (state.status === 'connecting') return { tone: 'info', text: '正在连接临时会话…', retry: false }
  if (state.status === 'error') return { tone: 'error', text: state.error || '会话不可用', retry: true }
  if (state.status === 'reconnecting' && state.error) {
    return { tone: 'warn', text: state.error || '网络异常，正在重连…', retry: true }
  }
  if (state.status === 'connected' && !state.networkOnline) {
    return { tone: 'warn', text: '网络已断开，恢复后会自动重连', retry: false }
  }
  return null
})

const destroyTitle = computed(() => (state.destroyReason === 'expired' ? '会话已到期' : '会话已销毁'))
const destroyDesc = computed(() =>
  state.destroyReason === 'expired'
    ? '有效期已结束，系统已执行全链路销毁。'
    : '该会话已被结束，所有数据已从服务端抹除。',
)

// --------------------------------------------------------------- 生命周期

let timer = null

onMounted(async () => {
  if (!token) {
    router.replace('/')
    return
  }
  await ensureConfig()
  if (!sessionState.profile.name) setProfile('访客')
  await chat.connect({ token, name: sessionState.profile.name })
  if (state.status === 'destroyed') removeHistory(token)

  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  clearInterval(timer)
  state.pending.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl))
  chat.disconnect()
})

// 键盘弹出/收起：滚动到底部，避免最新消息被键盘遮住
const offKeyboard = viewport.onKeyboardToggle(() => {
  setTimeout(() => listRef.value?.scrollToBottom(), 60)
  setTimeout(() => listRef.value?.scrollToBottom(), 300)
})

onBeforeUnmount(() => offKeyboard?.())

// 收到新消息且页面可见时上报已读
watch(
  () => state.messages.length,
  () => {
    if (state.status !== 'connected') return
    const last = state.messages[state.messages.length - 1]
    if (!last) return
    if (!isSelf(last) && document.visibilityState === 'visible') chat.markRead(last.ts)
  },
)

function notify({ type, message: text }) {
  message[type === 'warning' ? 'warning' : type === 'error' ? 'error' : 'info'](text)
}

function onTyping(value) {
  chat.setTyping(value)
}

function onInputFocus(focused) {
  if (focused) {
    activePanel.value = ''
    setTimeout(() => listRef.value?.scrollToBottom(), 120)
  }
}

function togglePanel(name) {
  activePanel.value = activePanel.value === name ? '' : name
  if (activePanel.value) {
    inputRef.value?.blur()
    setTimeout(() => listRef.value?.scrollToBottom(), 80)
  }
}

function insertEmoji(emoji) {
  inputRef.value?.insert(emoji)
}

function onPanelPick(key) {
  activePanel.value = ''
  if (key === 'voice') {
    message.info('已切到录音模式：长按输入框左侧的麦克风按钮说话')
    return
  }
  inputRef.value?.openPicker(key)
}

function openViewer({ message: msg, kind }) {
  viewer.message = msg
  viewer.kind = kind === 'video' ? 'video' : 'image'
  viewer.visible = true
}

// ------------------------------------------------------------------ 发送

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

async function sendText(text) {
  const localId = uid()
  const pending = {
    id: localId,
    localId,
    type: 'text',
    ts: Date.now(),
    senderId: selfId.value,
    senderName: state.participant?.name || '',
    content: text,
    progress: 1,
  }
  chat.addPending(pending)
  try {
    await chat.sendText(text, localId)
  } catch (err) {
    chat.updatePending(localId, { failed: true, error: err.message })
    notify({ type: 'error', message: err.message || '发送失败' })
  }
}

/** 上传并发度：移动端弱网下 3 路并发既快又不易互相挤占 */
async function pool(items, limit, worker) {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      await worker(item)
    }
  })
  await Promise.all(runners)
}

async function handleFiles({ files, source }) {
  const maxSize = config.value.maxFileSizeMB * 1024 * 1024
  const accepted = []
  for (const file of files) {
    if (file.size > maxSize) {
      notify({ type: 'warning', message: `「${file.name}」超过 ${config.value.maxFileSizeMB}MB 上限，已跳过` })
      continue
    }
    accepted.push(file)
  }
  if (!accepted.length) return

  uploadingCount.value += accepted.length
  try {
    await pool(accepted, 3, (file) => uploadOne(file, source))
  } finally {
    uploadingCount.value = Math.max(0, uploadingCount.value - accepted.length)
  }
}

async function uploadOne(file, source, existingLocalId) {
  const category = classify(file)
  const localId = existingLocalId || uid()

  let meta = null
  if (category === 'image') meta = await probeImage(file)
  else if (category === 'video' || category === 'audio') meta = await probeDuration(file)

  const pending = {
    id: localId,
    localId,
    type: category,
    ts: Date.now(),
    senderId: selfId.value,
    senderName: state.participant?.name || '',
    content: '',
    progress: 0,
    previewUrl: meta?.previewUrl,
    file: {
      name: file.name || `${category}-${Date.now()}`,
      size: file.size,
      mime: file.type,
      category,
      width: meta?.width,
      height: meta?.height,
      duration: meta?.duration,
    },
    source,
    raw: file,
  }

  const existing = state.pending.find((p) => p.localId === localId)
  if (existing) Object.assign(existing, { progress: 0, failed: false, error: '' })
  else chat.addPending(pending)

  try {
    const uploaded = await upload(token, file, {
      participantId: selfId.value,
      onProgress: (progress) => chat.updatePending(localId, { progress }),
    })
    chat.updatePending(localId, { progress: 1, uploadedId: uploaded.id })
    await chat.send({
      type: category,
      content: '',
      localId,
      file: {
        id: uploaded.id,
        width: meta?.width,
        height: meta?.height,
        duration: meta?.duration,
      },
    })
    if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl)
    chat.removePending(localId)
  } catch (err) {
    if (err.code === 'ABORTED') {
      chat.removePending(localId)
      if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl)
      return
    }
    chat.updatePending(localId, { failed: true, error: err.message })
    notify({ type: 'error', message: `上传失败：${err.message}` })
  }
}

async function retryPending(pending) {
  if (!pending?.raw) {
    chat.removePending(pending.localId)
    return
  }
  chat.updatePending(pending.localId, { failed: false, error: '', progress: 0 })
  await uploadOne(pending.raw, pending.source, pending.localId)
}

function cancelPending(pending) {
  chat.removePending(pending.localId)
  if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl)
}

async function handleRecorded({ blob, duration, filename }) {
  const file = new File([blob], filename, { type: blob.type || 'audio/webm' })
  uploadingCount.value += 1
  try {
    await uploadOne(file, 'voice')
    if (duration && duration < 2) message.info('语音已发送')
  } finally {
    uploadingCount.value = Math.max(0, uploadingCount.value - 1)
  }
}

// -------------------------------------------------------------- 会话操作

function goHome() {
  chat.disconnect()
  router.replace('/')
}

async function reconnect() {
  if (state.status === 'destroyed') {
    goHome()
    return
  }
  await chat.connect({ token, name: sessionState.profile.name })
}

function showMenu() {
  const d = dialog.create({
    title: '会话操作',
    content: () =>
      h('div', { class: 'menu-list' }, [
        h(
          'button',
          {
            class: 'menu-item',
            onClick: async () => {
              const ok = await copyText(token)
              message[ok ? 'success' : 'error'](ok ? 'Token 已复制' : '复制失败')
              d.destroy()
            },
          },
          `复制 Token（${token}）`,
        ),
        h(
          'button',
          {
            class: 'menu-item',
            onClick: () => {
              showInfo()
              d.destroy()
            },
          },
          '查看会话信息',
        ),
        h(
          'button',
          {
            class: 'menu-item danger',
            onClick: () => {
              d.destroy()
              confirmDestroy()
            },
          },
          '结束并销毁会话',
        ),
      ]),
    positiveText: '关闭',
  })
}

function showInfo() {
  const created = state.session?.createdAt ? new Date(state.session.createdAt).toLocaleString() : '-'
  const expire = state.expireAt ? new Date(state.expireAt).toLocaleString() : '-'
  dialog.info({
    title: '会话信息',
    content: () =>
      h('div', { style: 'font-size:14px;line-height:2' }, [
        h('div', `Token：${token}`),
        h('div', `创建时间：${created}`),
        h('div', `到期时间：${expire}`),
        h('div', `剩余时间：${countdownText.value}`),
        h('div', `在线人数：${state.participants.filter((p) => p.online).length} / ${config.value.maxParticipants}`),
        h('div', `消息条数：${state.messages.length}`),
        h('div', `存储驱动：${config.value.storageDriver === 'redis' ? 'Redis（仅内存）' : '进程内存'}`),
      ]),
    positiveText: '知道了',
  })
}

function confirmDestroy() {
  dialog.warning({
    title: '结束并销毁会话？',
    content: `销毁后双方将立即断开，Token「${token}」永久失效，内存数据与已上传文件会被物理删除，无法恢复。`,
    positiveText: '确认销毁',
    negativeText: '再想想',
    onPositiveClick: async () => {
      const res = await chat.destroySession('manual')
      removeHistory(token)
      if (res?.ok) message.success('会话已销毁，数据已抹除')
      else {
        try {
          const { default: api } = await import('../api/http.js')
          await api.destroy(token)
        } catch {
          /* 网络异常时保持界面销毁态即可 */
        }
      }
    },
  })
}
</script>

<style scoped>
.chat {
  background: var(--wx-bg);
}

.nav-action {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 700;
  color: #191919;
  letter-spacing: 1px;
  border-radius: 50%;
}

.nav-action:active {
  background: rgba(0, 0, 0, 0.06);
}

.banner {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 6px 12px;
  font-size: 12.5px;
}

.banner.info {
  background: #e8f4ff;
  color: #1a6fbf;
}

.banner.warn {
  background: #fff4e0;
  color: #a35c00;
}

.banner.error {
  background: #ffecec;
  color: #c0392b;
}

.banner button {
  text-decoration: underline;
  font-size: 12.5px;
  color: inherit;
}

.expire-bar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.72);
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.05);
  font-size: 11.5px;
  color: var(--wx-text-secondary);
  font-variant-numeric: tabular-nums;
}

.expire-bar.warn {
  background: rgba(255, 236, 236, 0.9);
  color: #c0392b;
}

.expire-icon {
  font-size: 11px;
}

.expire-sep {
  opacity: 0.5;
}

.input-wrap {
  flex: none;
  background: var(--wx-panel);
}

.overlay {
  position: fixed;
  inset: 0;
  z-index: 150;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.overlay-card {
  width: 100%;
  max-width: 340px;
  background: #fff;
  border-radius: 16px;
  padding: 24px 20px 20px;
  text-align: center;
}

.overlay-icon {
  font-size: 40px;
}

.overlay-card h3 {
  margin: 10px 0 6px;
  font-size: 18px;
}

.overlay-card p {
  margin: 0 0 14px;
  font-size: 13.5px;
  color: var(--wx-text-secondary);
  line-height: 1.6;
}

.overlay-list {
  margin: 0 0 18px;
  padding: 0;
  list-style: none;
  text-align: left;
  background: #f7f8f8;
  border-radius: 8px;
  padding: 12px 14px;
}

.overlay-list li {
  font-size: 12.5px;
  color: #4b4b4b;
  line-height: 1.9;
}

.overlay-list li::before {
  content: '✓';
  color: var(--wx-green);
  margin-right: 6px;
}

.upload-badge {
  position: fixed;
  left: 50%;
  bottom: calc(96px + var(--safe-bottom));
  transform: translateX(-50%);
  z-index: 60;
  padding: 6px 14px;
  border-radius: 15px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 12px;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

<style>
/* 会话操作菜单（Dialog 内容挂载在 body，需非 scoped） */
.menu-list {
  display: flex;
  flex-direction: column;
}

.menu-item {
  text-align: left;
  padding: 14px 4px;
  font-size: 15px;
  color: #191919;
  border-bottom: 0.5px solid var(--wx-divider-light);
}

.menu-item:last-child {
  border-bottom: none;
}

.menu-item:active {
  background: #f5f5f5;
}

.menu-item.danger {
  color: var(--wx-danger);
}
</style>
