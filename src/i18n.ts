import { russian } from './translations.ts'

export type Language = 'kk' | 'ru'
const storageKey = 'eq-language'
let language: Language = 'kk'
try { if (typeof window !== 'undefined' && window.localStorage?.getItem(storageKey) === 'ru') language = 'ru' } catch { /* Storage can be disabled. */ }
const listeners = new Set<() => void>()
const kazakh = Object.fromEntries(Object.entries(russian).map(([kk,ru])=>[ru,kk]))

export const getLanguage = () => language
export const subscribeLanguage = (listener: () => void) => { listeners.add(listener);return () => {listeners.delete(listener)} }
export function setLanguage(value: Language) {
  if (value === language) return
  language = value
  try { if(typeof window !== 'undefined')window.localStorage?.setItem(storageKey, value) } catch { /* Keep this session usable. */ }
  for (const listener of listeners) listener()
}
export function t(value: string): string {
  const key = value.trim().replace(/\s+/g, ' ')
  const canonical = russian[key] ? key : kazakh[key] || key
  const translated = language === 'ru' ? russian[canonical] : canonical
  return translated ? value.replace(value.trim(), translated) : value
}
export const locale = () => language === 'ru' ? 'ru-RU' : 'kk-KZ'
