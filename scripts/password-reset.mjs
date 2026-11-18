import { openStore } from '../server/store.mjs'
import { issuePasswordReset } from '../server/passwords.mjs'
const username=process.argv[2]?.trim().toLowerCase()
if(!username) throw new Error('Қолдану: npm run password:reset -- <логин>')
const db=openStore()
try {
  const user=db.prepare("SELECT id FROM users WHERE username=? AND status='active'").get(username)
  if(!user) throw new Error('Белсенді аккаунт табылмады.')
  const origin=new URL(process.env.APP_ORIGIN || `http://127.0.0.1:${process.env.PORT||3001}`)
  if(!['http:','https:'].includes(origin.protocol) || (process.env.NODE_ENV==='production' && origin.protocol!=='https:')) throw new Error('APP_ORIGIN мәнін тексеріңіз.')
  const result=issuePasswordReset(db,user.id)
  console.log('Жеке бір реттік сілтеме (30 минут). Тек аккаунт иесіне беріңіз:')
  console.log(`${origin.origin}/#reset=${result.token}`)
} finally {db.close()}
