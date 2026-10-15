<template>
  <div class="app-shell home">
    <header class="hero safe-top">
      <div class="hero-inner">
        <div class="brand">
          <span class="logo">◍</span>
          <div>
            <h1>VanishChat</h1>
            <p>无需账号 · 一个 Token 即刻开聊 · 过期即销毁</p>
          </div>
        </div>
        <button class="link-btn" @click="$router.push('/about')">说明</button>
      </div>
    </header>

    <div class="scroll-y body">
      <!-- 输入 Token 即加入，最快路径放在最上 -->
      <section class="card">
        <div class="tabs">
          <button :class="{ on: tab === 'join' }" @click="tab = 'join'">加入会话</button>
          <button :class="{ on: tab === 'create' }" @click="tab = 'create'">创建会话</button>
          <span class="tab-ink" :style="{ transform: `translateX(${tab === 'join' ? 0 : 100}%)` }" />
        </div>

        <!-- ------------------------------------------------ 加入 -->
        <template v-if="tab === 'join'">
          <label class="field-label">会话 Token</label>
          <n-input
            v-model:value="joinToken"
            size="large"
            :maxlength="tokenLength"
            placeholder="输入 8 位 Token"
            class="token-input"
            @input="normalizeToken"
            @keyup.enter="doJoin"
          />

          <label class="field-label">你的昵称</label>
          <n-input v-model:value="nickname" size="large" :maxlength="20" placeholder="对方将看到这个昵称" />

          <button class="wx-btn-primary" :disabled="joining || !canJoin" @click="doJoin">
            {{ joining ? '校验中…' : '进入会话' }}
          </button>

          <p class="hint">Token 由发起方分享给你；校验通过后才会建立临时会话。</p>
        </template>

        <!-- ------------------------------------------------ 创建 -->
        <template v-else>
          <label class="field-label">会话有效期</label>
          <div class="chips">
            <button
              v-for="tier in config.expiryTiers"
              :key="tier"
              class="chip"
              :class="{ on: ttlHours === tier }"
              @click="ttlHours = tier"
            >
              {{ tierLabel(tier) }}
            </button>
            <button class="chip" :class="{ on: customOpen }" @click="toggleCustom">自定义</button>
          </div>

          <div v-if="customOpen" class="custom-row">
            <n-input-number
              v-model:value="customHours"
              :min="1"
              :max="config.maxTtlHours"
              size="large"
              placeholder="小时"
              style="flex: 1"
            />
            <span class="unit">小时</span>
            <button class="mini-btn" @click="applyCustom">确定</button>
          </div>

          <label class="field-label">你的昵称</label>
          <n-input v-model:value="nickname" size="large" :maxlength="20" placeholder="对方将看到这个昵称" />

          <button class="wx-btn-primary" :disabled="creating || !nickname.trim()" @click="doCreate">
            {{ creating ? '创建中…' : '生成 Token' }}
          </button>

          <p class="hint">
            数据仅存于服务端内存，到期后由系统自动执行全链路销毁，磁盘与数据库均无残留。
          </p>
        </template>
      </section>

      <!-- ------------------------------------------------ 创建结果 -->
      <section v-if="created" class="card result">
        <span class="result-tag">Token 已生成</span>
        <div class="token-display" @click="copyToken">{{ created.token }}</div>
        <p class="result-meta">
          有效期至 {{ formatFullTime(created.expireAt) }}（{{ ttlText }}）
        </p>
        <div class="result-actions">
          <button class="wx-btn-ghost" @click="copyToken">复制 Token</button>
          <button class="wx-btn-ghost" @click="shareToken">分享给对方</button>
        </div>
        <button class="wx-btn-primary" @click="enterCreated">进入会话（等待对方加入）</button>
      </section>

      <!-- ------------------------------------------------ 最近会话 -->
      <section v-if="history.length" class="card">
        <div class="card-title">最近会话</div>
        <div
          v-for="item in history"
          :key="item.token"
          class="history-row"
          @click="$router.push(`/chat/${item.token}`)"
        >
          <div class="history-main">
            <span class="history-token">{{ item.token }}</span>
            <span class="history-sub">{{ item.ttlText }} · 创建于 {{ formatShortTime(item.createdAt) }}</span>
          </div>
          <span class="history-go">进入 ›</span>
        </div>
        <p class="hint center">若会话已过期或销毁，进入后会提示失效。</p>
      </section>

      <section class="card compact">
        <div class="feature" v-for="f in features" :key="f.title">
          <span class="f-icon">{{ f.icon }}</span>
          <div>
            <strong>{{ f.title }}</strong>
            <span>{{ f.desc }}</span>
          </div>
        </div>
      </section>

      <div class="foot">
        <span>存储驱动：{{ config.storageDriver === 'redis' ? 'Redis 7.x（仅内存）' : '进程内存' }}</span>
        <span>行为日志保留 {{ config.logRetentionDays }} 天（不含消息内容）</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NInput, NInputNumber, useMessage } from 'naive-ui'
