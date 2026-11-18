import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync, readdirSync, utimesSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApp } from './app.mjs'
import { openStore, passwordHash, verifyPassword, digest, localDate } from './store.mjs'
import { issuePasswordReset } from './passwords.mjs'
import { createOperations, restoreToNewFile, verifyDatabase } from './operations.mjs'

function temporary() {mkdirSync('.tmp',{recursive:true});return mkdtempSync(resolve('.tmp','security-test-'))}
async function fixture(t) {
  const db=openStore(':memory:')
  const operations=createOperations(db,{directory:temporary(),log:()=>{}})
  const {server}=createApp({db,operations,origin:'http://localhost:5173'})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{operations.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close()})
  async function request(path,data,cookie,method='POST') {
    const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:data===undefined?'GET':method,headers:{'Content-Type':'application/json',Origin:'http://localhost:5173',...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)})
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}
  }
  function user(role='staff',status='active') {
    const id=randomUUID(),username='test'+id.slice(0,8),password='Original test password 12345'
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1,?,NULL,NULL)').run(id,username,'Сынақ Қызметкер',passwordHash(password),role,status,Date.now())
    return {id,username,password}
  }
  const login=async account=>(await request('/api/auth/login',account)).cookie
  const date=new Date(localDate()+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+1)
  while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()+1)
  const booking={departmentId:'general-reception',fullName:'Сынақ Азамат',phone:'+77001112233',issue:'Қабылдау үшін сынақ мәселесі',date:date.toISOString().slice(0,10),time:'09:30',consent:true}
  return {db,operations,request,user,login,booking}
}
const nextPassword='New secure test password 67890'

test('changing a password requires the current password and revokes every session and reset token',async t=>{
  const f=await fixture(t),user=f.user(),first=await f.login(user),second=await f.login(user),reset=issuePasswordReset(f.db,user.id)
  assert.equal((await f.request('/api/auth/password',{currentPassword:'incorrect',newPassword:nextPassword},first)).status,400)
  assert.equal((await f.request('/api/auth/password',{currentPassword:user.password,newPassword:'short'},first)).status,400)
  assert.equal((await f.request('/api/auth/password',{currentPassword:user.password,newPassword:user.password},first)).status,400)
  const result=await f.request('/api/auth/password',{currentPassword:user.password,newPassword:nextPassword},first)
  assert.equal(result.status,200);assert.equal(result.cookie,'eq_session=')
  for(const cookie of [first,second]) assert.equal((await f.request('/api/auth/session',undefined,cookie)).body.user,null)
  assert.equal((await f.request('/api/auth/reset-password',{token:reset.token,newPassword:'Another secure password 67890'})).status,400)
  assert.equal((await f.request('/api/auth/login',user)).status,401)
  assert.equal((await f.request('/api/auth/login',{username:user.username,password:nextPassword})).status,200)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='password.changed'").get().n,1)
})

test('recovery requests do not disclose whether an account exists and do not reset it',async t=>{
  const f=await fixture(t),user=f.user(),disabled=f.user('staff','disabled')
  const responses=await Promise.all([f.request('/api/auth/recovery',{username:user.username}),f.request('/api/auth/recovery',{username:'unknown.user'}),f.request('/api/auth/recovery',{username:disabled.username})])
  for(const result of responses){assert.equal(result.status,200);assert.deepEqual(result.body,responses[0].body)}
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM recovery_requests').get().n,1)
  assert.equal((await f.request('/api/auth/login',user)).status,200)
  assert.equal((await f.request('/api/admin/recovery')).status,401)
  const staffCookie=await f.login(user)
  assert.equal((await f.request('/api/admin/recovery',undefined,staffCookie)).status,403)
})

test('recovery requests and wrong-password attempts are rate limited',async t=>{
  const f=await fixture(t),user=f.user(),cookie=await f.login(user)
  for(let i=0;i<5;i++) assert.equal((await f.request('/api/auth/recovery',{username:user.username})).status,200)
  assert.equal((await f.request('/api/auth/recovery',{username:user.username})).status,429)
  for(let i=0;i<5;i++) assert.equal((await f.request('/api/auth/password',{currentPassword:'wrong',newPassword:nextPassword},cookie)).status,400)
  assert.equal((await f.request('/api/auth/password',{currentPassword:user.password,newPassword:nextPassword},cookie)).status,429)
})

