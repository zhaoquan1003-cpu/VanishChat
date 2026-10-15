<template>
  <div v-if="info" class="vp-debug">
    <b>viewport debug</b>
    <span>innerH {{ info.innerHeight }}</span>
    <span>vv.h {{ info.vvHeight }}</span>
    <span>vv.top {{ info.vvOffsetTop }}</span>
    <span>scale {{ info.scale }}</span>
    <span>base {{ info.baseline }}</span>
    <span>doc {{ info.docHeight }}</span>
    <span class="hl">--app-height {{ info.height }}</span>
    <span class="hl">--kb-offset {{ info.pan }}</span>
    <span>kb {{ info.kb }}</span>
    <span>src {{ info.source }}</span>
  </div>
</template>

<script setup>
/**
 * 真机排查视口问题用：地址后面加 ?debug=1 即显示。
 * 平时不渲染（App.vue 里 v-if 控制），零开销。
 */
import { useViewport } from '../composables/useViewport.js'

const { debugInfo: info } = useViewport()
</script>

<style scoped>
.vp-debug {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  z-index: 9999;
  display: flex;
  flex-wrap: wrap;
  gap: 3px 10px;
  padding: 3px 8px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 10.5px;
  line-height: 1.5;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  pointer-events: none;
}

.vp-debug b {
  color: #95ec69;
}

.hl {
  color: #ffe08a;
}
</style>
