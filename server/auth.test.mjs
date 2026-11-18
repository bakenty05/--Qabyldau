import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { createApp } from './app.mjs'
import { openStore, passwordHash, digest, token, localDate, slotsFor, verifyPassword, DEFAULT_PRIVACY_TEXT } from './store.mjs'

async function fixture(t) {
  const db=openStore(':memory:')
  const {server}=createApp({db,origin:'http://localhost:5173'})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close()})
  const url=`http://127.0.0.1:${server.address().port}`
  async function request(path,data,options={}) {
    const response=await fetch(url+path,{method:data===undefined?'GET':options.method||'POST',headers:{...(data!==undefined?{'Content-Type':'application/json','Origin':'http://localhost:5173'}:{}),...(options.cookie?{Cookie:options.cookie}:{}),...options.headers},body:data===undefined?undefined:JSON.stringify(data)})
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}
  }
  function addUser(role='admin',status='active') {
    const id=randomUUID(),username='user'+id.slice(0,8),password='long test password 12345'
    db.prepare('INSERT INTO users(id,username,full_name,password_hash,role,status,government_employee,created_at) VALUES (?,?,?,?,?,?,1,?)').run(id,username,'Тест Қызметкер',passwordHash(password),role,status,Date.now())
    return {id,username,password}
  }
  function addDepartment(name='Бірінші бөлім') {
    const id=randomUUID()
    db.prepare("INSERT INTO departments(id,name,active) VALUES (?,?,1)").run(id,name)
    return id
  }
  for(const [key,value] of Object.entries({organization:'Тест әкімдік',address:'Тест мекенжай',privacyText:'Тест деректерді өңдеу шарттары'})) db.prepare('INSERT INTO app_settings VALUES (?,?)').run(key,value)
  const nextDay=new Date(`${localDate(new Date(Date.now()+86400000))}T00:00:00Z`)
  while([0,6].includes(nextDay.getUTCDay())) nextDay.setUTCDate(nextDay.getUTCDate()+1)
  const tomorrow=nextDay.toISOString().slice(0,10)
  const booking=departmentId=>({departmentId,fullName:'Тест Азамат',phone:'+77771234567',issue:'Тест үшін жазылған мәселе',date:tomorrow,time:'09:30',consent:true})
  return {db,server,url,request,addUser,addDepartment,booking,tomorrow}
}

test('malformed phone values are validation errors and never create a booking',async t=>{
  const f=await fixture(t),d=f.addDepartment()
  for(const phone of [[f.booking(d).phone],{phone:f.booking(d).phone},null,77771234567]) {
    assert.equal((await f.request('/api/appointments',{...f.booking(d),phone})).status,400)
  }
  assert.equal(f.db.prepare('SELECT count(*) n FROM appointments').get().n,0)
})

test('revoked sessions cannot finish writes that are still receiving their body',async t=>{
  for(const role of ['staff','admin']) await t.test(role,async t=>{
    const f=await fixture(t),user=f.addUser(role),d=f.addDepartment()
    f.db.prepare('INSERT INTO staff_departments VALUES (?,?)').run(user.id,d)
    const booking=(await f.request('/api/appointments',f.booking(d))).body.appointment
    const {cookie}=await f.request('/api/auth/login',user)
    const path=role==='staff'?`/api/staff/appointments/${booking.id}`:'/api/admin/settings'
    const payload=JSON.stringify(role==='staff'?{status:'completed',note:'stale write'}:{organization:'stale write',address:'',phone:'',privacyText:''})
    const receiving=new Promise(resolve=>f.server.once('request',req=>req.once('data',resolve)))
    let slowRequest
    const result=new Promise((resolve,reject)=>{
      slowRequest=httpRequest(f.url+path,{method:role==='staff'?'PATCH':'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json',Cookie:cookie}},res=>{
        res.resume();res.on('end',()=>resolve(res.statusCode))
      })
      slowRequest.on('error',reject)
      slowRequest.write(payload.slice(0,1))
    })
    await receiving
    assert.equal((await f.request('/api/auth/logout',{}, {cookie})).status,200)
    slowRequest.end(payload.slice(1))
    assert.equal(await result,401)
    assert.equal(f.db.prepare('SELECT status FROM appointments WHERE id=?').get(booking.id).status,'scheduled')
    assert.equal(f.db.prepare("SELECT value FROM app_settings WHERE key='organization'").get().value,'Тест әкімдік')
  })
})

