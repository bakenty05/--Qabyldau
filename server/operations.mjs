import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, statSync, readFileSync, writeFileSync, renameSync, unlinkSync, copyFileSync, constants } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const managedName = /^qabyldau-\d{4}-\d{2}-\d{2}T[\d.-]+Z(?:-[a-f0-9-]+)?\.sqlite$/
const numeric = (value, fallback, min, max) => {
  const result = value===undefined ? fallback : Number(value)
  if (!Number.isFinite(result) || result<min || result>max) throw new Error('Сақтық көшірме баптаулары дұрыс емес.')
  return result
}

export function verifyDatabase(file) {
  const candidate = new DatabaseSync(file,{readOnly:true})
  try {
    if (candidate.prepare('PRAGMA quick_check').all().some(row=>Object.values(row)[0]!=='ok') || candidate.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Дерекқор тұтастығын тексеру өтпеді.')
    const counts={}
    for(const table of ['users','departments','appointments','audit_events']) counts[table]=candidate.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
    return counts
  } finally {candidate.close()}
}

export function restoreToNewFile(source, destination) {
  if(resolve(source)===resolve(destination)) throw new Error('Қалпына келтіру үшін жаңа файл жолын таңдаңыз.')
  const counts=verifyDatabase(source)
  mkdirSync(dirname(resolve(destination)),{recursive:true})
  copyFileSync(source,destination,constants.COPYFILE_EXCL)
  verifyDatabase(destination)
  return {file:resolve(destination),counts}
}

export function createOperations(db, {directory=process.env.BACKUP_DIR || '.backups', intervalHours=process.env.BACKUP_INTERVAL_HOURS, retentionDays=process.env.BACKUP_RETENTION_DAYS, enabled=process.env.BACKUP_ENABLED!=='false', now=Date.now, log=message=>console.error(message)}={}) {
  const root=resolve(directory), intervalMs=numeric(intervalHours,24,0.01,720)*3600000
  const source=db.prepare('PRAGMA database_list').get().file || ':memory:'
  const retentionMs=numeric(retentionDays,30,1,3650)*86400000
  const startedAt=now(), statePath=resolve(root,'operations.json')
  let lastBackup=null,lastFailureAt=null,lastError=null,databaseOk=true,checkedAt=null,timer=null,requests=0,serverErrors=0
  const files=()=>readdirSync(root).filter(name=>managedName.test(name)).map(name=>({file:name,createdAt:statSync(resolve(root,name)).mtimeMs})).sort((a,b)=>b.createdAt-a.createdAt)
  try {
    mkdirSync(root,{recursive:true})
    const saved=JSON.parse(readFileSync(statePath,'utf8'))
    if(saved.source!==source) throw new Error('Different database')
    if (saved.lastBackup && managedName.test(saved.lastBackup.file)) {
      const file=resolve(root,saved.lastBackup.file)
      const counts=verifyDatabase(file)
      lastBackup={file:basename(file),createdAt:statSync(file).mtimeMs,counts,verified:true}
    }
    lastFailureAt=saved.lastFailureAt||null;lastError=saved.lastError||null
  } catch { /* Missing or invalid state triggers a fresh verified backup. */ }
  const persist=()=>{
    const temporary=resolve(root,`operations-${randomUUID()}.tmp`)
    writeFileSync(temporary,JSON.stringify({source,lastBackup,lastFailureAt,lastError}),{mode:0o600})
    renameSync(temporary,statePath)
  }
  function runBackup() {
    const stamp=new Date(now()).toISOString().replaceAll(':','-')
    const file=`qabyldau-${stamp}-${randomUUID()}.sqlite`, destination=resolve(root,file)
    try {
      mkdirSync(root,{recursive:true})
      db.prepare('VACUUM INTO ?').run(destination)
      const counts=verifyDatabase(destination)
      lastBackup={file,createdAt:now(),counts,verified:true}
      lastError=null
      persist()
      // Only managed files expire. Preserve the new verified backup.
      for(const item of files()) if(item.file!==file && item.createdAt<now()-retentionMs) unlinkSync(resolve(root,item.file))
      return lastBackup
    } catch(error) {
      lastFailureAt=now();lastError='Сақтық көшірме жасалмады. Диск пен сервер баптауларын тексеріңіз.'
      try {persist()} catch { /* The in-memory alert remains if storage is unavailable. */ }
      log(JSON.stringify({event:'backup.failed',at:lastFailureAt,code:error.code||error.name}))
      throw new Error(lastError)
    }
  }
  function check() {
    checkedAt=now()
    try {
      databaseOk=db.prepare('PRAGMA quick_check').all().every(row=>Object.values(row)[0]==='ok') && db.prepare('PRAGMA foreign_key_check').all().length===0
    } catch {databaseOk=false}
    if(!databaseOk) log(JSON.stringify({event:'database.unhealthy',at:checkedAt}))
    if(enabled && (!lastBackup || now()-lastBackup.createdAt>=intervalMs || lastError) && (!lastError || now()-(lastFailureAt||0)>=5*60000)) {
      try {runBackup()} catch { /* Status exposes the failure; retry on the next check. */ }
    }
  }
  function status() {
    const overdue=enabled && (!lastBackup || now()-lastBackup.createdAt>intervalMs+5*60000)
    return {available:true,enabled,healthy:databaseOk&&!lastError&&!overdue,databaseOk,checkedAt,startedAt,uptimeSeconds:Math.floor((now()-startedAt)/1000),intervalHours:intervalMs/3600000,retentionDays:retentionMs/86400000,lastBackup,lastFailureAt,lastError,overdue,nextBackupAt:enabled?(lastBackup?.createdAt||now())+intervalMs:null,requests,serverErrors}
  }
  return {status,runBackup,check,recordResponse:code=>{requests++;if(code>=500)serverErrors++},start(){if(timer)return;check();timer=setInterval(check,60000);timer.unref()},stop(){clearInterval(timer);timer=null}}
}
