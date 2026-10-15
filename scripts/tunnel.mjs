#!/usr/bin/env node
/**
 * ChmlFrp 内网穿透启动器
 *
 *   node scripts/tunnel.mjs              查找客户端 → 校验本地服务 → 启动隧道
 *   node scripts/tunnel.mjs --download   客户端不存在时自动下载并解压
 *   node scripts/tunnel.mjs --check      只做连通性体检，不启动隧道
 *
 * 工作方式：
 *   1. 在 deploy/frpc/ 下递归查找 frpc(.exe)
 *   2. 找 frpc.ini；没有就用 frpc.ini.example 生成一份
 *   3. 校验本地服务（默认 127.0.0.1:3000）是否已就绪
 *   4. 启动客户端，并把外网访问地址算出来打印
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FRP_DIR = path.join(ROOT, 'deploy', 'frpc')
const LOCAL_PORT = Number(process.env.PORT || 3000)
const IS_WINDOWS = process.platform === 'win32'
const BIN_NAME = IS_WINDOWS ? 'frpc.exe' : 'frpc'
const CLIENT_URL =
  process.env.CHMLFRP_CLIENT_URL ||
  'https://cf-v1.uapis.cn/download/ChmlFrp-0.51.2_251023_windows_amd64.zip'

const flags = new Set(process.argv.slice(2))
const log = (...args) => console.log(...args)
const fail = (msg) => {
  console.error(`\x1b[31m✗\x1b[0m ${msg}`)
  process.exit(1)
}

// ------------------------------------------------------------------ 找客户端

function findBinary(dir, depth = 3) {
  if (depth < 0) return null
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isFile() && entry.name === BIN_NAME) return full
    if (entry.isDirectory()) {
      const found = findBinary(full, depth - 1)
      if (found) return found
    }
  }
  return null
}

function downloadClient() {
  fs.mkdirSync(FRP_DIR, { recursive: true })
  const zipPath = path.join(FRP_DIR, 'chmlfrp.zip')
  log(`⬇  正在下载 ChmlFrp 客户端…\n   ${CLIENT_URL}`)

  const download = spawnSync(
    IS_WINDOWS ? 'powershell' : 'curl',
    IS_WINDOWS
      ? ['-NoProfile', '-Command', `Invoke-WebRequest -Uri '${CLIENT_URL}' -OutFile '${zipPath}'`]
      : ['-sL', '-o', zipPath, CLIENT_URL],
    { stdio: 'inherit' },
  )
  if (download.status !== 0 || !fs.existsSync(zipPath)) fail('客户端下载失败，请手动下载后解压到 deploy/frpc/')

  log('📦 解压中…')
  const unzip = IS_WINDOWS
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${FRP_DIR}' -Force`], { stdio: 'inherit' })
    : spawnSync('unzip', ['-o', zipPath, '-d', FRP_DIR], { stdio: 'inherit' })
  if (unzip.status !== 0) fail('解压失败，请手动解压')

  fs.rmSync(zipPath, { force: true })
  log('✓ 客户端已就绪\n')
}

// ------------------------------------------------------------------ 配置文件

function parseIni(text) {
  const out = { common: {}, tunnels: {} }
  let section = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/[;#].*$/, '').trim()
    if (!line) continue
    const header = /^\[(.+)]$/.exec(line)
    if (header) {
      section = header[1]
      if (section !== 'common') out.tunnels[section] = {}
      continue
    }
    const kv = /^([^=]+)=(.*)$/.exec(line)
    if (!kv || !section) continue
    const key = kv[1].trim()
    const value = kv[2].trim()
    if (section === 'common') out.common[key] = value
    else out.tunnels[section][key] = value
  }
  return out
}

function ensureConfig(binaryDir) {
  const target = path.join(binaryDir, 'frpc.ini')
  if (fs.existsSync(target)) return target

  const template = path.join(FRP_DIR, 'frpc.ini.example')
  if (!fs.existsSync(template)) fail('缺少 deploy/frpc/frpc.ini.example，无法生成配置')
  fs.copyFileSync(template, target)
  log(`ℹ  未找到 frpc.ini，已从模板生成：${path.relative(ROOT, target)}`)
  return target
}

// ------------------------------------------------------------------ 连通性

async function checkLocalService() {
  const url = `http://127.0.0.1:${LOCAL_PORT}/api/health`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    const body = await res.json()
    return body?.ok ? body.data : null
  } catch {
    return null
  }
}

async function checkPublicService(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(8000) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ 主流程

async function main() {
  log('\x1b[1mChmlFrp 内网穿透启动器\x1b[0m\n')

  let binary = findBinary(FRP_DIR)
  if (!binary && flags.has('--download')) {
    downloadClient()
    binary = findBinary(FRP_DIR)
  }
  if (!binary) {
    fail(
      `未找到 ${BIN_NAME}。请任选其一：\n` +
        `  · node scripts/tunnel.mjs --download   （自动下载）\n` +
        `  · 从 https://panel.chmlfrp.net/tunnel/download 手动下载后解压到 deploy/frpc/`,
    )
  }
  log(`✓ 客户端：${path.relative(ROOT, binary)}`)

  const configPath = ensureConfig(path.dirname(binary))
  const ini = parseIni(fs.readFileSync(configPath, 'utf8'))
  const { server_addr: serverAddr, server_port: serverPort } = ini.common
  const tunnelEntries = Object.entries(ini.tunnels)
  if (!serverAddr || !tunnelEntries.length) fail('frpc.ini 内容不完整，请从面板重新生成配置')

  const localHealthy = await checkLocalService()
  if (!localHealthy) {
    fail(`本地服务未就绪：http://127.0.0.1:${LOCAL_PORT}/api/health 无响应。请先执行 npm start。`)
  }
  log(`✓ 本地服务：http://127.0.0.1:${LOCAL_PORT}  存储驱动=${localHealthy.store?.driver}`)

  const publicUrls = []
  for (const [name, tunnel] of tunnelEntries) {
    const url = `http://${serverAddr}:${tunnel.remote_port}`
    publicUrls.push({ name, url, local: tunnel.local_port })
    log(`✓ 隧道 ${name}：本地 ${tunnel.local_ip}:${tunnel.local_port} → 公网 ${url}`)
  }

  if (flags.has('--check')) {
    log('\n仅体检模式，未启动隧道。\n')
    return
  }

  log(`\n🚀 启动 frpc（Ctrl+C 结束）\n`)
  const child = spawn(binary, ['-c', path.basename(configPath)], {
    cwd: path.dirname(binary),
    stdio: 'inherit',
    windowsHide: false,
  })

  child.on('exit', (code) => {
    log(`\nfrpc 已退出（code=${code}）`)
    process.exit(code ?? 0)
  })
  process.on('SIGINT', () => {
    child.kill('SIGINT')
    process.exit(0)
  })

  // 等隧道建立后自动验一次公网可达性，省去手动开浏览器
  setTimeout(async () => {
    for (const item of publicUrls) {
      const health = await checkPublicService(item.url)
      if (health?.status === 'up') {
        log(`\x1b[32m✓ 公网验证通过\x1b[0m ${item.url}  （手机浏览器直接打开这个地址）`)
      } else {
        log(
          `\x1b[33m! 暂时无法从本机访问 ${item.url}\x1b[0m\n` +
            `  可能原因：隧道刚建立、外网端口与面板不一致、或本地网络回环受限。\n` +
            `  请用手机流量访问该地址确认。`,
        )
      }
    }
  }, 4000)
}

main().catch((err) => fail(err.message))
