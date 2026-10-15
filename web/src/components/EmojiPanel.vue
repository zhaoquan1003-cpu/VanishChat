<template>
  <div class="emoji-panel">
    <div class="grid">
      <button v-for="e in emojis" :key="e" class="emoji" @click="$emit('pick', e)">{{ e }}</button>
    </div>
  </div>
</template>

<script setup>
defineEmits(['pick'])

/** 微信常用表情的高频子集，覆盖面足够且不占屏 */
const emojis = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
  '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😗',
  '😋', '😛', '🤪', '🤨', '🧐', '🤓', '😎', '🥳',
  '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣',
  '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠',
  '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨',
  '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑',
  '🙄', '😬', '😴', '🤤', '😪', '😵', '🤐', '🥴',
  '👍', '👎', '👌', '✌️', '🤞', '🤝', '👏', '🙏',
  '💪', '🤙', '☝️', '✋', '👋', '🤚', '🖐️', '🤟',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔',
  '💯', '🔥', '✨', '🎉', '🎊', '🌹', '🌸', '🍀',
  '🍺', '🍻', '☕', '🍜', '🍚', '🍎', '🍉', '🍰',
  '⚡', '💡', '📌', '✅', '❌', '❓', '❗', '⏰',
]
</script>

<style scoped>
.emoji-panel {
  background: var(--wx-panel);
  border-top: 0.5px solid var(--wx-divider);
  padding: 8px 4px calc(8px + var(--safe-bottom));
  max-height: 34vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
}

.emoji {
  height: 40px;
  font-size: 24px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}

.emoji:active {
  background: rgba(0, 0, 0, 0.06);
}
</style>
