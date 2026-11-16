import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const target=resolve('.backups')
mkdirSync(target,{recursive:true})
const db=new DatabaseSync(process.env.STAFF_DB_PATH || '.data/staff.sqlite',{readOnly:true})
try {
  const file=resolve(target,`qabyldau-${new Date().toISOString().replaceAll(':','-')}.sqlite`)
  db.prepare('VACUUM INTO ?').run(file)
  console.log(`Сақтық көшірме: ${file}`)
} finally {db.close()}
