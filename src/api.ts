const connectionMessage = 'Сервермен байланыс орнамады. Интернетті тексеріп, «Қайталау» батырмасын басыңыз.'
const tunnelMessage = 'Сайттың уақытша сыртқы байланысы үзілді. Сәлден соң бетті жаңартыңыз. Сілтеме ашылмаса, жаңа сілтемені қолданыңыз.'

class ApiError extends Error {
  retryable: boolean
  constructor(message: string, retryable = false) {
    super(message)
    this.retryable = retryable
  }
}

export const errorMessage = (error: unknown) => error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError)
  ? error.message : connectionMessage

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (/^\s*no tunnel\s*$/i.test(text)) throw new ApiError(tunnelMessage, true)
  const retryable = [408, 500, 502, 503, 504].includes(response.status)
  if (!/\bapplication\/(?:json|[\w.+-]+\+json)\b/i.test(response.headers.get('content-type') || '')) {
    throw new ApiError(connectionMessage, response.ok || retryable)
  }
  let result: unknown
  try { result = JSON.parse(text) }
  catch { throw new ApiError(connectionMessage, response.ok || retryable) }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ApiError(connectionMessage, retryable)
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'))
    const message = 'error' in result && typeof result.error === 'string' ? result.error : 'Сұрау орындалмады. Қайталап көріңіз.'
    throw new ApiError(message, retryable)
  }
  return result
}

export async function api<T>(path: string, data?: unknown, method = 'POST', signal?: AbortSignal): Promise<T> {
  const requestMethod = data === undefined ? 'GET' : method
  const attempts = requestMethod === 'GET' ? 2 : 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted()
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(path, {
        credentials: 'same-origin', method: requestMethod,
        headers: data === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal,
      })
      return await readResponse(response) as T
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      const failure = error instanceof ApiError ? error : new ApiError(controller.signal.aborted
        ? 'Сервер ұзақ жауап бермеді. Сәлден соң қайталап көріңіз.' : connectionMessage, true)
      if (!failure.retryable || attempt === attempts - 1) throw failure
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
  throw new ApiError(connectionMessage)
}