test('password hashes use unique salts and reject incorrect passwords',()=>{
  const hash=passwordHash('a sufficiently long password')
  assert.notEqual(hash,passwordHash('a sufficiently long password'))
  assert.equal(verifyPassword('a sufficiently long password',hash),true)
  assert.equal(verifyPassword('wrong password',hash),false)
  assert.equal(verifyPassword('a sufficiently long password',hash.replaceAll(':','$')),true)
})
test('staff cannot self approve or request admin role',async t=>{
  const f=await fixture(t)
  const result=await f.request('/api/auth/register',{username:'new.staff',fullName:'Жаңа Қызметкер',password:'a sufficiently long password',governmentEmployee:true,role:'admin',status:'active'})
  assert.equal(result.status,201)
  const user=f.db.prepare('SELECT role,status FROM users WHERE username=?').get('new.staff')
  assert.equal(user.role,'staff');assert.equal(user.status,'pending')
  assert.equal((await f.request('/api/auth/login',{username:'new.staff',password:'a sufficiently long password'})).status,401)
})
test('single use bootstrap creates only the first admin',async t=>{
  const f=await fixture(t),key=token()
  f.db.prepare('INSERT INTO bootstrap_keys(token_hash,expires_at) VALUES (?,?)').run(digest(key),Date.now()+100000)
  const data={username:'first.admin',fullName:'Бірінші Әкімші',password:'a sufficiently long password',governmentEmployee:true,bootstrapToken:key}
  const created = await f.request('/api/auth/register',data)
  assert.equal(created.status,201)
  assert.match(created.body.message,/Әкімші аккаунты құрылды/)
  assert.equal((await f.request('/api/auth/register',{...data,username:'second.admin'})).status,403)
  assert.equal(f.db.prepare("SELECT count(*) n FROM users WHERE role='admin'").get().n,1)
})
test('cookie auth, origin check, admin authorization, logout',async t=>{
  const f=await fixture(t),staff=f.addUser('staff')
  const login=await f.request('/api/auth/login',staff)
  assert.equal(login.status,200);assert.ok(login.cookie)
  assert.equal((await f.request('/api/admin/users',undefined,{cookie:login.cookie})).status,403)
  assert.equal((await f.request('/api/auth/session',undefined,{cookie:login.cookie})).body.user.id,staff.id)
  assert.equal((await f.request('/api/auth/logout',{}, {cookie:login.cookie,headers:{Origin:'https://attacker.example'}})).status,403)
  assert.equal((await f.request('/api/auth/logout',{}, {cookie:login.cookie})).status,200)
  assert.equal((await f.request('/api/staff/appointments',undefined,{cookie:login.cookie})).status,401)
})
test('same slot cannot be booked twice; departments have independent slots',async t=>{
  const f=await fixture(t),a=f.addDepartment(),b=f.addDepartment('Екінші бөлім')
  const results=await Promise.all([f.request('/api/appointments',f.booking(a)),f.request('/api/appointments',f.booking(a))])
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409])
  assert.equal((await f.request('/api/appointments',f.booking(b))).status,201)
  assert.equal(f.db.prepare('SELECT count(*) n FROM appointments').get().n,2)
  const r=results.find(r=>r.status===201)
  assert.equal(f.db.prepare('SELECT access_hash FROM appointments WHERE id=?').get(r.body.appointment.id).access_hash,digest(r.body.accessToken))
})
test('ticket requires secret, hides internal notes, cancellation releases slot',async t=>{
  const f=await fixture(t),d=f.addDepartment(),created=await f.request('/api/appointments',f.booking(d))
  const {appointment,accessToken}=created.body
  f.db.prepare('UPDATE appointments SET note=? WHERE id=?').run('Қызметкердің ішкі ескертуі',appointment.id)
  assert.equal((await f.request(`/api/tickets/${appointment.id}`,{accessToken:'wrong'})).status,404)
  const ticket=await f.request(`/api/tickets/${appointment.id}`,{accessToken})
  assert.equal(ticket.status,200);assert.equal(ticket.body.appointment.note,undefined)
  assert.equal((await f.request(`/api/tickets/${appointment.id}/cancel`,{accessToken})).status,200)
  assert.equal((await f.request('/api/appointments',f.booking(d))).status,201)
})
test('phone and a six digit code select one ticket and cancel only that booking',async t=>{
  const f=await fixture(t),d=f.addDepartment()
  const first=(await f.request('/api/appointments',f.booking(d))).body
  const second=(await f.request('/api/appointments',{...f.booking(d),time:'10:00'})).body
  assert.match(first.accessToken,/^\d{6}$/)
  assert.match(second.accessToken,/^\d{6}$/)
  assert.notEqual(first.accessToken,second.accessToken)
  f.db.prepare('UPDATE appointments SET note=? WHERE id=?').run('private note',first.appointment.id)
  const phone=first.appointment.phone
  const wrongPhone=await f.request('/api/tickets/lookup',{phone:'+77000000000',accessToken:first.accessToken})
  assert.equal(wrongPhone.status,404)
  const missingCode=await f.request('/api/tickets/lookup',{phone})
  assert.equal(missingCode.status,404)
  const missingPhone=await f.request('/api/tickets/lookup',{accessToken:first.accessToken})
  assert.equal(missingPhone.status,404)
  const found=await f.request('/api/tickets/lookup',{phone,accessToken:first.accessToken})
  assert.equal(found.status,200)
  assert.equal(found.body.appointment.id,first.appointment.id)
  assert.equal(found.body.appointment.note,undefined)
  const other=await f.request('/api/tickets/lookup',{phone,accessToken:second.accessToken})
  assert.equal(other.body.appointment.id,second.appointment.id)
  const cancelled=await f.request('/api/tickets/lookup/cancel',{phone,accessToken:first.accessToken})
  assert.equal(cancelled.status,200)
  assert.equal(cancelled.body.appointment.status,'cancelled')
  assert.equal(f.db.prepare('SELECT status FROM appointments WHERE id=?').get(second.appointment.id).status,'scheduled')
  assert.equal((await f.request('/api/appointments',f.booking(d))).status,201)
})

