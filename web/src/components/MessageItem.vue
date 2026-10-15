<template>
  <!-- 系统消息：微信式的居中灰胶囊 -->
  <div v-if="message.type === 'system'" class="system-row">
    <span class="system-pill">{{ message.content }}</span>
  </div>

  <div v-else class="row" :class="{ self }">
    <div class="avatar" :class="{ self }">{{ initial }}</div>

    <div class="body">
      <!-- 撤回 / 失败提示 -->
      <div v-if="message.failed" class="failed" @click="$emit('retry', message)">
        <span class="bang">!</span>
        <span>发送失败，点击重试</span>
      </div>

      <!-- 文本 -->
      <div v-if="message.type === 'text'" class="bubble text-bubble">
        <span v-html="renderedText" />
      </div>

      <!-- 图片 -->
      <div
        v-else-if="message.type === 'image'"
        class="bubble media-bubble"
        :style="imageBoxStyle"
        @click="openMedia('image')"
      >
        <img :src="mediaUrl" :alt="message.file?.name || '图片'" class="media-img" loading="lazy" />
        <div v-if="showProgress" class="progress-mask">
          <ProgressRing :value="message.progress || 0" />
        </div>
        <button v-if="pending && !showProgress" class="cancel" @click.stop="$emit('cancel', message)">×</button>
      </div>

      <!-- 视频 -->
      <div v-else-if="message.type === 'video'" class="bubble media-bubble video-bubble" @click="openMedia('video')">
        <video
          v-if="mediaUrl"
          :src="mediaUrl"
          class="media-img"
          preload="metadata"
          playsinline
          webkit-playsinline
          muted
          :style="imageBoxStyle"
        />
        <div class="video-mask">
          <svg viewBox="0 0 24 24" width="42" height="42" aria-hidden="true">
            <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.42)" />
            <path d="M10 8.2 16.4 12 10 15.8Z" fill="#fff" />
          </svg>
        </div>
        <span v-if="message.file?.duration" class="duration">{{ formatDuration(message.file.duration) }}</span>
        <div v-if="showProgress" class="progress-mask">
          <ProgressRing :value="message.progress || 0" />
        </div>
      </div>

      <!-- 语音 -->
      <div
        v-else-if="message.type === 'audio'"
        class="bubble audio-bubble"
        :style="{ width: audioWidth }"
        @click="toggleAudio"
      >
        <i class="wave" :class="{ playing }">
          <b /><b /><b />
        </i>
        <span class="audio-duration">{{ formatDuration(message.file?.duration || 0) }}</span>
      </div>

      <!-- 文件卡片 -->
      <div v-else class="bubble file-bubble" @click="openFile">
        <div class="file-icon" :style="{ background: iconMeta.color }">{{ iconMeta.icon }}</div>
        <div class="file-info">
          <span class="file-name">{{ message.file?.name || '未命名文件' }}</span>
          <span class="file-size">{{ formatBytes(message.file?.size || 0) }} · {{ extLabel(message.file?.name) }}</span>
        </div>
        <div v-if="showProgress" class="file-progress">
          <ProgressRing :value="message.progress || 0" size="22" />
        </div>
      </div>

      <div v-if="message.caption" class="caption">{{ message.caption }}</div>

      <!-- 已读回执：仅自己发出的最后一条展示 -->
      <span v-if="self && showReceipt" class="receipt">{{ receiptText }}</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import ProgressRing from './ProgressRing.vue'
import { formatBytes, formatDuration, extLabel, fileIcon, linkify } from '../utils/format.js'

const props = defineProps({
  message: { type: Object, required: true },
  self: { type: Boolean, default: false },
  pending: { type: Boolean, default: false },
  showReceipt: { type: Boolean, default: false },
  receiptText: { type: String, default: '' },
})

const emit = defineEmits(['open-media', 'retry', 'cancel'])

const playing = ref(false)
let audioEl = null

const initial = computed(() => {
  const name = props.message.senderName || '访'
  return name.slice(0, 1)
})

const renderedText = computed(() => linkify(props.message.content || '').replace(/\n/g, '<br/>'))

const mediaUrl = computed(() => props.pending && props.message.previewUrl ? props.message.previewUrl : props.message.file?.url)

const showProgress = computed(() => props.pending && !props.message.failed)

/** 按真实宽高比渲染，最长边 180px，最短边 72px —— 微信的图片气泡手感 */
const imageBoxStyle = computed(() => {
  const w = Number(props.message.file?.width) || 0
  const h = Number(props.message.file?.height) || 0
  if (!w || !h) return { width: '150px', height: '150px' }
  const maxSide = 180
  const minSide = 72
  const ratio = w / h
  let width = ratio >= 1 ? maxSide : Math.max(minSide, maxSide * ratio)
  let height = ratio >= 1 ? Math.max(minSide, maxSide / ratio) : maxSide
  width = Math.min(width, 220)
  height = Math.min(height, 240)
  return { width: `${Math.round(width)}px`, height: `${Math.round(height)}px` }
})