import api from '../api/http.js'
import { ensureConfig, sessionState, setProfile, pushHistory, rememberToken } from '../store/session.js'
import { copyText, shareText } from '../utils/clipboard.js'

const router = useRouter()
const message = useMessage()

const tab = ref('join')
const nickname = ref(sessionState.profile.name || '')
const joinToken = ref('')
const ttlHours = ref(24)
const customOpen = ref(false)
const customHours = ref(3)
const joining = ref(false)
const creating = ref(false)
const created = ref(null)

const config = computed(() => sessionState.config)
const tokenLength = computed(() => config.value.tokenLength || 8)
const history = computed(() => sessionState.history)
const canJoin = computed(() => joinToken.value.length === tokenLength.value && !!nickname.value.trim())

const ttlText = computed(() => {
  const hours = ttlHours.value
  return hours >= 24 ? `${hours / 24} 天` : `${hours} 小时`
})

const features = [
  { icon: '🔑', title: '零门槛接入', desc: '无需注册登录，输入同一 Token 即建立一对一通道' },
  { icon: '💬', title: '类微信交互', desc: '气泡消息、送达回执、在线状态、输入提示一应俱全' },
  { icon: '🧨', title: '数据不留痕', desc: '全程内存存储，到期自动抹除键值与物理文件' },
  { icon: '🧩', title: 'SaaS 级隔离', desc: '多组会话并行运行，Token 房间天然隔离互不干扰' },
]

function tierLabel(hours) {
  if (hours >= 24) return `${hours / 24} 天`
  return `${hours} 小时`
}

function normalizeToken() {
  joinToken.value = joinToken.value.replace(/\s+/g, '').slice(0, tokenLength.value)
}