test('old downloaded tickets still work with their UUID and long private key',async t=>{
  const f=await fixture(t),d=f.addDepartment()
  const created=(await f.request('/api/appointments',f.booking(d))).body
  const oldSecret=token()
  f.db.prepare('UPDATE appointments SET access_hash=? WHERE id=?').run(digest(oldSecret),created.appointment.id)
  const found=await f.request(`/api/tickets/${created.appointment.id}`,{accessToken:oldSecret})
  assert.equal(found.status,200)
  assert.equal((await f.request(`/api/tickets/${created.appointment.id}/cancel`,{accessToken:oldSecret})).status,200)
})

test('five incorrect codes lock phone lookup for fifteen minutes without affecting another phone',async t=>{
  const f=await fixture(t),d=f.addDepartment()
  const first=(await f.request('/api/appointments',f.booking(d))).body
  const second=(await f.request('/api/appointments',{...f.booking(d),phone:'+77001234567',time:'10:00'})).body
  for(let i=0;i<5;i++) assert.equal((await f.request('/api/tickets/lookup',{phone:first.appointment.phone,accessToken:'wrong'})).status,404)
  const blocked=await f.request('/api/tickets/lookup',{phone:first.appointment.phone,accessToken:first.accessToken})
  assert.equal(blocked.status,429)
  assert.equal((await f.request('/api/tickets/lookup',{phone:second.appointment.phone,accessToken:second.accessToken})).status,200)
  f.db.prepare('UPDATE rate_limits SET expires_at=? WHERE key=?').run(Date.now()-1,`ticket-failed:${digest(first.appointment.phone)}`)
  assert.equal((await f.request('/api/tickets/lookup',{phone:first.appointment.phone,accessToken:first.accessToken})).status,200)
})

