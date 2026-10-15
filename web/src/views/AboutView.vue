<template>
  <div class="app-shell about">
    <NavBar title="关于 VanishChat" back @back="$router.back()" />

    <div class="scroll-y body">
      <section class="block">
        <h2>这套系统是什么</h2>
        <p>
          一套<strong>无账号、凭 Token 匹配、会话级临时存储、退出即销毁</strong>的即时聊天系统。全程数据仅存在于内存，
          会话结束后物理删除，服务端不留任何消息副本，天然适配 SaaS 化运营。
        </p>
      </section>

      <section class="block">
        <h2>核心规则</h2>
        <ul>
          <li>创建会话时可选择有效期：{{
            config.expiryTiers.map((h) => (h >= 24 ? `${h / 24}天` : `${h}小时`)).join(' / ')
          }}，亦可自定义档位</li>
          <li>有效期内断开重连、退出再进入，会话与历史消息完整保留</li>
          <li>到达过期时间后自动触发全链路销毁：内存键值批量删除 + 物理文件递归删除</li>
          <li>系统行为日志独立保留 {{ config.logRetentionDays }} 天，仅记录行为，绝不记录消息内容</li>
        </ul>
      </section>

      <section class="block">
        <h2>销毁链路</h2>
        <div class="flow">
          <div class="flow-item" v-for="(step, i) in flow" :key="step">
            <span class="flow-no">{{ i + 1 }}</span>
            <span>{{ step }}</span>
          </div>
        </div>
      </section>

      <section class="block">
        <h2>技术选型</h2>
        <div class="stack">
          <div class="stack-row" v-for="row in stack" :key="row.name">
            <span class="stack-key">{{ row.name }}</span>
            <span class="stack-val">{{ row.value }}</span>
          </div>
        </div>
      </section>

      <section class="block">
        <h2>移动端优化</h2>
        <ul>
          <li><strong>软键盘</strong>：用 visualViewport 实时换算可视高度，整屏收缩而非被遮挡，键盘开合自动贴底</li>
          <li><strong>刘海屏</strong>：全链路 safe-area-inset 适配，横竖屏切换实时重算</li>
          <li><strong>触控</strong>：取消点击高亮与双击缩放，输入框字号 ≥16px 避免 iOS 聚焦放大，滚动阻尼原生手感</li>
          <li><strong>重操作</strong>：图片按真实比例渲染、弱网进度可视、发送失败一键重发</li>
        </ul>
      </section>

      <section class="block seal">
        <span class="seal-tag">服务端未持久化任何聊天内容</span>
        <p>所有会话数据随会话生命周期存在，销毁即不可恢复。</p>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import NavBar from '../components/NavBar.vue'
import { ensureConfig, sessionState } from '../store/session.js'

const config = computed(() => sessionState.config)

const flow = [
  '用户 A 创建会话，服务端生成 8 位全局唯一 Token，写入内存存储并设置 TTL',
  '用户 A 通过线下或其他渠道把 Token 分享给用户 B',
  '用户 B 输入 Token，服务端校验有效性与人数，加入对应 Socket 房间',
  '双方收发文字 / 图片 / 视频 / 语音 / 文件，消息实时转发并仅写入内存',
  '有效期到期或任一方主动结束 → 批量删除全部键值 + 递归删除上传目录 + 广播房间终结',
]

const stack = [
  { name: '前端', value: 'Vue 3 + Vite + Naive UI，移动端优先的类微信界面' },
  { name: '通信', value: 'Socket.io（WebSocket 封装），自带房间管理与断线重连' },
  { name: '服务', value: 'Node.js + Express + Socket.io' },
  { name: '数据', value: 'Redis 7.x 纯内存存储，TTL 自动过期；不可用时自动降级为进程内存' },
  { name: '文件', value: 'HTTP 上传 + WebSocket 信令 + 按 Token 分目录的临时存储' },
  { name: '接入', value: 'Nginx 反向代理 / WebSocket 协议升级 / 静态资源托管' },
  { name: '部署', value: 'Docker + Docker Compose，支持水平扩容' },
]

onMounted(() => ensureConfig())
</script>

<style scoped>
.about {
  background: var(--wx-bg);
}

.body {
  padding: 12px 12px calc(28px + var(--safe-bottom));
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.block {
  background: #fff;
  border-radius: 12px;
  padding: 16px 14px;
}

.block h2 {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
}

.block p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.75;
  color: #3f3f3f;
}

.block ul {
  margin: 0;
  padding-left: 18px;
}

.block li {
  font-size: 13.5px;
  line-height: 1.8;
  color: #3f3f3f;
}

.flow {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.flow-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 13px;
  line-height: 1.65;
  color: #3f3f3f;
}

.flow-no {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(7, 193, 96, 0.14);
  color: #059e4e;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}

.stack-row {
  display: flex;
  gap: 10px;
  padding: 9px 0;
  border-top: 0.5px solid var(--wx-divider-light);
  font-size: 13px;
  line-height: 1.6;
}

.stack-row:first-child {
  border-top: none;
}

.stack-key {
  flex: none;
  width: 52px;
  color: var(--wx-text-secondary);
}

.stack-val {
  flex: 1;
  color: #3f3f3f;
}

.seal {
  text-align: center;
  background: linear-gradient(180deg, #f6fffa, #fff);
  border: 1px solid rgba(7, 193, 96, 0.24);
}

.seal-tag {
  display: inline-block;
  font-size: 12px;
  color: #059e4e;
  background: rgba(7, 193, 96, 0.12);
  padding: 4px 10px;
  border-radius: 5px;
  margin-bottom: 10px;
}
</style>