function formatFullTime(ts) {
  const d = new Date(ts)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatShortTime(ts) {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function toggleCustom() {
  customOpen.value = !customOpen.value
  if (customOpen.value) customHours.value = ttlHours.value
}

function applyCustom() {
  const hours = Number(customHours.value)
  if (!Number.isFinite(hours) || hours < 1) {
    message.warning('请输入不小于 1 的小时数')
    return
  }
  ttlHours.value = Math.min(Math.round(hours), config.value.maxTtlHours)
  customOpen.value = false
}

function persistName() {
  setProfile(nickname.value.trim() || '访客')
}

async function doCreate() {
  if (!nickname.value.trim()) {
    message.warning('先给自己起个昵称')
    return
  }
  creating.value = true
  try {
    persistName()
    const data = await api.createSession({
      ttlHours: ttlHours.value,
      title: `${nickname.value.trim()} 的临时会话`,
      name: nickname.value.trim(),
    })
    created.value = data
    rememberToken(data.token)
    pushHistory({ token: data.token, createdAt: data.createdAt, ttlText })
    message.success('Token 已生成，复制后分享给对方')
  } catch (err) {
    message.error(err.message || '创建失败')
  } finally {
    creating.value = false
  }
}

async function copyToken() {
  const token = created.value?.token || joinToken.value
  const ok = await copyText(token)
  message[ok ? 'success' : 'error'](ok ? '已复制，发给对方即可开聊' : '复制失败，请手动记录')
}

async function shareToken() {
  if (!created.value) return
  const text = `用 VanishChat 和我临时聊两句，Token：${created.value.token}（${ttlText.value}内有效，过期即销毁）`
  const shared = await shareText({ title: 'VanishChat 临时会话', text, url: location.href.split('#')[0] })
  if (!shared) await copyToken()
}

function enterCreated() {
  if (!created.value) return
  router.push(`/chat/${created.value.token}`)
}

async function doJoin() {
  if (!canJoin.value) return
  joining.value = true
  try {
    persistName()
    const data = await api.verify(joinToken.value)
    pushHistory({
      token: data.token,
      createdAt: data.createdAt,
      ttlText: tierLabel(Math.round(data.ttlSeconds / 3600)),
    })
    rememberToken(data.token)
    router.push(`/chat/${data.token}`)
  } catch (err) {
    const hint =
      err.code === 'SESSION_NOT_FOUND'
        ? 'Token 无效，或该会话已销毁'
        : err.code === 'SESSION_EXPIRED'
          ? '该会话已过期'
          : err.message
    message.error(hint || '校验失败')
  } finally {
    joining.value = false
  }
}

onMounted(async () => {
  await ensureConfig()
  ttlHours.value = sessionState.config.defaultTtlHours || 24
  const remembered = sessionState.lastToken
  if (remembered && !joinToken.value) joinToken.value = remembered
})
</script>

<style scoped>
.home {
  background: linear-gradient(180deg, #eef1f4 0%, var(--wx-bg) 42%);
}

.hero {
  flex: none;
  background: #fff;
  border-bottom: 0.5px solid var(--wx-divider);
}

.hero-inner {
  height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(135deg, #07c160, #04a34f);
  color: #fff;
  font-size: 19px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand h1 {
  margin: 0;
  font-size: 16.5px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.brand p {
  margin: 1px 0 0;
  font-size: 11.5px;
  color: var(--wx-text-secondary);
}

.link-btn {
  font-size: 13.5px;
  color: var(--wx-link);
  padding: 6px 4px;
}

.body {
  padding: 12px 12px calc(28px + var(--safe-bottom));
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  background: #fff;
  border-radius: 12px;
  padding: 16px 14px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.card.compact {
  padding: 6px 14px;
}

.card-title {
  font-size: 13px;
  color: var(--wx-text-secondary);
  margin-bottom: 8px;
}

.tabs {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  background: #f2f3f5;
  border-radius: 9px;
  padding: 3px;
  margin-bottom: 16px;
}

.tabs button {
  position: relative;
  z-index: 2;
  height: 34px;
  font-size: 14.5px;
  color: #5c5c5c;
  border-radius: 7px;
  transition: color 0.16s ease;
}

.tabs button.on {
  color: var(--wx-text);
  font-weight: 600;
}

.tab-ink {
  position: absolute;
  z-index: 1;
  top: 3px;
  left: 3px;
  width: calc(50% - 3px);
  height: 34px;
  border-radius: 7px;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.09);
  transition: transform 0.2s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.field-label {
  display: block;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
  margin: 12px 2px 6px;
}

.token-input :deep(input) {
  letter-spacing: 6px;
  font-size: 20px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  height: 34px;
  padding: 0 14px;
  border-radius: 17px;
  background: #f2f3f5;
  color: #4b4b4b;
  font-size: 14px;
  transition: all 0.15s ease;
}

.chip.on {
  background: rgba(7, 193, 96, 0.12);
  color: #059e4e;
  font-weight: 600;
  box-shadow: inset 0 0 0 1px rgba(7, 193, 96, 0.4);
}

.custom-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.unit {
  font-size: 14px;
  color: var(--wx-text-secondary);
}

.mini-btn {
  height: 34px;
  padding: 0 14px;
  border-radius: 8px;
  background: var(--wx-green);
  color: #fff;
  font-size: 14px;
}

.card .wx-btn-primary,
.card .wx-btn-ghost {
  margin-top: 16px;
}

.result {
  border: 1px solid rgba(7, 193, 96, 0.25);
  background: linear-gradient(180deg, #f6fffa, #fff);
}

.result-tag {
  display: inline-block;
  font-size: 11.5px;
  color: #059e4e;
  background: rgba(7, 193, 96, 0.12);
  padding: 3px 8px;
  border-radius: 4px;
}

.token-display {
  margin-top: 12px;
  padding: 14px 8px;
  text-align: center;
  border-radius: 10px;
  background: #fff;
  border: 1px dashed rgba(7, 193, 96, 0.45);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 8px;
  color: #059e4e;
  user-select: all;
  -webkit-user-select: all;
}

.result-meta {
  margin: 10px 0 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--wx-text-secondary);
}

.result-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.history-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 2px;
  border-top: 0.5px solid var(--wx-divider-light);
}

.history-row:first-of-type {
  border-top: none;
}

.history-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.history-token {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 2px;
}

.history-sub {
  font-size: 11.5px;
  color: var(--wx-text-secondary);
}

.history-go {
  font-size: 13px;
  color: var(--wx-link);
  flex: none;
}

.feature {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-top: 0.5px solid var(--wx-divider-light);
}

.feature:first-child {
  border-top: none;
}

.f-icon {
  font-size: 18px;
  line-height: 1.4;
}

.feature div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.feature strong {
  font-size: 14px;
  font-weight: 600;
}

.feature span {
  font-size: 12px;
  color: var(--wx-text-secondary);
  line-height: 1.5;
}

.hint {
  margin: 12px 2px 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--wx-text-tertiary);
}

.hint.center {
  text-align: center;
}

.foot {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  padding: 4px 0 8px;
  font-size: 11px;
  color: var(--wx-text-tertiary);
}
</style>
