// dsh-reload-button — host half.
// 一键重启 dsh 后端（WSL systemd 主环境：systemctl restart dsh-web.service）。
// 先回 200，短延迟后再调度重启（延迟自杀）：浏览器收到确认后进程才消失，
// Electron 窗口保持打开，client 半在本页或重载后的新页里用遮罩盖住重载过程。
//
// 路由面（全部 loopback-only）：
//   POST /api/dsh-reload-button/reload      请求重启（响应先于进程退出送达）
//   GET|POST /api/dsh-reload-button/ping    健康探测（恢复轮询用）
//   GET  /api/dsh-reload-button/whale.svg   遮罩中间的 DeepSeek 鲸鱼图标
//
// 只 import node: 内置模块 —— 不 import 任何 @deepseek-ai/* 运行时包。

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-reload-button'
/** webServer 就绪后才 apply（Cordis 硬依赖，避免 apply 时拿到 undefined）。 */
export const inject = ['webServer']

const RELOAD_API = '/api/dsh-reload-button/reload'
const PING_API = '/api/dsh-reload-button/ping'
const WHALE_API = '/api/dsh-reload-button/whale.svg'

/** 响应 flush 后到发起重启的延迟：给 fetch 足够时间收下 200。 */
const RESTART_DELAY_MS = 900

/** 鲸鱼图标：懒加载自包内 assets/whale.svg（与 DSH favicon 同源）。 */
const WHALE_SVG = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'whale.svg'),
).catch(() => null)

/** 仅接受环回地址的控制面请求（复制 desktop-launcher 的 fence 语义）。 */
function isLoopbackRequest(req) {
  const addr = req.socket && req.socket.remoteAddress
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/**
 * 调度后端重启（快速路径）。
 *
 * 为什么不用 `systemctl restart`：实测 dsh 优雅退出（SIGTERM）在有活跃连接
 * 时会卡住 90 秒，被 systemd 默认 TimeoutStopSec 判超时 SIGKILL（日志：
 * "State 'stop-sigterm' timed out. Killing."），用户感知为"重启卡很久"。
 * 改用 `systemctl kill -s SIGKILL`：systemd 收到后立即杀进程树，unit 因
 * 信号终止命中 Restart=on-failure + RestartSec=3，约 4~6 秒内自动拉起，
 * 与 timeout 兜底最终路径（同样 SIGKILL）等价，只是不再空等 90 秒。
 *
 * systemctl kill 是独立 D-Bus 客户端：请求提交后本进程即使被杀也不影响
 * systemd 的执行（延迟自杀）。
 */
function scheduleRestart(ctx) {
  const child = spawn('systemctl', ['kill', '-s', 'SIGKILL', 'dsh-web.service'], {
    detached: true,
    stdio: 'ignore',
  })
  child.on('error', (error) => {
    const log = (ctx.logger || console)
    log.warn(`[dsh-reload-button] systemctl kill 启动失败：${error.message}`)
  })
  child.unref()
}

export function apply(ctx) {
  // 重启请求：200 先行，延迟后调度重启。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RELOAD_API,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { ok: false, code: 'forbidden' })
        return
      }
      writeJson(res, 200, { ok: true, restarting: true })
      setTimeout(() => scheduleRestart(ctx), RESTART_DELAY_MS)
    },
  }), 'dsh-reload-button: reload')

  // 健康探测：client 遮罩轮询用它判断后端是否恢复。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PING_API,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      writeJson(res, 200, { ok: true, alive: true })
    },
  }), 'dsh-reload-button: ping')

  // 鲸鱼图标（遮罩用；缺失时 404，client 回退文字）。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: WHALE_API,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      if (WHALE_SVG === null) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('whale.svg not bundled')
        return
      }
      res.writeHead(200, {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=86400',
      })
      if (req.method === 'GET') res.end(WHALE_SVG)
      else res.end()
    },
  }), 'dsh-reload-button: whale.svg')
}

export default { name, inject, apply }