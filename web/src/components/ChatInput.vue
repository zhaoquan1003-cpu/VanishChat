<template>
  <div class="input-bar" :class="{ focused }">
    <!-- 语音 / 键盘 切换 -->
    <button class="icon-btn" :aria-label="voiceMode ? '切换键盘' : '切换语音'" @click="toggleVoice">
      <svg v-if="!voiceMode" viewBox="0 0 24 24" width="26" height="26">
        <path
          d="M12 3.6a2.6 2.6 0 0 1 2.6 2.6v5.4a2.6 2.6 0 0 1-5.2 0V6.2A2.6 2.6 0 0 1 12 3.6Z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        />
        <path
          d="M6.4 10.8a5.6 5.6 0 0 0 11.2 0M12 16.7V20M9 20h6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
      <svg v-else viewBox="0 0 24 24" width="26" height="26">
        <rect x="2.6" y="7" width="18.8" height="10.4" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path
          d="M6.6 10.4h.01M10.2 10.4h.01M13.8 10.4h.01M17.4 10.4h.01M6.6 14h.01M9 14h6M17.4 14h.01"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
    </button>

    <div class="field">
      <textarea
        v-if="!voiceMode"
        ref="textarea"
        v-model="text"
        class="textarea"
        rows="1"
        enterkeyhint="enter"
        :disabled="disabled"
        :placeholder="placeholder"
        @input="autoGrow"
        @focus="onFocus"
        @blur="onBlur"
        @keydown="onKeydown"
      />
      <button
        v-else
        class="hold-btn"
        :class="{ hot: recording }"
        @touchstart.prevent="startRecord"
        @touchmove.prevent="onRecordMove"
        @touchend.prevent="endRecord"
        @touchcancel.prevent="cancelRecord"
        @mousedown.prevent="startRecord"
        @mouseup.prevent="endRecord"
        @mouseleave="recording && cancelRecord()"
      >
        {{ recording ? (cancelHint ? '松开手指，取消发送' : '松开发送') : '按住 说话' }}
      </button>
    </div>

    <button class="icon-btn" aria-label="表情" @click="toggleEmoji">
      <svg viewBox="0 0 24 24" width="26" height="26">
        <circle cx="12" cy="12" r="8.8" fill="none" stroke="currentColor" stroke-width="1.5" />
        <circle cx="8.9" cy="10.2" r="1.15" fill="currentColor" />
        <circle cx="15.1" cy="10.2" r="1.15" fill="currentColor" />
        <path d="M8.2 14.2c1 1.5 2.3 2.2 3.8 2.2s2.8-.7 3.8-2.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    </button>

    <button v-if="!text.trim()" class="icon-btn" aria-label="更多" @click="togglePlus">
      <svg viewBox="0 0 24 24" width="26" height="26">
        <circle cx="12" cy="12" r="8.8" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path d="M12 7.6v8.8M7.6 12h8.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
    </button>
    <button v-else class="send-btn" :disabled="disabled" @click="submit">发送</button>

    <!-- 隐藏的原生选择器：移动端直接唤起系统相册 / 相机 / 文件 App -->
    <input ref="albumInput" class="hidden-input" type="file" accept="image/*,video/*,audio/*" multiple @change="onPick($event, 'album')" />
    <input ref="cameraInput" class="hidden-input" type="file" accept="image/*" capture="environment" @change="onPick($event, 'camera')" />
    <input ref="fileInput" class="hidden-input" type="file" multiple @change="onPick($event, 'file')" />
  </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'

const props = defineProps({
  disabled: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
})

const emit = defineEmits(['send', 'typing', 'pick-files', 'toggle-panel', 'notify', 'recorded', 'focus-change'])

const text = ref('')
const focused = ref(false)
const voiceMode = ref(false)
const recording = ref(false)
const cancelHint = ref(false)

const textarea = ref(null)
const albumInput = ref(null)
const cameraInput = ref(null)
const fileInput = ref(null)

let recorder = null
let stream = null
let chunks = []
let startTs = 0
let startY = 0
let cancelled = false