test('department assignments isolate staff records and mutations',async t=>{
  const f=await fixture(t),a=f.addDepartment(),b=f.addDepartment('Екінші бөлім'),staff=f.addUser('staff')
  f.db.prepare('INSERT INTO staff_departments VALUES (?,?)').run(staff.id,a)
  const first=await f.request('/api/appointments',f.booking(a)),second=await f.request('/api/appointments',f.booking(b))
  const {cookie}=await f.request('/api/auth/login',staff)
  const list=await f.request('/api/staff/appointments',undefined,{cookie})
  assert.equal(list.body.appointments.length,1);assert.equal(list.body.appointments[0].departmentId,a)
  const patch={status:'completed',note:'Қабылданды'}
  assert.equal((await f.request(`/api/staff/appointments/${second.body.appointment.id}`,patch,{cookie,method:'PATCH'})).status,403)
  assert.equal((await f.request(`/api/staff/appointments/${first.body.appointment.id}`,patch,{cookie,method:'PATCH'})).status,200)
})
test('disabling staff immediately revokes existing session',async t=>{
  const f=await fixture(t),admin=f.addUser(),staff=f.addUser('staff')
  const a=await f.request('/api/auth/login',admin),s=await f.request('/api/auth/login',staff)
  assert.equal((await f.request(`/api/admin/users/${staff.id}`,{status:'disabled',departmentIds:[]},{cookie:a.cookie,method:'PATCH'})).status,200)
  assert.equal((await f.request('/api/staff/appointments',undefined,{cookie:s.cookie})).status,401)
  assert.equal((await f.request('/api/auth/login',staff)).status,401)
  assert.equal(f.db.prepare('SELECT status FROM users WHERE id=?').get(staff.id).status,'disabled')
  assert.equal(f.db.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(staff.id).n,0)
  assert.ok(f.db.prepare("SELECT 1 FROM audit_events WHERE action='user.disabled'").get())
})