test('only a reauthenticated administrator can issue a reset for an active employee',async t=>{
  const f=await fixture(t),admin=f.user('admin'),staff=f.user(),disabled=f.user('staff','disabled'),adminCookie=await f.login(admin),staffCookie=await f.login(staff)
  const route=`/api/admin/users/${staff.id}/reset-password`
  assert.equal((await f.request(route,{currentPassword:staff.password},staffCookie)).status,403)
  assert.equal((await f.request(route,{currentPassword:'wrong'},adminCookie)).status,400)
  assert.equal((await f.request(`/api/admin/users/${admin.id}/reset-password`,{currentPassword:admin.password},adminCookie)).status,400)
  assert.equal((await f.request(`/api/admin/users/${disabled.id}/reset-password`,{currentPassword:admin.password},adminCookie)).status,400)
  await f.request('/api/auth/recovery',{username:staff.username})
  const response=await f.request(route,{currentPassword:admin.password},adminCookie)
  assert.equal(response.status,201);assert.match(response.body.token,/^[a-f0-9]{64}$/)
  assert.ok(response.body.expiresAt>Date.now()+29*60000)
  assert.equal(f.db.prepare('SELECT token_hash FROM password_resets').get().token_hash,digest(response.body.token))
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM recovery_requests').get().n,0)
  assert.equal((await f.request('/api/admin/users',undefined,adminCookie)).body.users.some(user=>'password_hash' in user||'token' in user),false)
})

test('reset links expire, are replaced by new links and can be consumed only once under concurrency',async t=>{
  const f=await fixture(t),user=f.user(),cookie=await f.login(user),old=issuePasswordReset(f.db,user.id),current=issuePasswordReset(f.db,user.id)
  assert.equal((await f.request('/api/auth/reset-password',{token:old.token,newPassword:nextPassword})).status,400)
  f.db.prepare('UPDATE password_resets SET expires_at=?').run(Date.now()-1)
  assert.equal((await f.request('/api/auth/reset-password',{token:current.token,newPassword:nextPassword})).status,400)
  const valid=issuePasswordReset(f.db,user.id)
  const results=await Promise.all([f.request('/api/auth/reset-password',{token:valid.token,newPassword:nextPassword}),f.request('/api/auth/reset-password',{token:valid.token,newPassword:'Another secure password 98765'})])
  assert.deepEqual(results.map(result=>result.status).sort(),[200,400])
  assert.equal((await f.request('/api/auth/session',undefined,cookie)).body.user,null)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM password_resets').get().n,0)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='password.reset'").get().n,1)
})

test('disabling and re-enabling an employee cannot reactivate an old reset link',async t=>{
  const f=await fixture(t),admin=f.user('admin'),staff=f.user(),cookie=await f.login(admin),reset=issuePasswordReset(f.db,staff.id)
  await f.request(`/api/admin/users/${staff.id}`,{status:'disabled',departmentIds:[]},cookie,'PATCH')
  await f.request(`/api/admin/users/${staff.id}`,{status:'active',departmentIds:['general-reception']},cookie,'PATCH')
  assert.equal((await f.request('/api/auth/reset-password',{token:reset.token,newPassword:nextPassword})).status,400)
})

test('privacy drafts remain private, publishing requires complete approved organization text',async t=>{
  const f=await fixture(t),admin=f.user('admin'),staff=f.user(),cookie=await f.login(admin),staffCookie=await f.login(staff)
  const before=(await f.request('/api/privacy')).body.policy
  const draft={text:'[Ұйым мәтіні]',textRu:'[Текст организации]',action:'draft'}
  assert.equal((await f.request('/api/admin/privacy',draft,staffCookie)).status,403)
  assert.equal((await f.request('/api/admin/privacy',draft,cookie)).status,200)
  assert.deepEqual((await f.request('/api/privacy')).body.policy,before)
  assert.equal(JSON.stringify((await f.request('/api/settings')).body).includes(draft.text),false)
  assert.equal((await f.request('/api/admin/privacy',undefined,cookie)).body.draft.text,draft.text)
  assert.equal((await f.request('/api/admin/privacy',{...draft,action:'publish',approved:true},cookie)).status,400)
  await f.request('/api/admin/settings',{organization:'Сынақ ұйымы',address:'Сынақ мекенжайы',phone:'+77001112233'},cookie)
  const body={text:'Қазақша бекітілген шарттар. '.repeat(20),textRu:'Утверждённые условия организации. '.repeat(20),action:'publish',approved:true}
  assert.equal((await f.request('/api/admin/privacy',{...body,approved:false},cookie)).status,400)
  assert.equal((await f.request('/api/admin/privacy',{...body,text:body.text+' [толтырыңыз]'},cookie)).status,400)
  const result=await f.request('/api/admin/privacy',body,cookie)
  assert.equal(result.status,200);assert.equal(result.body.policy.approved,true)
  assert.equal((await f.request('/api/settings')).body.settings.privacyText,body.text.trim())
})

