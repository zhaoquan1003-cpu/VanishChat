/**
 * 端到端验收脚本
 * 运行：node scripts/e2e.mjs   （需先启动服务端：npm start）
 *
 * 覆盖链路：
 *   创建会话 → 双端加入 → 文本双向收发 → 输入状态 → 已读回执
 *   → HTTP 上传文件 → WS 投递多媒体消息 → 文件可读
 *   → 主动销毁 → 双端收到终结广播 → 键值与物理文件全部消失
 */
import { io } from 'socket.io-client'

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000'

let passed = 0
let failed = 0

const ok = (label, extra = '') => {
  passed += 1
  console.log(`  \x1b[32m✓\x1b[0m ${label}${extra ? ` \x1b[90m${extra}\x1b[0m` : ''}`)
}
const bad = (label, extra = '') => {
  failed += 1
  console.log(`  \x1b[31m✗\x1b[0m ${label}${extra ? ` \x1b[90m${extra}\x1b[0m` : ''}`)
}
const assert = (cond, label, extra = '') => (cond ? ok(label, extra) : bad(label, extra))
const section = (title) => console.log(`\n\x1b[1m${title}\x1b[0m`)

async function json(path, options) {
  const res = await fetch(`${BASE}${path}`, options)
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

const connect = (name) =>
  new Promise((resolve, reject) => {
    const socket = io(BASE, { transports: ['websocket'], reconnection: false })
    const events = []
    socket.onAny((event, payload) => events.push({ event, payload }))
    socket.on('connect', () => resolve({ socket, events, name }))
    socket.on('connect_error', reject)
    setTimeout(() => reject(new Error(`${name} 连接超时`)), 8000)
  })

const join = (client, token, name) =>
  new Promise((resolve, reject) => {
    client.socket.emit('session:join', { token, name }, (res) =>
      res?.ok ? resolve(res) : reject(new Error(res?.message || 'join 失败')),
    )
  })

const send = (client, payload) =>
  new Promise((resolve, reject) => {
    client.socket.emit('msg:send', payload, (res) =>
      res?.ok ? resolve(res.message) : reject(new Error(res?.message || '发送失败')),
    )
  })

const waitFor = (client, event, timeout = 4000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待 ${event} 超时`)), timeout)
    client.socket.once(event, (payload) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('\x1b[1mVanishChat 端到端验收\x1b[0m')
  console.log(`目标：${BASE}\n`)

  section('1. 服务与配置')
  const health = await json('/api/health')
  assert(health.status === 200 && health.body?.ok, '健康检查可用', `driver=${health.body?.data?.store?.driver}`)
  const cfg = await json('/api/session/config')
  assert(cfg.body?.data?.expiryTiers?.length >= 5, '有效期档位下发正常', JSON.stringify(cfg.body?.data?.expiryTiers))

  section('2. 会话创建与校验')
  const created = await json('/api/session/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttlHours: 1, name: '用户A', title: '验收会话' }),
  })
  const token = created.body?.data?.token
  assert(created.status === 201 && token, '创建会话并返回 Token', `token=${token}`)
  assert(token && token.length === cfg.body.data.tokenLength, `Token 长度为 ${cfg.body?.data?.tokenLength} 位`)

  const verified = await json(`/api/session/${token}/verify`)
  assert(verified.body?.data?.token === token, 'Token 校验通过')

  const bogus = await json('/api/session/ZZZZ9999/verify')
  assert(bogus.status === 404, '无效 Token 被拒绝', `status=${bogus.status}`)

  const tiers = await json('/api/session/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttlHours: 999, name: '越界' }),
  })
  assert(tiers.status === 400, '超出上限的有效期被拒绝', `status=${tiers.status}`)

  section('3. 双端加入与实时消息')
  const a = await connect('A')
  const b = await connect('B')
  const joinA = await join(a, token, '用户A')
  const joinB = await join(b, token, '用户B')
  assert(joinA.session.token === token && joinB.session.token === token, '双端加入同一 Socket 房间')
  assert(joinA.participant.id !== joinB.participant.id, '双端获得独立参与者身份')

  const waitNewOnB = waitFor(b, 'msg:new')
  const sentA = await send(a, { type: 'text', content: '你好，这是第一条临时消息', localId: 'local-a1' })
  assert(sentA.type === 'text' && sentA.content.includes('临时消息'), 'A 发送文本成功', `seq=${sentA.seq}`)
  const receivedOnB = await waitNewOnB
  assert(receivedOnB.message.id === sentA.id, 'B 实时收到同一条消息')
  assert(receivedOnB.message.localId === 'local-a1', 'localId 回传用于本地占位对齐')

  const waitNewOnA = waitFor(a, 'msg:new')
  await send(b, { type: 'text', content: '收到，我是 B' })
  const receivedOnA = await waitNewOnA
  assert(receivedOnA.message.senderName === '用户B', 'A 收到 B 的回复', `sender=${receivedOnA.message.senderName}`)

  section('4. 输入状态与已读回执')
  const waitTyping = waitFor(a, 'typing')
  b.socket.emit('typing', { typing: true })
  const typing = await waitTyping
  assert(typing.typing === true && typing.participantId === joinB.participant.id, '对方输入状态可同步')

  b.socket.emit('msg:read', { upToTs: Date.now() })
  const read = await waitFor(a, 'msg:read')
  assert(read.participantId === joinB.participant.id, '已读回执可回传')

  section('5. 多媒体上传与投递')
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const form = new FormData()
  form.append('file', new Blob([pngBytes], { type: 'image/png' }), 'demo.png')
  form.append('token', token)
  form.append('participantId', joinA.participant.id)
  const upload = await json('/api/upload', { method: 'POST', body: form })
  const meta = upload.body?.data?.[0]
  assert(upload.status === 201 && meta?.id, '文件上传成功并入册会话', `id=${meta?.id} category=${meta?.category}`)
  assert(meta?.category === 'image', '图片类型识别正确')

  const wrongTokenUpload = new FormData()
  wrongTokenUpload.append('file', new Blob([pngBytes], { type: 'image/png' }), 'x.png')
  wrongTokenUpload.append('token', 'ZZZZ9999')
  const rejected = await json('/api/upload', { method: 'POST', body: wrongTokenUpload })
  assert(rejected.status === 404, '未知 Token 的上传被拒绝', `status=${rejected.status}`)

  const fileBefore = await fetch(`${BASE}/api/file/${token}/${meta.id}`)
  assert(fileBefore.status === 200, '文件可正常读取', `${fileBefore.headers.get('content-type')}`)

  const waitMediaOnB = waitFor(b, 'msg:new')
  const mediaMsg = await send(a, {
    type: 'image',
    localId: 'local-img1',
    file: { id: meta.id, width: 1, height: 1 },
  })
  assert(mediaMsg.type === 'image' && mediaMsg.file?.url, '图片消息投递成功', mediaMsg.file?.url)
  const mediaOnB = await waitMediaOnB
  assert(mediaOnB.message.file.id === meta.id, 'B 实时收到图片消息')

  section('6. 断线重连（有效期内保留身份与历史）')
  a.socket.disconnect()
  await sleep(300)
  const a2 = await connect('A2')
  const rejoin = await join(a2, token, '用户A')
  assert(rejoin.participant.id === joinA.participant.id, '重连复用原参与者身份')
  assert(rejoin.messages.length >= 3, '重连拿回完整历史消息', `${rejoin.messages.length} 条`)

  section('7. 退出即销毁（全链路）')
  const waitDestroyB = waitFor(b, 'session:destroyed', 6000)
  const waitDestroyA = waitFor(a2, 'session:destroyed', 6000)
  const destroyed = await json(`/api/session/${token}/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'e2e' }),
  })
  assert(destroyed.body?.ok, '销毁接口执行成功', `keysRemoved=${destroyed.body?.data?.keysRemoved}`)
  const evtB = await waitDestroyB
  assert(evtB.token === token, '在线成员收到会话终结广播')
  await waitDestroyA

  const reread = await fetch(`${BASE}/api/file/${token}/${meta.id}`)
  assert([404, 410].includes(reread.status), '销毁后文件立即不可访问', `status=${reread.status}`)
  const reverify = await json(`/api/session/${token}/verify`)
  assert(reverify.status === 404, '销毁后 Token 失效', `status=${reverify.status}`)
  const destroyAgain = await json(`/api/session/${token}/destroy`, { method: 'POST' })
  assert(destroyAgain.body?.ok, '销毁接口幂等')

  a.socket.close()
  b.socket.close()
  a2.socket.close()

  section('8. 席位隔离与文件细节')
  const soloCreated = await json('/api/session/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttlHours: 2, name: '甲' }),
  })
  const soloToken = soloCreated.body?.data?.token
  const bots = await Promise.all([connect('甲'), connect('乙'), connect('丙')])
  const [botA, botB, botC] = bots
  const soloJoinA = await join(botA, soloToken, '甲')
  const soloJoinB = await join(botB, soloToken, '乙')
  assert(soloJoinA.participant.id !== soloJoinB.participant.id, '两个新客户端各占独立席位')
  assert(
    soloJoinB.participants.filter((p) => p.online).length === 2,
    '双端互见在线状态',
    `online=${soloJoinB.participants.filter((p) => p.online).length}`,
  )

  const thirdJoin = await new Promise((resolve) => {
    botC.socket.emit('session:join', { token: soloToken, name: '丙' }, (res) => resolve(res))
  })
  assert(thirdJoin?.code === 'SESSION_FULL', '满员后第三人被拒绝', `code=${thirdJoin?.code}`)

  const zhForm = new FormData()
  zhForm.append('file', new Blob([pngBytes], { type: 'image/png' }), '产品方案V2.pdf')
  zhForm.append('token', soloToken)
  zhForm.append('participantId', soloJoinA.participant.id)
  const zhUpload = await json('/api/upload', { method: 'POST', body: zhForm })
  assert(zhUpload.body?.data?.[0]?.name === '产品方案V2.pdf', '中文文件名无损往返', zhUpload.body?.data?.[0]?.name)

  const zhMsg = await send(botA, { type: 'file', file: { id: zhUpload.body.data[0].id } })
  assert(zhMsg.file.name === '产品方案V2.pdf', '文件消息携带正确文件名')

  const badTtl = await json('/api/session/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttlHours: 'abc', name: '张三' }),
  })
  assert(badTtl.status === 400, '非法有效期参数被拒绝', `status=${badTtl.status}`)

  await json(`/api/session/${soloToken}/destroy`, { method: 'POST' })
  const botD = await connect('丁')
  const joinDead = await new Promise((resolve) => {
    botD.socket.emit('session:join', { token: soloToken, name: '丁' }, (res) => resolve(res))
  })
  assert(joinDead?.ok === false, '已销毁会话无法再加入', `code=${joinDead?.code}`)

  bots.forEach((bot) => bot.socket.close())
  botD.socket.close()

  console.log(`\n\x1b[1m结果：\x1b[32m${passed} 通过\x1b[0m${failed ? `，\x1b[31m${failed} 失败\x1b[0m` : ''}\n`)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(`\n\x1b[31m验收中断：${err.message}\x1b[0m\n`)
  process.exit(1)
})
