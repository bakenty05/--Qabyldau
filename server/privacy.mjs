import { digest, DEFAULT_PRIVACY_TEXT } from './store.mjs'

export function currentPolicy(db) {
  const row = db.prepare('SELECT * FROM privacy_policies ORDER BY published_at DESC,rowid DESC LIMIT 1').get()
  if (row) return { version: row.version, text: row.text_kk, textRu: row.text_ru, publishedAt: row.published_at, approved: true }
  const legacy = db.prepare("SELECT value FROM app_settings WHERE key='privacyText'").get()?.value?.trim()
  const text = legacy || DEFAULT_PRIVACY_TEXT
  return { version: digest(text), text, textRu: '', publishedAt: null, approved: false }
}
