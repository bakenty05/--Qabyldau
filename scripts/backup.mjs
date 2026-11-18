import { DatabaseSync } from 'node:sqlite'
import { createOperations } from '../server/operations.mjs'
const db=new DatabaseSync(process.env.STAFF_DB_PATH || '.data/staff.sqlite',{readOnly:true})
try {
  console.log(JSON.stringify(createOperations(db).runBackup(),null,2))
} finally {db.close()}