test('only an admin can delete staff, revoking sessions while preserving bookings and audit history',async t=>{
  const f=await fixture(t),admin=f.addUser(),otherAdmin=f.addUser(),staff=f.addUser('staff'),other=f.addUser('staff'),departmentId=f.addDepartment()
  f.db.prepare('INSERT INTO staff_departments VALUES (?,?)').run(staff.id,departmentId)
  f.db.prepare('UPDATE users SET approved_by=? WHERE id=?').run(staff.id,other.id)
  f.db.prepare('INSERT INTO audit_events(actor_id,action,target_id,created_at) VALUES (?,?,?,?)').run(staff.id,'test.history',staff.id,Date.now())
  const booking=await f.request('/api/appointments',f.booking(departmentId))
  const a=await f.request('/api/auth/login',admin),s=await f.request('/api/auth/login',staff)
  const path=`/api/admin/users/${staff.id}`
  assert.equal((await f.request(path,{}, {method:'DELETE'})).status,401)
  assert.equal((await f.request(path,{}, {method:'DELETE',cookie:s.cookie})).status,403)
  assert.equal((await f.request(path,{}, {method:'DELETE',cookie:a.cookie,headers:{Origin:'https://attacker.example'}})).status,403)
  for(const user of [admin,otherAdmin]) assert.equal((await f.request(`/api/admin/users/${user.id}`,{}, {method:'DELETE',cookie:a.cookie})).status,400)
  const removed=await f.request(path,{}, {method:'DELETE',cookie:a.cookie})
  assert.equal(removed.status,200)
  assert.equal(removed.body.id,staff.id)
  assert.equal(f.db.prepare('SELECT 1 FROM users WHERE id=?').get(staff.id),undefined)
  assert.equal(f.db.prepare('SELECT 1 FROM sessions WHERE user_id=?').get(staff.id),undefined)
  assert.equal(f.db.prepare('SELECT 1 FROM staff_departments WHERE user_id=?').get(staff.id),undefined)
  assert.equal((await f.request('/api/auth/login',staff)).status,401)
  assert.equal((await f.request('/api/staff/appointments',undefined,{cookie:s.cookie})).status,401)
  assert.ok(f.db.prepare('SELECT 1 FROM appointments WHERE id=?').get(booking.body.appointment.id))
  assert.ok(f.db.prepare("SELECT 1 FROM audit_events WHERE action='test.history' AND actor_id=?").get(staff.id))
  assert.ok(f.db.prepare("SELECT 1 FROM audit_events WHERE action='user.deleted' AND actor_id=? AND target_id=?").get(admin.id,staff.id))
  assert.equal(f.db.prepare('SELECT approved_by FROM users WHERE id=?').get(other.id).approved_by,null)
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[])
  assert.equal((await f.request('/api/auth/session',undefined,{cookie:a.cookie})).body.user.id,admin.id)
  assert.equal((await f.request(path,{}, {method:'DELETE',cookie:a.cookie})).status,404)
})
test('invalid dates, disabled departments and missing consent cannot book',async t=>{
  const f=await fixture(t),d=f.addDepartment()
  assert.equal((await f.request('/api/appointments',{...f.booking(d),consent:false})).status,400)
  assert.equal((await f.request('/api/appointments',{...f.booking(d),date:'2026-02-31'})).status,409)
  f.db.prepare('UPDATE departments SET active=0 WHERE id=?').run(d)
  assert.equal((await f.request('/api/appointments',f.booking(d))).status,409)
})

test('staff department filters include assigned closed departments and exclude other departments',async t=>{
  const f=await fixture(t),admin=f.addUser(),staff=f.addUser('staff'),assigned=f.addDepartment('Жабық бөлім'),other=f.addDepartment('Басқа бөлім')
  f.db.prepare('UPDATE departments SET active=0 WHERE id=?').run(assigned)
  f.db.prepare('INSERT INTO staff_departments VALUES (?,?)').run(staff.id,assigned)
  assert.equal((await f.request('/api/staff/departments')).status,401)
  const staffCookie=(await f.request('/api/auth/login',staff)).cookie
  const result=await f.request('/api/staff/departments',undefined,{cookie:staffCookie})
  assert.equal(result.status,200)
  assert.deepEqual(result.body.departments.map(d=>d.id),[assigned])
  assert.equal(result.body.departments[0].active,false)
  assert.ok(!(await f.request('/api/departments')).body.departments.some(d=>d.id===assigned))
  const adminCookie=(await f.request('/api/auth/login',admin)).cookie
  const all=(await f.request('/api/staff/departments',undefined,{cookie:adminCookie})).body.departments
  assert.ok(all.some(d=>d.id===assigned)&&all.some(d=>d.id===other))
})