test('consent stores the displayed language and policy version; a changed policy rejects stale consent',async t=>{
  const f=await fixture(t),admin=f.user('admin'),cookie=await f.login(admin)
  await f.request('/api/admin/settings',{organization:'Сынақ ұйымы',address:'',phone:'+77001112233'},cookie)
  const publish=async suffix=>(await f.request('/api/admin/privacy',{text:('Қазақша шарттар '+suffix+'. ').repeat(20),textRu:('Русские условия '+suffix+'. ').repeat(20),action:'publish',approved:true},cookie)).body.policy
  const first=await publish('бір')
  const created=await f.request('/api/appointments',{...f.booking,consentVersion:first.version,consentLanguage:'ru'})
  assert.equal(created.status,201)
  const stored=f.db.prepare('SELECT consent_text,consent_version,created_at FROM appointments WHERE id=?').get(created.body.appointment.id)
  assert.equal(stored.consent_text,first.textRu);assert.equal(stored.consent_version,first.version);assert.ok(stored.created_at>0)
  const second=await publish('екі')
  assert.notEqual(first.version,second.version)
  assert.equal((await f.request('/api/appointments',{...f.booking,time:'10:00',consentVersion:first.version})).status,409)
  assert.deepEqual(f.db.prepare('SELECT consent_text,consent_version,created_at FROM appointments WHERE id=?').get(created.body.appointment.id),stored)
  assert.equal((await f.request('/api/appointments',{...f.booking,time:'10:00',consentVersion:second.version})).status,201)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM privacy_policies').get().n,2)
})

test('simultaneous bookings produce exactly one ticket; simultaneous employees retain department isolation',async t=>{
  const f=await fixture(t)
  const results=await Promise.all(Array.from({length:8},()=>f.request('/api/appointments',f.booking)))
  assert.equal(results.filter(result=>result.status===201).length,1)
  assert.equal(results.filter(result=>result.status===409).length,7)
  const ticket=results.find(result=>result.status===201).body.appointment
  const users=Array.from({length:4},()=>f.user())
  for(const user of users.slice(0,2))f.db.prepare('INSERT INTO staff_departments VALUES (?,?)').run(user.id,'general-reception')
  const cookies=await Promise.all(users.map(f.login))
  const lists=await Promise.all(cookies.map(cookie=>f.request('/api/staff/appointments',undefined,cookie)))
  assert.deepEqual(lists.map(result=>result.body.appointments.length),[1,1,0,0])
  const updates=await Promise.all(cookies.map(cookie=>f.request(`/api/staff/appointments/${ticket.id}`,{status:'completed',note:'Қызметтік сынақ'},cookie,'PATCH')))
  assert.deepEqual(updates.map(result=>result.status),[200,200,403,403])
})

test('automatic backup verifies a consistent database, survives restart and respects the interval',()=>{
  const db=openStore(':memory:'),directory=temporary();let time=Date.now()
  try {
    const service=createOperations(db,{directory,now:()=>time,log:()=>{}})
    service.check();const first=service.status().lastBackup
    assert.ok(first?.verified);assert.equal(service.status().databaseOk,true)
    const counts=verifyDatabase(resolve(directory,first.file));assert.equal(counts.departments,2)
    service.check();assert.equal(service.status().lastBackup.file,first.file)
    const restarted=createOperations(db,{directory,now:()=>time,log:()=>{}})
    restarted.check();assert.equal(restarted.status().lastBackup.file,first.file)
    time+=25*3600000;restarted.check();assert.notEqual(restarted.status().lastBackup.file,first.file)
  } finally {db.close()}
})