/** 语音气泡宽度随时长增长，短语音不空旷、长语音不局促 */
const audioWidth = computed(() => {
  const duration = Number(props.message.file?.duration) || 0
  const ratio = Math.min(1, Math.max(0.15, duration / 30))
  return `${Math.round(72 + ratio * 96)}px`
})

const iconMeta = computed(() => fileIcon(props.message.file?.name))

function openMedia(kind) {
  if (props.message.failed) return
  emit('open-media', { message: props.message, kind })
}

function openFile() {
  if (props.message.failed || props.pending) return
  const url = props.message.file?.url
  if (url) window.open(url, '_blank', 'noopener')
}

function toggleAudio() {
  const url = props.message.file?.url
  if (!url) return
  if (audioEl && playing.value) {
    audioEl.pause()
    playing.value = false
    return
  }
  if (!audioEl) {
    audioEl = new Audio(url)
    audioEl.addEventListener('ended', () => {
      playing.value = false
    })
  }
  audioEl.play().then(() => {
    playing.value = true
  })
}

onBeforeUnmount(() => {
  audioEl?.pause()
  audioEl = null
})
</script>

<style scoped>
.row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 4px 12px;
  animation: vc-fade-in 0.16s ease-out;
}

.row.self {
  flex-direction: row-reverse;
}

.avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
  font-weight: 500;
  user-select: none;
  background: linear-gradient(135deg, #6f9fe8, #4a7fd4);
}

.avatar.self {
  background: linear-gradient(135deg, #57c98a, #2fae6a);
}

.body {
  max-width: calc(100% - 62px);
  display: flex;
  flex-direction: column;
}

.row.self .body {
  align-items: flex-end;
}

.bubble {
  position: relative;
  border-radius: var(--radius-bubble);
  background: var(--wx-bubble-other);
  max-width: 100%;
  word-break: break-word;
  overflow: hidden;
}

.row.self .bubble {
  background: var(--wx-bubble-self);
}

/* 气泡小尖角 */
.text-bubble::before,
.audio-bubble::before {
  content: '';
  position: absolute;
  top: 13px;
  width: 0;
  height: 0;
  border: 5px solid transparent;
}

.bubble::before {
  left: -9px;
  border-right-color: var(--wx-bubble-other);
}

.row.self .bubble::before {
  left: auto;
  right: -9px;
  border-right-color: transparent;
  border-left-color: var(--wx-bubble-self);
}

.text-bubble {
  padding: 9px 12px;
  font-size: 16.5px;
  line-height: 1.42;
  color: var(--wx-text);
  text-align: left;
  user-select: text;
  -webkit-user-select: text;
}

.text-bubble :deep(a) {
  color: var(--wx-link);
  word-break: break-all;
  text-decoration: underline;
}

.media-bubble {
  padding: 0;
  background: #e0e0e0;
  cursor: pointer;
  position: relative;
}

.media-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.video-bubble {
  position: relative;
}

.video-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.duration {
  position: absolute;
  right: 6px;
  bottom: 6px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 11px;
}

.audio-bubble {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  min-width: 72px;
  cursor: pointer;
  max-width: 190px;
}

.wave {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 16px;
}

.wave b {
  display: block;
  width: 2px;
  border-radius: 2px;
  background: #4b4b4b;
}

.wave b:nth-child(1) {
  height: 8px;
}
.wave b:nth-child(2) {
  height: 14px;
}
.wave b:nth-child(3) {
  height: 10px;
}

.wave.playing b {
  animation: vc-wave 0.7s infinite ease-in-out;
  background: var(--wx-green);
}

.wave.playing b:nth-child(2) {
  animation-delay: 0.12s;
}
.wave.playing b:nth-child(3) {
  animation-delay: 0.24s;
}

@keyframes vc-wave {
  0%,
  100% {
    transform: scaleY(0.55);
  }
  50% {
    transform: scaleY(1.25);
  }
}

.audio-duration {
  font-size: 12px;
  color: #6b6b6b;
  font-variant-numeric: tabular-nums;
}

.file-bubble {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  width: min(232px, 62vw);
  cursor: pointer;
}

.file-icon {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #fff;
}

.file-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.file-name {
  font-size: 14.5px;
  line-height: 1.3;
  color: var(--wx-text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.file-size {
  font-size: 11.5px;
  color: var(--wx-text-secondary);
}

.file-progress {
  flex: none;
}

.caption {
  margin-top: 4px;
  padding: 0 4px;
  font-size: 13px;
  color: #5f5f5f;
}

.progress-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}

.cancel {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.receipt {
  margin-top: 3px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
  padding: 0 4px;
}

.failed {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--wx-danger);
}

.bang {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--wx-danger);
  color: #fff;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
  font-weight: 700;
}

.system-row {
  display: flex;
  justify-content: center;
  padding: 8px 24px;
}

.system-pill {
  padding: 3px 9px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.09);
  color: #7d7d7d;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}
</style>