test('maximum length Kazakh organization settings save and oversized values are rejected',async t=>{
  const f=await fixture(t),admin=f.addUser(),cookie=(await f.request('/api/auth/login',admin)).cookie
  const settings={organization:'Ә'.repeat(500),address:'Қ'.repeat(500),phone:'Ұ'.repeat(500),privacyText:'Ө'.repeat(5000)}
  const publicSettings={...settings,privacyTextRu:'',privacyVersion:digest(settings.privacyText),privacyApproved:false}
  assert.equal((await f.request('/api/admin/settings',settings,{cookie})).status,200)
  assert.deepEqual((await f.request('/api/settings')).body.settings,publicSettings)
  assert.equal((await f.request('/api/admin/settings',{...settings,address:'Қ'.repeat(501)},{cookie})).status,400)
  assert.equal((await f.request('/api/admin/settings',{...settings,privacyText:'Ө'.repeat(5001)},{cookie})).status,400)
  assert.deepEqual((await f.request('/api/settings')).body.settings,publicSettings)
})
test('an admin can approve pending staff with department access and the staff can sign in',async t=>{
  const f=await fixture(t),admin=f.addUser(),staff=f.addUser('staff','pending'),departmentId=f.addDepartment()
  const cookie=(await f.request('/api/auth/login',admin)).cookie
  assert.equal((await f.request('/api/auth/login',staff)).status,401)
  const denied=await f.request(`/api/admin/users/${staff.id}`,{status:'active',departmentIds:[]},{cookie,method:'PATCH'})
  assert.equal(denied.status,400)
  assert.equal(f.db.prepare('SELECT status FROM users WHERE id=?').get(staff.id).status,'pending')
  const granted=await f.request(`/api/admin/users/${staff.id}`,{status:'active',departmentIds:[departmentId]},{cookie,method:'PATCH'})
  assert.equal(granted.status,200)
  assert.equal(granted.body.user.status,'active')
  assert.deepEqual(granted.body.user.departmentIds,[departmentId])
  assert.equal(granted.body.user.password_hash,undefined)
  const login=await f.request('/api/auth/login',staff)
  assert.equal(login.status,200)
  assert.deepEqual(login.body.user.departmentIds,[departmentId])
  assert.equal((await f.request('/api/staff/appointments',undefined,{cookie:login.cookie})).status,200)
  assert.equal((await f.request('/api/admin/users',undefined,{cookie:login.cookie})).status,403)
})

