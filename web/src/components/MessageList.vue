<template>
  <div ref="scroller" class="scroll-y list" @scroll.passive="onScroll">
    <div class="list-head">
      <span class="head-hint">会话内容仅在当前会话有效期内保留，过期即彻底删除</span>
    </div>

    <template v-for="item in rendered" :key="item.key">
      <div v-if="item.separator" class="sep">
        <span>{{ item.separator }}</span>
      </div>
      <MessageItem
        :message="item.message"
        :self="item.self"
        :pending="item.pending"
        :show-receipt="item.showReceipt"
        :receipt-text="item.receiptText"
        @open-media="$emit('open-media', $event)"
        @retry="$emit('retry', $event)"
        @cancel="$emit('cancel', $event)"
      />
    </template>

    <div v-if="typingName" class="typing">
      <span class="typing-dots"><i /><i /><i /></span>
      {{ typingName }} 正在输入
    </div>

    <div class="list-tail" />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, watch, ref } from 'vue'
import MessageItem from './MessageItem.vue'
import { formatSeparator } from '../utils/format.js'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  pending: { type: Array, default: () => [] },
  selfId: { type: String, default: '' },
  lastReadTs: { type: Number, default: 0 },
  typingName: { type: String, default: '' },
  peerOnline: { type: Boolean, default: false },
})

defineEmits(['open-media', 'retry', 'cancel'])

const scroller = ref(null)
const stick = ref(true)
const SEPARATOR_GAP = 5 * 60 * 1000

const rendered = computed(() => {
  const merged = [
    ...props.messages.map((m) => ({ message: m, pending: false, ts: m.ts })),
    ...props.pending.map((m) => ({ message: m, pending: true, ts: m.ts })),
  ].sort((a, b) => a.ts - b.ts || (a.pending ? 1 : -1))

  const out = []
  let lastTs = 0
  let lastSelfTs = 0
  // 找到自己发出的最后一条（用于已读回执只挂在最后一条上）
  for (let i = merged.length - 1; i >= 0; i -= 1) {
    if (merged[i].message.senderId === props.selfId && merged[i].message.type !== 'system') {
      lastSelfTs = merged[i].ts
      break
    }
  }

  merged.forEach((entry, index) => {
    const { message } = entry
    const gap = lastTs === 0 || entry.ts - lastTs > SEPARATOR_GAP
    if (gap && message.type !== 'system') {
      out.push({ key: `sep-${index}`, separator: formatSeparator(entry.ts) })
    }
    lastTs = entry.ts

    const self = message.senderId === props.selfId
    const isLastSelf = self && entry.ts === lastSelfTs && !entry.pending
    const read = isLastSelf && props.lastReadTs >= entry.ts
    out.push({
      key: message.id || message.localId || `m-${index}`,
      message,
      self,
      pending: entry.pending,
      showReceipt: isLastSelf && (read || props.peerOnline === false ? read || props.lastReadTs > 0 : false),
      receiptText: read ? '已读' : '',
    })
  })
  return out
})

function onScroll() {
  const el = scroller.value
  if (!el) return
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 60
}

function scrollToBottom(smooth = false) {
  nextTick(() => {
    const el = scroller.value
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    stick.value = true
  })
}

watch(
  () => [props.messages.length, props.pending.length],
  () => {
    if (stick.value) scrollToBottom()
  },
)

watch(
  () => props.typingName,
  (val) => {
    if (val && stick.value) scrollToBottom()
  },
)

onMounted(() => {
  // 首屏直接定位到底部（无动画，避免"从顶部飞下来"的廉价感）
  scrollToBottom(false)
  setTimeout(() => scrollToBottom(false), 120)
})

defineExpose({ scrollToBottom })
</script>

<style scoped>
.list {
  background: var(--wx-bg);
  padding-top: 4px;
}

.list-head {
  display: flex;
  justify-content: center;
  padding: 10px 24px 6px;
}

.head-hint {
  font-size: 11px;
  color: var(--wx-text-tertiary);
  text-align: center;
  line-height: 1.5;
}

.sep {
  display: flex;
  justify-content: center;
  padding: 10px 0 6px;
}

.sep span {
  padding: 2px 8px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.08);
  color: #8d8d8d;
  font-size: 11.5px;
}

.typing {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px 2px;
  font-size: 12px;
  color: var(--wx-text-secondary);
}

.typing-dots {
  display: inline-flex;
  gap: 2px;
}

.typing-dots i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--wx-text-tertiary);
  animation: vc-blink 1.1s infinite ease-in-out;
}

.typing-dots i:nth-child(2) {
  animation-delay: 0.18s;
}
.typing-dots i:nth-child(3) {
  animation-delay: 0.36s;
}

@keyframes vc-blink {
  0%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-1px);
  }
}

.list-tail {
  height: 8px;
}
</style>
