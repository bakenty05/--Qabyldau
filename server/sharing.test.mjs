import test from 'node:test'
import assert from 'node:assert/strict'
import { sharingDeadline, tunnelOutputParser, isTunnelHealthy } from '../scripts/share-utils.mjs'

test('a restarted tunnel keeps the original deadline and cannot extend an expired day', () => {
  assert.equal(sharingDeadline(undefined, 100), 86400100)
  assert.equal(sharingDeadline({ expiresAt: 300 }, 100), 300)
  assert.throws(() => sharingDeadline({ expiresAt: 99 }, 100), /period has ended/)
})

test('tunnel addresses split across output chunks and rotated domains are detected', () => {
  const urls = [], parse = tunnelOutputParser(url => urls.push(url))
  parse('Welcome https://localhost.run/docs https://admin.localhost.run\nhttps://abc1.lh')
  parse('r.life tunneled\n')
  parse('Again https://abc1.lhr.life\n')
  parse('New domain https://abc2.lhr.life\n')
  parse('Still connected\n')
  assert.deepEqual(urls, ['https://abc1.lhr.life', 'https://abc2.lhr.life'])
})

test('JSON events can supply tunnel URLs but arbitrary domains are rejected', () => {
  const urls = [], parse = tunnelOutputParser(url => urls.push(url))
  parse('{"address":"https://safe123.lhr.life"}\n')
  parse('https://attacker.example.com\n')
  assert.deepEqual(urls, ['https://safe123.lhr.life'])
})

test('a proxy error or success page cannot pass the public health check', () => {
  for (const body of ['no tunnel', '<html>ok</html>', '{"ok":false}', 'null']) assert.equal(isTunnelHealthy(body), false)
  assert.equal(isTunnelHealthy('{"ok":true}'), true)
})

test('Cloudflare logs select only the visitor URL, including when split between chunks', () => {
  const urls=[],parse=tunnelOutputParser(url=>urls.push(url))
  parse('Failed Post "https://api.trycloudflare.com/tunnel"\n')
  parse('INF Your quick Tunnel has been created: https://quiet-blue-')
  parse('calendar-demo.trycloudflare.')
  parse('com\nINF Connected to Cloudflare\n')
  parse('INF URL: https://quiet-blue-calendar-demo.trycloudflare.com\n')
  assert.deepEqual(urls,['https://quiet-blue-calendar-demo.trycloudflare.com'])
})
