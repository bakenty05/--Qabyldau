import { useEffect, useSyncExternalStore } from 'react'
import { getLanguage, locale, setLanguage, subscribeLanguage } from './i18n'

export function useLanguage() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage)
  useEffect(() => {
    document.documentElement.lang = language
    document.title = language === 'ru' ? 'Е-Qabyldau — запись на приём' : 'Е-Qabyldau — қабылдауға жазылу'
    document.querySelector('meta[name="description"]')?.setAttribute('content',language === 'ru'
      ? 'Онлайн-запись на приём в акимат. Выберите дату и время и получите талон.'
      : 'Әкімдік қабылдауына онлайн жазылу. Күн мен уақытты таңдап, талон алыңыз.')
  },[language])
  return { language, setLanguage, locale: locale() }
}
