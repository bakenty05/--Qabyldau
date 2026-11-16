import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApp } from './app.mjs'
import { openStore, passwordHash, digest, token, transaction } from './store.mjs'

async function fixture(t) {
  const db=openStore(':memory:')
  const {server}=createApp({db,origin:'http://localhost:5173'})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close()})
  async function request(path,data,cookie) {
    const response=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method:data===undefined?'GET':'POST',headers:{Origin:'http://localhost:5173',...(data===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)})
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}
  }
  function booking({departmentId='general-reception',status='completed',date='2026-01-05',time='09:30',secret='123456'}={}) {
    const id=randomUUID()
    db.prepare('INSERT INTO appointments(id,access_hash,department_id,full_name,phone,issue,date,time,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,digest(secret),departmentId,'Жеке Азамат','+77771234567','Жеке мәселе',date,time,status,Date.now(),Date.now())
    return {id,secret,phone:'+77771234567'}
  }
  async function login(role) {
    const id=randomUUID(),username='stats.'+id.slice(0,8),password='statistics test password 123'
    db.prepare("INSERT INTO users(id,username,full_name,password_hash,role,status,government_employee,created_at) VALUES (?,?,?,?,?,'active',1,?)").run(id,username,'Тест Қызметкер',passwordHash(password),role,Date.now())
    return (await request('/api/auth/login',{username,password})).cookie
  }
  return {db,request,booking,login}
}

test('feedback needs the ticket secret, a completed past reception and a valid rating',async t=>{
  const f=await fixture(t),a=f.booking({status:'scheduled'})
  const path=`/api/tickets/${a.id}`
  assert.equal((await f.request(path+'/feedback',{accessToken:'wrong',rating:5,comment:''})).status,404)
  assert.equal((await f.request(path+'/feedback',{accessToken:a.secret,rating:5,comment:''})).status,409)
  assert.equal((await f.request(path,{accessToken:a.secret})).body.feedbackEligible,false)
  f.db.prepare("UPDATE appointments SET status='completed',date='2099-01-05' WHERE id=?").run(a.id)
  assert.equal((await f.request(path+'/feedback',{accessToken:a.secret,rating:5,comment:''})).status,409)
  f.db.prepare("UPDATE appointments SET date='2026-01-05' WHERE id=?").run(a.id)
  for(const rating of [0,6,2.5,'5',null])assert.equal((await f.request(path+'/feedback',{accessToken:a.secret,rating,comment:''})).status,400)
  for(const comment of ['a'.repeat(1001),[],null])assert.equal((await f.request(path+'/feedback',{accessToken:a.secret,rating:5,comment})).status,400)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM appointment_feedback').get().n,0)
  const lookup=await f.request(path,{accessToken:a.secret})
  assert.equal(lookup.body.feedbackEligible,true)
  assert.equal(lookup.body.feedback,null)
})

test('one feedback is saved per verified ticket and survives reload without leaking internal notes',async t=>{
  const f=await fixture(t),a=f.booking()
  f.db.prepare('UPDATE appointments SET note=? WHERE id=?').run('private staff note',a.id)
  const credentials={phone:a.phone,accessToken:a.secret}
  const saved=await f.request('/api/tickets/lookup/feedback',{...credentials,rating:4,comment:'  Жақсы қызмет. <script>test</script>  '})
  assert.equal(saved.status,201)
  assert.equal(saved.body.feedback.rating,4)
  assert.equal(saved.body.feedback.comment,'Жақсы қызмет. <script>test</script>')
  assert.equal(saved.body.feedbackEligible,false)
  assert.equal(saved.body.appointment.note,undefined)
  assert.equal((await f.request('/api/tickets/lookup/feedback',{...credentials,rating:1,comment:'overwrite'})).status,409)
  const reload=await f.request(`/api/tickets/${a.id}`,{accessToken:a.secret})
  assert.equal(reload.body.feedback.rating,4)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='appointment.feedback'").get().n,1)
})

