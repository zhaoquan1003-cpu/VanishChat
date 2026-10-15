<template>
  <Teleport to="body">
    <Transition name="viewer">
      <div v-if="visible" class="viewer" @click.self="close">
        <div class="viewer-bar safe-top">
          <button class="v-btn" @click="close">关闭</button>
          <span class="v-title ellipsis">{{ message?.file?.name || '' }}</span>
          <a class="v-btn" :href="src" target="_blank" rel="noopener noreferrer" download>保存</a>
        </div>

        <div
          class="stage"
          @touchstart.passive="onTouchStart"
          @touchmove.prevent="onTouchMove"
          @touchend.passive="onTouchEnd"
          @dblclick="toggleZoom"
        >
          <img
            v-if="kind === 'image'"
            ref="media"
            :src="src"
            class="media"
            :style="transformStyle"
            alt="图片预览"
            @click.stop="toggleZoom"
          />
          <video
            v-else
            ref="media"
            :src="src"
            class="media"
            controls
            autoplay
            playsinline
            webkit-playsinline
            @click.stop
          />
        </div>

        <div class="viewer-foot safe-bottom">
          <span v-if="kind === 'image'" class="hint">双指缩放 · 双击放大 · 长按可保存</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  visible: { type: Boolean, default: false },
  message: { type: Object, default: null },
  kind: { type: String, default: 'image' },
})

const emit = defineEmits(['close'])

const media = ref(null)
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)

const src = computed(() => {
  const m = props.message
  if (!m) return ''
  return m.previewUrl || m.file?.url || ''
})

const transformStyle = computed(() =>
  props.kind === 'image'
    ? { transform: `translate3d(${offsetX.value}px, ${offsetY.value}px, 0) scale(${scale.value})` }
    : {},
)

let startDist = 0
let startScale = 1
let startX = 0
let startY = 0
let moved = false

function reset() {
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
}

function close() {
  reset()
  emit('close')
}

function toggleZoom() {
  if (props.kind !== 'image') return
  if (scale.value > 1.05) {
    reset()
  } else {
    scale.value = 2.2
  }
}

const distance = (touches) =>
  Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)

function onTouchStart(event) {
  moved = false
  if (event.touches.length === 2) {
    startDist = distance(event.touches)
    startScale = scale.value
  } else if (event.touches.length === 1) {
    startX = event.touches[0].clientX - offsetX.value
    startY = event.touches[0].clientY - offsetY.value
  }
}

function onTouchMove(event) {
  moved = true
  if (event.touches.length === 2 && startDist) {
    scale.value = Math.min(4, Math.max(1, (distance(event.touches) / startDist) * startScale))
    return
  }
  if (event.touches.length === 1 && scale.value > 1.02) {
    offsetX.value = event.touches[0].clientX - startX
    offsetY.value = event.touches[0].clientY - startY
  }
}

function onTouchEnd() {
  // 未缩放时下滑关闭，符合移动端大图浏览直觉
  if (scale.value <= 1.02 && moved && offsetY.value > 90) close()
  startDist = 0
}

watch(
  () => props.visible,
  (value) => {
    if (value) reset()
    else document.body.style.removeProperty('overflow')
  },
)
</script>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.96);
  display: flex;
  flex-direction: column;
  touch-action: none;
}

.viewer-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  color: #fff;
}

.viewer-bar > * {
  flex: none;
}

.v-btn {
  color: #fff;
  font-size: 15px;
  padding: 6px 4px;
}

.v-title {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.82);
}

.stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.media {
  max-width: 100%;
  max-height: 100%;
  will-change: transform;
  transition: transform 0.12s ease-out;
  object-fit: contain;
}

.viewer-foot {
  flex: none;
  text-align: center;
  padding: 10px 16px;
}

.hint {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.55);
}

.viewer-enter-active,
.viewer-leave-active {
  transition: opacity 0.18s ease;
}

.viewer-enter-from,
.viewer-leave-to {
  opacity: 0;
}
</style>
