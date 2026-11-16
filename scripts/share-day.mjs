import { spawn, execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createApp } from '../server/app.mjs'
import { sharingDeadline, tunnelOutputParser, isTunnelHealthy } from './share-utils.mjs'

const statePath = resolve('.tools/share-day.json')
const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : undefined
if (previous && ['running', 'starting', 'connecting', 'reconnecting'].includes(previous.status)) {
  try {
    process.kill(previous.pid, 0)
    throw new Error('A public sharing process is already running.')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}
const expiresAt = sharingDeadline(process.argv.includes('--new-day') ? undefined : previous)
const port = 3002
const cloudflared = resolve('.tools/cloudflared-full.exe')
const provider = process.env.SHARE_PROVIDER || 'cloudflare'
if (!['cloudflare','ssh'].includes(provider)) throw new Error('Unknown sharing provider.')
if (provider==='cloudflare') {
  const verified=JSON.parse(readFileSync('.tools/cloudflared-verified.json','utf8'))
  const actual=createHash('sha256').update(readFileSync(cloudflared)).digest('hex')
  if (actual!==verified.sha256) throw new Error('Cloudflare executable verification failed.')
  writeFileSync('.tools/cloudflared-quick.yml','protocol: http2\nno-autoupdate: true\n')
}
const run = promisify(execFile)
mkdirSync(resolve('.tools'), { recursive: true })
const state = { status: 'starting', provider, pid: process.pid, port, startedAt: previous?.startedAt ?? Date.now(), expiresAt, reconnects: 0 }
let app, tunnel, startupTimer, retryTimer, healthTimer, deadlineTimer
let stopping = false, connecting = false, checking = false, failures = 0, retryDelay = 2000
let acceptingUrl = Promise.resolve(), announcedUrl = ''
let identityRejected = previous?.identityMode === 'anonymous'
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')

async function closeApp() {
  if (!app) return
  const old = app
  app = undefined
  old.server.closeAllConnections()
  await new Promise(resolve => old.server.close(resolve))
  old.db.close()
}

async function stop(reason, code = 0) {
  if (stopping) return
  stopping = true
  clearTimeout(startupTimer)
  clearTimeout(retryTimer)
  clearTimeout(deadlineTimer)
  clearInterval(healthTimer)
  state.status = 'stopped'
  state.reason = reason
  state.stoppedAt = Date.now()
  save()
  tunnel?.kill()
  await closeApp()
  console.log(reason)
  process.exitCode = code
}

async function acceptUrl(url) {
  if (stopping) return
  if (Date.now() >= expiresAt) return stop('The one-day sharing period has ended.')
  clearTimeout(startupTimer)
  if (state.url !== url || !app) {
    await closeApp()
    if (stopping) return
    app = createApp({ origin: url, production: true })
    app.server.on('error', error => stop(error.message, 1))
    await new Promise((resolve, reject) => {
      app.server.once('error', reject)
      app.server.listen(port, '127.0.0.1', resolve)
    })
  }
  Object.assign(state, { status: 'connecting', health: 'checking', url, tunnelPid: tunnel.pid })
  delete state.reason
  delete state.lastHealthyAt
  retryDelay = 2000
  failures = 0
  save()
  console.log('Tunnel URL allocated: ' + url + '; checking public DNS and HTTP access.')
  void checkHealth()
}

function reconnect(reason) {
  if (stopping || retryTimer) return
  clearTimeout(startupTimer)
  console.log(reason)
  state.status = 'reconnecting'
  state.reason = reason
  state.reconnects++
  save()
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    connect()
  }, retryDelay)
  retryDelay = Math.min(retryDelay * 2, 30000)
}

function connect() {
  if (stopping || connecting) return
  if (Date.now() >= expiresAt) return void stop('The one-day sharing period has ended.')
  connecting = true
  const key = resolve('.tools/share-key')
  const identity = existsSync(key) && !identityRejected ? ['-i', key, '-o', 'IdentitiesOnly=yes'] : []
  const user = identity.length ? 'tunnel' : 'nokey'
  state.identityMode = identity.length ? 'key' : 'anonymous'
  const sshArguments = ['-T', ...identity, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'UserKnownHostsFile=' + resolve('.tools/known_hosts'), '-o', 'ServerAliveInterval=20',
    '-o', 'ServerAliveCountMax=2', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=15',
    '-R', '80:127.0.0.1:' + port, user + '@localhost.run']
  const cloudflareArguments = ['tunnel','--config',resolve('.tools/cloudflared-quick.yml'),
    '--url','http://127.0.0.1:'+port,'--protocol','http2','--edge-ip-version','4','--no-autoupdate']
  const child = spawn(provider==='cloudflare'?cloudflared:'ssh.exe', provider==='cloudflare'?cloudflareArguments:sshArguments, {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  tunnel = child
  state.tunnelPid = child.pid
  save()
  const parse = tunnelOutputParser(url => {
    if (child === tunnel) acceptingUrl = acceptingUrl.then(() => acceptUrl(url)).catch(error => stop(error.stack || error.message, 1))
  })
  const output = chunk => {
    parse(chunk)
    const text = chunk.toString()
    if (text.includes('Permission denied')) identityRejected = true
    if (!text.includes('\u001b[')) process.stdout.write(text)
  }
  child.stdout.on('data', output)
  child.stderr.on('data', output)
  child.on('error', error => { connecting = false; reconnect(error.message) })
  child.on('exit', code => {
    if (child !== tunnel) return
    connecting = false
    reconnect('Tunnel connection ended (' + code + '); reconnecting.')
  })
  startupTimer = setTimeout(() => child.kill(), provider==='cloudflare'?90000:45000)
}

async function checkHealth() {
  if (stopping || checking || !state.url || !['connecting','running'].includes(state.status)) return
  if (Date.now() >= expiresAt) return stop('The one-day sharing period has ended.')
  checking = true
  try {
    const { stdout } = await run('curl.exe', ['--fail', '--silent', '--show-error', '--connect-timeout', '8',
      '--max-time', '12', state.url + '/api/health'], { windowsHide: true, timeout: 14000 })
    if (!isTunnelHealthy(stdout)) throw new Error('Invalid tunnel health response')
    failures = 0
    state.status = 'running'
    state.health = 'healthy'
    state.lastHealthyAt = Date.now()
    save()
    if (announcedUrl!==state.url) {
      announcedUrl=state.url
      console.log('Public URL ready: '+state.url+'\nExpires: '+new Date(expiresAt).toISOString())
    }
  } catch {
    failures++
    if (failures >= 3 && !stopping) {
      failures = 0
      if (provider==='cloudflare') {
        state.health='reconnecting'
        save()
        console.log('The public health check is unavailable; Cloudflare reconnects internally with the same URL.')
      } else {
        console.log('The public health check failed three times; reconnecting.')
        tunnel?.kill()
      }
    }
  } finally { checking = false }
}

save()
connect()
healthTimer = setInterval(() => void checkHealth(), 20000)
deadlineTimer = setTimeout(() => void stop('The one-day sharing period has ended.'), expiresAt - Date.now())
process.on('SIGINT', () => void stop('Sharing stopped.'))
process.on('SIGTERM', () => void stop('Sharing stopped.'))
process.on('uncaughtException', error => void stop(error.stack || error.message, 1))
process.on('unhandledRejection', error => void stop(String(error), 1))