test('legacy ticket secrets can submit a rating without a comment; cancelled and no-show tickets cannot',async t=>{
  const f=await fixture(t),a=f.booking({secret:token()})
  assert.equal((await f.request(`/api/tickets/${a.id}/feedback`,{accessToken:a.secret,rating:5})).status,201)
  for(const [index,status]of ['cancelled','no_show'].entries()) {
    const other=f.booking({status,time:`${10+index}:00`,secret:String(index).repeat(6)})
    assert.equal((await f.request(`/api/tickets/${other.id}/feedback`,{accessToken:other.secret,rating:5,comment:''})).status,409)
  }
})

test('concurrent feedback requests cannot overwrite a prior rating',async t=>{
  const f=await fixture(t),a=f.booking()
  const results=await Promise.all([1,5].map(rating=>f.request(`/api/tickets/${a.id}/feedback`,{accessToken:a.secret,rating,comment:''})))
  assert.deepEqual(results.map(result=>result.status).sort(),[201,409])
  const saved=results.find(result=>result.status===201).body.feedback
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM appointment_feedback').get().n,1)
  assert.equal(f.db.prepare('SELECT rating FROM appointment_feedback').get().rating,saved.rating)
})

test('statistics are admin-only, aggregate beyond 1000 and filter closed departments and dates',async t=>{
  const f=await fixture(t)
  assert.equal((await f.request('/api/admin/statistics')).status,401)
  const staff=await f.login('staff'),admin=await f.login('admin')
  assert.equal((await f.request('/api/admin/statistics',undefined,staff)).status,403)
  f.db.prepare("INSERT INTO departments(id,name,active) VALUES ('closed','Жабық бөлім',0)").run()
  const completed=f.booking()
  f.db.prepare('INSERT INTO appointment_feedback VALUES (?,?,?,?)').run(completed.id,4,'Тест пікірі',Date.now())
  f.booking({status:'scheduled',time:'10:00'})
  f.booking({status:'no_show',departmentId:'closed',date:'2026-01-07'})
  transaction(f.db,()=>{for(let i=0;i<1005;i++)f.booking({status:'cancelled'})})
  f.booking({date:'2025-12-01'})
  const response=await f.request('/api/admin/statistics?from=2026-01-05&to=2026-01-07',undefined,admin)
  assert.equal(response.status,200)
  assert.deepEqual(response.body.summary,{total:1008,scheduled:1,completed:1,cancelled:1005,noShow:1,feedbackCount:1,averageRating:4})
  assert.equal(response.body.daily.length,3)
  assert.equal(response.body.daily[1].total,0)
  assert.equal(response.body.departments[0].total,1007)
  assert.equal(response.body.departments[1].id,'closed')
  assert.equal(response.body.feedback[0].comment,'Тест пікірі')
  assert.equal(JSON.stringify(response.body).includes('Жеке Азамат'),false)
  assert.equal(JSON.stringify(response.body).includes('+77771234567'),false)
  const closed=await f.request('/api/admin/statistics?from=2026-01-05&to=2026-01-07&departmentId=closed',undefined,admin)
  assert.equal(closed.body.summary.total,1)
  assert.equal(closed.body.summary.averageRating,null)
  assert.equal(closed.body.feedback.length,0)
  const empty=await f.request('/api/admin/statistics?from=2026-02-01&to=2026-02-01',undefined,admin)
  assert.equal(empty.body.summary.total,0)
  assert.equal(empty.body.summary.averageRating,null)
  assert.equal(empty.body.daily.length,1)
})

test('statistics reject invalid or excessive date ranges',async t=>{
  const f=await fixture(t),admin=await f.login('admin')
  for(const query of ['from=2026-02-30&to=2026-03-01','from=bad&to=2026-01-01','from=2026-01-02&to=2026-01-01','from=2025-01-01&to=2026-01-02','to=invalid'])assert.equal((await f.request('/api/admin/statistics?'+query,undefined,admin)).status,400)
  assert.equal((await f.request('/api/admin/statistics?departmentId=unknown',undefined,admin)).status,404)
  assert.equal((await f.request('/api/admin/statistics',undefined,admin)).body.daily.length,30)
})
