<template>
  <header class="nav">
    <div class="nav-inner">
      <div class="nav-side nav-left">
        <button v-if="back" class="nav-icon" aria-label="返回" @click="$emit('back')">
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
            <path
              d="M15.5 4.5 8 12l7.5 7.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <slot name="left" />
      </div>

      <div class="nav-center">
        <span class="nav-title ellipsis">{{ title }}</span>
        <span v-if="subtitle" class="nav-sub ellipsis">
          <i v-if="dot" class="dot" :class="{ on: dotOn }" />
          {{ subtitle }}
        </span>
      </div>

      <div class="nav-side nav-right">
        <slot name="right" />
      </div>
    </div>
  </header>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  back: { type: Boolean, default: false },
  dot: { type: Boolean, default: false },
  dotOn: { type: Boolean, default: false },
})
defineEmits(['back'])
</script>

<style scoped>
.nav {
  position: relative;
  z-index: 20;
  flex: none;
  background: var(--wx-nav);
  padding-top: var(--safe-top);
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.08);
}

.nav-inner {
  height: var(--nav-height);
  display: flex;
  align-items: center;
  padding: 0 6px;
}

.nav-side {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 64px;
}

.nav-right {
  justify-content: flex-end;
}

.nav-left {
  justify-content: flex-start;
}

.nav-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #191919;
  border-radius: 50%;
}

.nav-icon:active {
  background: rgba(0, 0, 0, 0.06);
}

.nav-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1.2;
}

.nav-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--wx-text);
  max-width: 100%;
}

.nav-sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--wx-text-secondary);
  margin-top: 1px;
  max-width: 100%;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--wx-text-tertiary);
  display: inline-block;
}

.dot.on {
  background: var(--wx-green);
  box-shadow: 0 0 0 3px rgba(7, 193, 96, 0.16);
}
</style>
