<template>
  <div class="plus-panel">
    <div class="grid">
      <button v-for="item in items" :key="item.key" class="tile" @click="$emit('pick', item.key)">
        <span class="tile-icon" :style="{ background: item.bg }">
          <span class="glyph">{{ item.icon }}</span>
        </span>
        <span class="tile-label">{{ item.label }}</span>
      </button>
    </div>
    <div class="tip">单个文件不超过 {{ maxSizeMB }}MB，单次最多 {{ maxFiles }} 个</div>
  </div>
</template>

<script setup>
defineProps({
  maxSizeMB: { type: Number, default: 25 },
  maxFiles: { type: Number, default: 9 },
})
defineEmits(['pick'])

const items = [
  { key: 'album', label: '相册', icon: '🖼️', bg: 'linear-gradient(135deg,#4facfe,#00c6fb)' },
  { key: 'camera', label: '拍照', icon: '📷', bg: 'linear-gradient(135deg,#43e97b,#38f9d7)' },
  { key: 'file', label: '文件', icon: '📎', bg: 'linear-gradient(135deg,#a18cd1,#fbc2eb)' },
  { key: 'voice', label: '录音', icon: '🎙️', bg: 'linear-gradient(135deg,#ff9a9e,#fecfef)' },
]
</script>

<style scoped>
.plus-panel {
  background: var(--wx-panel);
  border-top: 0.5px solid var(--wx-divider);
  padding: 16px 12px calc(10px + var(--safe-bottom));
}

.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 6px 2px;
  border-radius: 10px;
}

.tile:active {
  background: rgba(0, 0, 0, 0.05);
}

.tile-icon {
  width: 54px;
  height: 54px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
}

.glyph {
  font-size: 26px;
  line-height: 1;
}

.tile-label {
  font-size: 12px;
  color: #4b4b4b;
}

.tip {
  margin-top: 14px;
  text-align: center;
  font-size: 11px;
  color: var(--wx-text-tertiary);
}
</style>
