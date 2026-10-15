/**
 * 演示数据播种：以「对方」身份加入会话并发送若干消息 / 图片 / 文件，
 * 用于截图、演示或手工验收时立刻看到一个有内容的聊天界面。
 *
 * 用法：
 *   node scripts/seed-demo.mjs <token>           发送完即退出
 *   node scripts/seed-demo.mjs <token> --hold    保持在线（作为"对方"驻留）
 */
import { io } from 'socket.io-client'
import { demoImage } from './lib/png.mjs'

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000'
const [, , TOKEN, ...flags] = process.argv
const HOLD = flags.includes('--hold')
const PEER_NAME = process.env.PEER_NAME || '小林'

if (!TOKEN) {
  console.error('用法：node scripts/seed-demo.mjs <token> [--hold]')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function upload(token, participantId, filename, mime, buffer) {
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: mime }), filename)
  form.append('token', token)
  form.append('participantId', participantId)
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form })
  const json = await res.json()
  if (!json.ok) throw new Error(json.message)
  return json.data[0]
}

const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

const socket = io(BASE, { transports: ['websocket'] })

socket.on('connect', () => {
  socket.emit('session:join', { token: TOKEN, name: PEER_NAME }, async (res) => {
    if (!res?.ok) {
      console.error('加入失败：', res?.message)
      process.exit(1)
    }
    const me = res.participant.id
    console.log(`已以「${res.participant.name}」身份加入 ${TOKEN}`)

    const send = (payload) =>
      new Promise((resolve) => socket.emit('msg:send', payload, (r) => resolve(r?.message)))

    try {
      await send({ type: 'text', content: '在吗？会议纪要整理好了 📝' })
      await sleep(350)
      await send({ type: 'text', content: '配图和源文件一起发你，看完直接回我就行' })
      await sleep(350)

      const image = demoImage(480, 300)
      const img = await upload(TOKEN, me, '数据看板.png', 'image/png', image)
      await send({ type: 'image', file: { id: img.id, width: 480, height: 300 } })
      await sleep(450)

      const doc = await upload(TOKEN, me, '产品方案V2.pdf', 'application/pdf', PDF_BYTES)
      await send({ type: 'file', file: { id: doc.id } })
      await sleep(300)

      await send({ type: 'text', content: '收到请回复 🙌' })
      console.log('演示消息已写入')
    } catch (err) {
      console.error('播种失败：', err.message)
    }

    if (HOLD) {
      console.log('已保持在线（Ctrl+C 结束）')
    } else {
      setTimeout(() => {
        socket.close()
        process.exit(0)
      }, 300)
    }
  })
})

socket.on('connect_error', (err) => {
  console.error('连接失败：', err.message)
  process.exit(1)
})