test('backup retention deletes only managed expired copies after a verified new copy exists',()=>{
  const db=openStore(':memory:'),directory=temporary()
  try {
    const service=createOperations(db,{directory,retentionDays:1,log:()=>{}}),first=service.runBackup()
    const firstPath=resolve(directory,first.file),old=new Date(Date.now()-3*86400000)
    utimesSync(firstPath,old,old)
    const unrelated=resolve(directory,'keep-my-private-copy.sqlite');writeFileSync(unrelated,'not managed');utimesSync(unrelated,old,old)
    service.runBackup()
    assert.equal(existsSync(firstPath),false);assert.equal(existsSync(unrelated),true)
    assert.equal(readdirSync(directory).filter(name=>name.startsWith('qabyldau-')).length,1)
  } finally {db.close()}
})

test('a failed backup alerts monitoring without deleting a prior good copy and recovers after retry',()=>{
  const directory=temporary(),db=openStore(':memory:'),service=createOperations(db,{directory,log:()=>{}})
  const first=service.runBackup();db.close()
  assert.throws(()=>service.runBackup(),/Сақтық көшірме жасалмады/)
  assert.equal(service.status().healthy,false);assert.ok(service.status().lastFailureAt)
  assert.equal(existsSync(resolve(directory,first.file)),true)
  const live=openStore(':memory:')
  try {const recovered=createOperations(live,{directory,log:()=>{}});recovered.runBackup();assert.equal(recovered.status().healthy,true)}finally{live.close()}
})

test('an unavailable backup directory does not prevent monitoring from reporting failure',()=>{
  const directory=temporary(),file=resolve(directory,'not-a-directory');writeFileSync(file,'occupied')
  const db=openStore(':memory:')
  try {const service=createOperations(db,{directory:file,log:()=>{}});service.check();assert.equal(service.status().healthy,false);assert.ok(service.status().lastError)}finally{db.close()}
})

test('restore drill preserves rows and password hashes and cannot overwrite an existing destination',()=>{
  const directory=temporary(),source=resolve(directory,'live.sqlite'),db=openStore(source),id=randomUUID(),password='Restore drill secure password'
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1,?,NULL,NULL)').run(id,'restore.user','Қалпына Сынақ',passwordHash(password),'admin','active',Date.now())
  try {
    const service=createOperations(db,{directory:resolve(directory,'backups'),log:()=>{}}),backup=service.runBackup(),destination=resolve(directory,'restored.sqlite')
    const result=restoreToNewFile(resolve(directory,'backups',backup.file),destination)
    assert.equal(result.counts.users,1)
    const restored=openStore(destination)
    try {assert.equal(verifyPassword(password,restored.prepare('SELECT password_hash FROM users WHERE id=?').get(id).password_hash),true)}finally{restored.close()}
    const before=readFileSync(destination)
    assert.throws(()=>restoreToNewFile(resolve(directory,'backups',backup.file),destination))
    assert.deepEqual(readFileSync(destination),before)
    assert.throws(()=>restoreToNewFile(source,source))
  } finally {db.close()}
})

test('operations and manual backups are administrator-only; public health detects a closed database',async t=>{
  const f=await fixture(t),staff=f.user(),admin=f.user('admin'),staffCookie=await f.login(staff),adminCookie=await f.login(admin)
  assert.equal((await f.request('/api/admin/operations')).status,401)
  assert.equal((await f.request('/api/admin/operations',undefined,staffCookie)).status,403)
  assert.equal((await f.request('/api/admin/operations/backup',{},staffCookie)).status,403)
  assert.equal((await f.request('/api/admin/operations/backup',{},adminCookie)).status,201)
  assert.equal((await f.request('/api/admin/operations',undefined,adminCookie)).body.lastBackup.verified,true)
  assert.deepEqual((await f.request('/api/health')).body,{ok:true})
  const db=openStore(':memory:'),{server}=createApp({db})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));db.close()
  try {const response=await fetch(`http://127.0.0.1:${server.address().port}/api/health`);assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false})}finally{await new Promise(resolve=>server.close(resolve))}
})