test('visitor can submit online without an account or organization settings',async t=>{
  const f=await fixture(t),d=f.addDepartment()
  f.db.prepare('DELETE FROM app_settings').run()
  const settings=await f.request('/api/settings')
  assert.equal(settings.body.settings.privacyText,DEFAULT_PRIVACY_TEXT)
  const result=await f.request('/api/appointments',f.booking(d))
  assert.equal(result.status,201)
  assert.equal(result.body.appointment.status,'scheduled')
  assert.ok(result.body.accessToken)
  assert.equal(f.db.prepare('SELECT consent_text FROM appointments WHERE id=?').get(result.body.appointment.id).consent_text,DEFAULT_PRIVACY_TEXT)
})
test('empty installation has public intake on weekdays',()=>{
  const db=openStore(':memory:')
  const d=db.prepare('SELECT * FROM departments').all()
  assert.equal(d.length,2);assert.equal(d[0].name,'Жалпы қабылдау');assert.equal(d[0].active,1)
  assert.ok(d.some(row=>row.id==='mayor-reception'&&row.active===1))
  assert.deepEqual(JSON.parse(d[0].weekdays),[1,2,3,4,5])
  db.close()
})
test('local schedule uses UTC+5 and excludes past and out of horizon slots',async t=>{
  const f=await fixture(t),id=f.addDepartment(),d=f.db.prepare('SELECT * FROM departments WHERE id=?').get(id)
  const now=new Date('2026-11-08T19:30:00Z')
  assert.equal(localDate(now),'2026-11-09')
  assert.equal(slotsFor(f.db,d,'2026-11-08',now).length,0)
  assert.equal(slotsFor(f.db,d,'2026-11-09',now)[0],'09:30')
  assert.equal(slotsFor(f.db,d,'2027-11-09',now).length,0)
})
test('production refuses plain HTTP origin',()=>{
  const db=openStore(':memory:')
  assert.throws(()=>createApp({db,production:true,origin:'http://example.com'}),/HTTPS|https/)
  db.close()
})
test('schedule edits cannot introduce overlapping appointments; consent text is retained',async t=>{
  const f=await fixture(t),id=f.addDepartment()
  const r=await f.request('/api/appointments',f.booking(id))
  assert.equal(r.status,201)
  f.db.prepare("UPDATE departments SET start_time='09:45',slot_minutes=15 WHERE id=?").run(id)
  assert.equal((await f.request('/api/appointments',{...f.booking(id),time:'09:45'})).status,409)
  assert.equal((await f.request('/api/appointments',{...f.booking(id),time:'10:00'})).status,201)
  assert.equal(f.db.prepare('SELECT consent_text FROM appointments LIMIT 1').get().consent_text,'Тест деректерді өңдеу шарттары')
})
test('split reception hours expose only complete appointments inside each period',async t=>{
  const f=await fixture(t),id=f.addDepartment(),d=f.db.prepare('SELECT * FROM departments WHERE id=?').get(id)
  const slots=slotsFor(f.db,d,'2026-11-10',new Date('2026-11-09T00:00:00Z'))
  assert.deepEqual(slots,['09:30','10:00','10:30','11:00','11:30','12:00','15:30','16:00','16:30','17:00','17:30','18:00'])
  for(const time of ['09:00','12:30','13:00','15:00','18:30']) assert.equal((await f.request('/api/appointments',{...f.booking(id),time})).status,409,time)
  assert.equal((await f.request('/api/appointments',{...f.booking(id),time:'15:30'})).status,201)
})
test('weekends are unavailable and cannot be booked even with legacy weekend settings',async t=>{
  const f=await fixture(t),id=f.addDepartment()
  f.db.prepare("UPDATE departments SET weekdays='[0,1,2,3,4,5,6]' WHERE id=?").run(id)
  const saturday=new Date(`${f.tomorrow}T00:00:00Z`)
  while(saturday.getUTCDay()!==6)saturday.setUTCDate(saturday.getUTCDate()+1)
  for(let offset=0;offset<2;offset++){
    const day=new Date(saturday);day.setUTCDate(day.getUTCDate()+offset);const date=day.toISOString().slice(0,10)
    const available=await f.request(`/api/availability?departmentId=${id}&date=${date}`)
    assert.deepEqual(available.body.slots,[])
    assert.equal((await f.request('/api/appointments',{...f.booking(id),date})).status,409)
  }
})
test('mayor has independent slots with the same morning and afternoon schedule',async t=>{
  const f=await fixture(t)
  const departments=(await f.request('/api/departments')).body.departments
  const mayor=departments.find(d=>d.id==='mayor-reception')
  assert.equal(mayor.name,'Әкімге жазылу')
  assert.equal(mayor.startTime,'09:30');assert.equal(mayor.breakStart,'12:30');assert.equal(mayor.breakEnd,'15:30');assert.equal(mayor.endTime,'18:30')
  assert.equal((await f.request('/api/appointments',f.booking('general-reception'))).status,201)
  const available=(await f.request(`/api/availability?departmentId=mayor-reception&date=${f.tomorrow}`)).body.slots
  assert.ok(available.includes('09:30'))
  assert.equal((await f.request('/api/appointments',f.booking('mayor-reception'))).status,201)
  assert.equal((await f.request('/api/appointments',f.booking('mayor-reception'))).status,409)
})
test('admin can save split hours but cannot reopen weekends or overlap periods',async t=>{
  const f=await fixture(t),admin=f.addUser(),{cookie}=await f.request('/api/auth/login',admin)
  const department={name:'Жаңа бөлім',description:'Тест',active:true,weekdays:[1,2,3,4,5],startTime:'09:30',breakStart:'12:30',breakEnd:'15:30',endTime:'18:30',slotMinutes:30}
  assert.equal((await f.request('/api/admin/departments',{...department,weekdays:[1,6]},{cookie})).status,400)
  assert.equal((await f.request('/api/admin/departments',{...department,breakEnd:'12:00'},{cookie})).status,400)
  const result=await f.request('/api/admin/departments',department,{cookie})
  assert.equal(result.status,200)
  const row=(await f.request('/api/departments')).body.departments.find(d=>d.id===result.body.id)
  assert.equal(row.breakStart,'12:30');assert.equal(row.breakEnd,'15:30')
})
