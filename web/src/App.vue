<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="themeOverrides">
    <n-dialog-provider>
      <n-message-provider :max="3" placement="top">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
        <ViewportDebug v-if="debugEnabled" />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

<script setup>
import { NConfigProvider, NDialogProvider, NMessageProvider, zhCN, dateZhCN } from 'naive-ui'
import ViewportDebug from './components/ViewportDebug.vue'
import { DEBUG_ENABLED } from './composables/useViewport.js'

/** 真机排查视口/键盘问题时加 ?debug=1 打开读数浮层 */
const debugEnabled = DEBUG_ENABLED

/** 主题对齐微信绿，避免 Naive UI 默认蓝与整体视觉冲突 */
const themeOverrides = {
  common: {
    primaryColor: '#07c160',
    primaryColorHover: '#06ad56',
    primaryColorPressed: '#059e4e',
    primaryColorSuppl: '#06ad56',
    borderRadius: '8px',
    fontSize: '16px',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', Roboto, sans-serif",
  },
  Button: { textColorPrimary: '#fff', fontWeightStrong: '500' },
  Input: { borderRadius: '8px' },
}
</script>
