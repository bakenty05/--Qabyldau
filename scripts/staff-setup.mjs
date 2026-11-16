import { openStore, token, digest, transaction } from '../server/store.mjs'
const db=openStore()
try {
  if(db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) throw new Error('Әкімші аккаунты бар. Жаңа әкімші құрылмады. Бар аккаунтпен кіріңіз.')
  const raw=token()
  transaction(db,()=>{db.prepare('DELETE FROM bootstrap_keys WHERE used_at IS NULL').run();db.prepare('INSERT INTO bootstrap_keys(token_hash,expires_at) VALUES (?,?)').run(digest(raw),Date.now()+86400000)})
  console.log(`Әкімші тіркелуі (24 сағат, бір рет):\n${process.env.APP_ORIGIN || 'http://127.0.0.1:5173'}/#setup=${raw}`)
} catch(error) { console.error(error.message);process.exitCode=1 } finally {db.close()}
