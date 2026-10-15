<template>
  <svg :width="size" :height="size" viewBox="0 0 40 40" class="ring">
    <circle cx="20" cy="20" :r="radius" fill="none" stroke="rgba(255,255,255,0.28)" :stroke-width="stroke" />
    <circle
      cx="20"
      cy="20"
      :r="radius"
      fill="none"
      stroke="#fff"
      :stroke-width="stroke"
      stroke-linecap="round"
      :stroke-dasharray="circumference"
      :stroke-dashoffset="offset"
      transform="rotate(-90 20 20)"
    />
  </svg>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  value: { type: Number, default: 0 },
  size: { type: [Number, String], default: 38 },
  stroke: { type: Number, default: 3 },
})

const radius = 16
const circumference = 2 * Math.PI * radius
const offset = computed(() => circumference * (1 - Math.min(1, Math.max(0, props.value))))
</script>

<style scoped>
.ring {
  transform: rotate(0deg);
  transition: opacity 0.2s ease;
}
</style>
