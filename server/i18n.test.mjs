import test from 'node:test'
import assert from 'node:assert/strict'
import { getLanguage, setLanguage, subscribeLanguage, t } from '../src/i18n.ts'
import { formatReceptionDate } from '../src/reception-calendar.ts'

test('language changes translate dates and stored messages without changing personal text',tcase=>{
  tcase.after(()=>setLanguage('kk'))
  const changes=[]
  const unsubscribe=subscribeLanguage(()=>changes.push(getLanguage()))
  setLanguage('ru')
  assert.equal(t('Бөлім'),'Отдел')
  assert.equal(t('  Бөлім  '),'  Отдел  ')
  assert.equal(t('Сынақ Азамат'),'Сынақ Азамат')
  assert.match(formatReceptionDate('2026-11-16'),/ноября/)
  const storedMessage=t('Бос уақытты таңдаңыз.')
  setLanguage('kk')
  assert.equal(t(storedMessage),'Бос уақытты таңдаңыз.')
  assert.match(formatReceptionDate('2026-11-16'),/қараша/)
  unsubscribe()
  assert.deepEqual(changes,['ru','kk'])
})
