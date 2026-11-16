import test from 'node:test'
import assert from 'node:assert/strict'
import { api } from '../src/api.ts'

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

test('a lost tunnel shows a translated error for both 502 and misleading 200 responses', async t => {
  for (const status of [502, 200]) {
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('no tunnel', { status }))
    await assert.rejects(api('/api/departments'), error => !/Unexpected token|not valid JSON/.test(error.message) && error.message.includes('сыртқы байланысы үзілді'))
    assert.equal(fetch.mock.callCount(), 2)
    fetch.mock.restore()
  }
})

test('HTML, invalid JSON and null cannot become a successful API result', async t => {
  for (const [body, type] of [['<html>Bad gateway</html>', 'text/html'], ['broken', 'application/json'], ['null', 'application/json']]) {
    const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(body, { headers: { 'Content-Type': type } }))
    await assert.rejects(api('/api/settings'), /байланыс орнамады/)
    fetch.mock.restore()
  }
})

test('a temporary GET failure recovers without losing the successful response', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? new Response('no tunnel', { status: 502 }) : json({ departments: [] }))
  assert.deepEqual(await api('/api/departments'), { departments: [] })
  assert.equal(calls, 2)
})

test('a booking is never sent twice after a broken connection', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(api('/api/appointments', { fullName: 'Тест Азамат' }), /байланыс орнамады/)
  assert.equal(fetch.mock.callCount(), 1)
  assert.equal(fetch.mock.calls[0].arguments[1].credentials, 'same-origin')
})

test('validation errors keep the server message and are not retried', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({ error: 'Күнді таңдаңыз.' }, 400))
  await assert.rejects(api('/api/appointments', {}), { message: 'Күнді таңдаңыз.' })
  assert.equal(fetch.mock.callCount(), 1)
})

test('an expired session notifies the app without retrying the request', async t => {
  const events = []
  globalThis.window = { dispatchEvent: event => events.push(event.type) }
  t.after(() => { delete globalThis.window })
  const fetch = t.mock.method(globalThis, 'fetch', async () => json({ error: 'Кабинетке қайта кіріңіз.' }, 401))
  await assert.rejects(api('/api/admin/users'), /Кабинетке қайта кіріңіз/)
  assert.deepEqual(events, ['session-expired'])
  assert.equal(fetch.mock.callCount(), 1)
})

test('cancelling an old request does not retry or replace its abort reason', async t => {
  const controller = new AbortController()
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    controller.abort()
    throw controller.signal.reason
  })
  await assert.rejects(api('/api/availability', undefined, 'GET', controller.signal), { name: 'AbortError' })
  assert.equal(fetch.mock.callCount(), 1)
})

test('a hung write times out with a translated message and no duplicate write', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const fetch = t.mock.method(globalThis, 'fetch', async (_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
  }))
  const pending = api('/api/appointments', {})
  const rejection = assert.rejects(pending, /Сервер ұзақ жауап бермеді/)
  t.mock.timers.tick(15000)
  await rejection
  assert.equal(fetch.mock.callCount(), 1)
})

test('ordinary user text mentioning no tunnel does not break valid JSON', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({ issue: 'no tunnel' }))
  assert.deepEqual(await api('/api/tickets/test'), { issue: 'no tunnel' })
})