const autoGrow = () => {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 116)}px`
}

const onFocus = () => {
  focused.value = true
  emit('toggle-panel', '')
  emit('focus-change', true)
  nextTick(autoGrow)
}

const onBlur = () => {
  focused.value = false
  emit('focus-change', false)
}

function onKeydown(event) {
  // 移动端回车换行（与微信一致），桌面端 Cmd/Ctrl+Enter 直接发送
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    submit()
  }
}

function submit() {
  const value = text.value.trim()
  if (!value || props.disabled) return
  emit('send', value)
  text.value = ''
  nextTick(autoGrow)
  emit('typing', false)
}

watch(text, (value) => {
  emit('typing', !!value.trim())
  if (!value.trim()) emit('typing', false)
})

function toggleEmoji() {
  emit('toggle-panel', 'emoji')
}

function togglePlus() {
  emit('toggle-panel', 'plus')
}

function toggleVoice() {
  voiceMode.value = !voiceMode.value
  if (voiceMode.value) {
    emit('toggle-panel', '')
    textarea.value?.blur()
  } else {
    nextTick(() => {
      textarea.value?.focus()
      autoGrow()
    })
  }
}

/** 向输入框插入内容（表情面板调用） */
function insert(value) {
  const el = textarea.value
  if (!el) {
    text.value += value
    return
  }
  const start = el.selectionStart ?? text.value.length
  const end = el.selectionEnd ?? text.value.length
  text.value = text.value.slice(0, start) + value + text.value.slice(end)
  nextTick(() => {
    el.focus()
    el.selectionStart = el.selectionEnd = start + value.length
    autoGrow()
  })
}

function openPicker(kind) {
  if (kind === 'album') albumInput.value?.click()
  else if (kind === 'camera') cameraInput.value?.click()
  else if (kind === 'file') fileInput.value?.click()
}

function onPick(event, source) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  if (files.length) emit('pick-files', { files, source })
}

// ------------------------------------------------------------- 语音录制

async function startRecord() {
  if (recording.value || props.disabled) return
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    emit('notify', { type: 'warning', message: '当前环境不支持录音，请改用系统键盘的语音输入' })
    return
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    emit('notify', { type: 'error', message: '麦克风权限被拒绝，无法录音' })
    return
  }

  chunks = []
  cancelled = false
  cancelHint.value = false
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) =>
    MediaRecorder.isTypeSupported?.(t),
  )
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data)
  }
  recorder.onstop = () => {
    const duration = (Date.now() - startTs) / 1000
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    recording.value = false
    cancelHint.value = false
    if (cancelled) return
    if (duration < 1) {
      emit('notify', { type: 'warning', message: '说话时间太短' })
      return
    }
    if (!chunks.length) {
      emit('notify', { type: 'error', message: '录音失败，请重试' })
      return
    }
    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
    const ext = (mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm'
    emit('recorded', { blob, duration, filename: `语音-${new Date().toISOString().slice(11, 19)}.${ext}` })
  }

  recorder.start()
  startTs = Date.now()
  recording.value = true
  startY = 0
}

function onRecordMove(event) {
  if (!recording.value) return
  const touch = event.touches?.[0]
  if (!touch) return
  if (!startY) startY = touch.clientY
  cancelHint.value = startY - touch.clientY > 56
}

function endRecord() {
  if (!recording.value) return
  cancelled = cancelHint.value
  try {
    recorder?.stop()
  } catch {
    recording.value = false
  }
}

function cancelRecord() {
  if (!recording.value) return
  cancelled = true
  try {
    recorder?.stop()
  } catch {
    recording.value = false
  }
}

defineExpose({ insert, openPicker, focus: () => textarea.value?.focus(), blur: () => textarea.value?.blur(), clear: () => { text.value = '' } })
</script>

<style scoped>
.input-bar {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 7px 8px;
  background: var(--wx-panel);
  border-top: 0.5px solid var(--wx-divider);
  position: relative;
}

.icon-btn {
  flex: none;
  width: 34px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #4c4c4c;
  border-radius: 6px;
}

.icon-btn:active {
  background: rgba(0, 0, 0, 0.06);
}

.field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.textarea {
  width: 100%;
  min-height: 38px;
  max-height: 116px;
  padding: 8px 10px;
  border: none;
  outline: none;
  resize: none;
  border-radius: 6px;
  background: #fff;
  font-size: 16.5px;
  line-height: 1.35;
  color: var(--wx-text);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  /* 16px 以上字号可避免 iOS 聚焦时自动放大页面 */
  font-size: max(16px, 16.5px);
}

.textarea::placeholder {
  color: #b9b9b9;
}

.hold-btn {
  width: 100%;
  height: 38px;
  border-radius: 6px;
  background: #fff;
  color: #333;
  font-size: 15.5px;
  transition: background 0.15s ease;
}

.hold-btn.hot {
  background: #d6d6d6;
  color: #111;
}

.send-btn {
  flex: none;
  height: 34px;
  padding: 0 14px;
  margin-bottom: 2px;
  border-radius: 5px;
  background: var(--wx-green);
  color: #fff;
  font-size: 15px;
  font-weight: 500;
}

.send-btn:active {
  background: var(--wx-green-active);
}

.send-btn:disabled {
  opacity: 0.5;
}

.hidden-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  left: -9999px;
}
</style>
