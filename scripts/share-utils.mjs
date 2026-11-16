export function sharingDeadline(previous, now = Date.now()) {
  const expiresAt = previous?.expiresAt ?? now + 86400000
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('The sharing period has ended. Start a new period explicitly with --new-day.')
  return expiresAt
}

export function tunnelOutputParser(onUrl) {
  let tail = '', lastUrl = ''
  return chunk => {
    tail = (tail + chunk.toString()).replace(/\x1b\[[0-9;]*m/g, '')
    const urls = [...tail.matchAll(/https:\/\/[a-z0-9-]+\.(?:lhr\.life|trycloudflare\.com)(?=[\s"'\\/]|$)/g)]
    let consumed = 0
    for (const match of urls) {
      consumed = match.index + match[0].length
      if (match[0]==='https://api.trycloudflare.com') continue
      if (match[0] !== lastUrl) { lastUrl = match[0]; onUrl(lastUrl) }
    }
    tail = tail.slice(consumed).slice(-512)
  }
}

export function isTunnelHealthy(body) {
  try { return JSON.parse(body).ok === true }
  catch { return false }
}
