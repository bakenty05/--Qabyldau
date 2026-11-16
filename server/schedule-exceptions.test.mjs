import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApp } from './app.mjs'
import { openStore, localDate, slotsFor, digest, token } from './store.mjs'
import { addDateDays, effectiveExceptions, receptionSchedule } from './schedule.mjs'
import { isReceptionDate } from '../src/reception-calendar.ts'

async function fixture(t) {
  const db=openStore(':memory:')
  const {server}=createApp({db,origin:'http://localhost:5173'})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close()})
  function account(role){
    const id=randomUUID(),secret=token()
    db.prepare("INSERT INTO users(id,username,full_name,password_hash,role,status,government_employee,created_at) VALUES (?,?,?,?,?,'active',1,?)").run(id,id,'Тест Қызметкер','unused',role,Date.now())
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(secret),id,Date.now()+60000)
    return `eq_session=${secret}`
  }
  const admin=account('admin'),staff=account('staff')
  async function request(path,data,options={}){
    const response=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method:data===undefined?'GET':options.method||'POST',headers:{Origin:'http://localhost:5173',...(data===undefined?{}:{'Content-Type':'application/json'}),...(options.cookie?{Cookie:options.cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)})
    return {status:response.status,body:await response.json()}
  }
  let date=addDateDays(localDate(),1)
  while([0,6].includes(new Date(date+'T00:00:00Z').getUTCDay()))date=addDateDays(date,1)
  let weekend=addDateDays(date,1)
  while(new Date(weekend+'T00:00:00Z').getUTCDay()!==6)weekend=addDateDays(weekend,1)
  const closed=(departmentId='',day=date)=>({date:day,departmentId,closed:true,periods:[],slotMinutes:30,note:'Қызметкер болмайды — ішкі себеп'})
  const custom=(departmentId='general-reception',day=date)=>({...closed(departmentId,day),closed:false,periods:[{start:'10:00',end:'11:30'}],slotMinutes:20})
  const save=data=>request('/api/admin/schedule-exceptions',data,{cookie:admin})
  const booking=(departmentId='general-reception',day=date,time='09:30')=>({departmentId,date:day,time,fullName:'Сынақ Азамат',phone:'+77771234567',issue:'Қабылдауға сынақ жазылу',consent:true})
  return {db,request,admin,staff,date,weekend,closed,custom,save,booking}
}

test('only admins manage special days and public calendars never expose internal reasons',async t=>{
  const f=await fixture(t),path='/api/admin/schedule-exceptions'
  assert.equal((await f.request(path)).status,401)
  assert.equal((await f.request(path,undefined,{cookie:f.staff})).status,403)
  assert.equal((await f.request(path,f.closed())).status,401)
  assert.equal((await f.request(path,f.closed(),{cookie:f.staff})).status,403)
  const saved=await f.save(f.closed())
  assert.equal(saved.status,200)
  assert.equal((await f.request(path+'/'+saved.body.id,{}, {method:'DELETE',cookie:f.staff})).status,403)
  const admin=await f.request(path,undefined,{cookie:f.admin})
  assert.equal(admin.body.exceptions[0].note,f.closed().note)
  const publicDays=await f.request('/api/schedule-exceptions?departmentId=general-reception')
  assert.equal(publicDays.status,200)
  assert.deepEqual(publicDays.body.exceptions,[{date:f.date,closed:true,periods:[],slotMinutes:null}])
  assert.equal(JSON.stringify(publicDays.body).includes('ішкі себеп'),false)
})

test('a general closure blocks every department and direct booking without changing old tickets',async t=>{
  const f=await fixture(t)
  const booked=await f.request('/api/appointments',f.booking())
  assert.equal(booked.status,201)
  const before=f.db.prepare('SELECT * FROM appointments WHERE id=?').get(booked.body.appointment.id)
  const saved=await f.save(f.closed())
  assert.equal(saved.body.scheduledCount,1)
  for(const departmentId of ['general-reception','mayor-reception']){
    const available=await f.request(`/api/availability?departmentId=${departmentId}&date=${f.date}`)
    assert.deepEqual(available.body.slots,[])
    assert.equal((await f.request('/api/appointments',f.booking(departmentId,f.date,'10:00'))).status,409)
  }
  assert.deepEqual(f.db.prepare('SELECT * FROM appointments WHERE id=?').get(before.id),before)
  const oldTicket=await f.request(`/api/tickets/${before.id}`,{accessToken:booked.body.accessToken})
  assert.equal(oldTicket.status,200)
  assert.equal(oldTicket.body.appointment.time,'09:30')
})

test('department rules override general rules and a closed department never reopens',async t=>{
  const f=await fixture(t)
  await f.save(f.closed())
  await f.save(f.custom())
  const general=f.db.prepare("SELECT * FROM departments WHERE id='general-reception'").get()
  const mayor=f.db.prepare("SELECT * FROM departments WHERE id='mayor-reception'").get()
  assert.deepEqual(slotsFor(f.db,general,f.date),['10:00','10:20','10:40','11:00'])
  assert.deepEqual(slotsFor(f.db,mayor,f.date),[])
  const days=effectiveExceptions(f.db,general.id,f.date,f.date)
  assert.equal(days.length,1);assert.equal(days[0].closed,false)
  f.db.prepare("UPDATE departments SET active=0 WHERE id='general-reception'").run()
  assert.deepEqual(slotsFor(f.db,{...general,active:0},f.date),[])
  assert.equal((await f.request('/api/appointments',f.booking(general.id,f.date,'10:00'))).status,409)
})

test('single and split custom hours store the correct duration and exclude overlaps with existing tickets',async t=>{
  const f=await fixture(t)
  const old=await f.request('/api/appointments',f.booking('general-reception',f.date,'10:00'))
  const saved=await f.save({...f.custom(),periods:[{start:'09:50',end:'11:30'},{start:'16:00',end:'17:00'}]})
  assert.equal(saved.status,200)
  const department=f.db.prepare("SELECT * FROM departments WHERE id='general-reception'").get()
  assert.deepEqual(slotsFor(f.db,department,f.date),['10:30','10:50','11:10','16:00','16:20','16:40'])
  const booked=await f.request('/api/appointments',f.booking('general-reception',f.date,'16:00'))
  assert.equal(booked.status,201)
  assert.equal(f.db.prepare('SELECT slot_minutes FROM appointments WHERE id=?').get(booked.body.appointment.id).slot_minutes,20)
  assert.equal(f.db.prepare('SELECT slot_minutes FROM appointments WHERE id=?').get(old.body.appointment.id).slot_minutes,30)
  assert.equal(department.slot_minutes,30)
  assert.equal((await f.request('/api/appointments',f.booking('general-reception',f.date,'16:10'))).status,409)
})

test('explicit weekend hours open only the chosen date and calendar limits still apply',async t=>{
  const f=await fixture(t)
  await f.save({...f.custom('general-reception',f.weekend),slotMinutes:30,periods:[{start:'11:00',end:'12:00'}]})
  const department=f.db.prepare("SELECT * FROM departments WHERE id='general-reception'").get()
  assert.deepEqual(slotsFor(f.db,department,f.weekend),['11:00','11:30'])
  assert.deepEqual(slotsFor(f.db,department,addDateDays(f.weekend,1)),[])
  const days=effectiveExceptions(f.db,department.id,localDate(),addDateDays(localDate(),90))
  assert.equal(isReceptionDate(f.weekend,localDate(),addDateDays(localDate(),90),[1,2,3,4,5],days),true)
  assert.equal(isReceptionDate(f.weekend,localDate(),addDateDays(f.weekend,-1),[1,2,3,4,5],days),false)
  assert.equal((await f.request('/api/appointments',f.booking(department.id,f.weekend,'11:00'))).status,201)
  const future=addDateDays(localDate(),91)
  await f.save(f.custom(department.id,future))
  assert.deepEqual(slotsFor(f.db,department,future),[])
})

test('edits and deletion restore fallback schedules, are audited, and reject duplicate or moved rules',async t=>{
  const f=await fixture(t)
  const global=await f.save(f.closed())
  const own=await f.save(f.custom())
  assert.equal((await f.save(f.custom())).status,409)
  assert.equal((await f.save({...f.custom(),id:own.body.id,date:addDateDays(f.date,1)})).status,400)
  assert.equal((await f.save({...f.closed('general-reception'),id:own.body.id})).status,200)
  const department=f.db.prepare("SELECT * FROM departments WHERE id='general-reception'").get()
  assert.equal(receptionSchedule(f.db,department,f.date).closed,true)
  const remove=id=>f.request('/api/admin/schedule-exceptions/'+id,{}, {method:'DELETE',cookie:f.admin})
  assert.equal((await remove(own.body.id)).status,200)
  assert.equal(receptionSchedule(f.db,department,f.date).closed,true)
  assert.equal((await remove(global.body.id)).status,200)
  assert.equal(slotsFor(f.db,department,f.date)[0],'09:30')
  assert.equal((await remove(global.body.id)).status,404)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='schedule_exception.saved'").get().n,3)
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='schedule_exception.deleted'").get().n,2)
})

test('invalid special hours, dates, scopes and oversized reasons cannot be saved',async t=>{
  const f=await fixture(t),base=f.custom()
  for(const patch of [
    {date:'2026-02-30'},{date:addDateDays(localDate(),-1)},{date:addDateDays(localDate(),367)},
    {departmentId:'unknown'},{departmentId:null},{closed:'false'},{slotMinutes:10},{slotMinutes:'30'},
    {periods:[]},{periods:[{start:'10:00',end:'10:10'}]},{periods:[{start:'25:00',end:'26:00'}]},
    {periods:[{start:'10:00',end:'11:00'},{start:'10:30',end:'12:00'}]},
    {periods:[null]},{periods:'10:00–12:00'},{note:'а'.repeat(501)},
  ])assert.equal((await f.save({...base,...patch})).status,400,JSON.stringify(patch))
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM schedule_exceptions').get().n,0)
  assert.equal((await f.request('/api/schedule-exceptions?departmentId=unknown')).status,404)
  assert.equal((await f.request('/api/schedule-exceptions?departmentId=general-reception&from=bad')).status,400)
})

test('a closed weekday is disabled in the client calendar and time boundaries remain UTC+5',async t=>{
  const f=await fixture(t)
  await f.save(f.closed('general-reception'))
  const days=effectiveExceptions(f.db,'general-reception',f.date,f.date)
  assert.equal(isReceptionDate(f.date,localDate(),addDateDays(localDate(),90),[1,2,3,4,5],days),false)
  await f.save({...f.custom('mayor-reception'),slotMinutes:30,periods:[{start:'09:00',end:'10:30'}]})
  const mayor=f.db.prepare("SELECT * FROM departments WHERE id='mayor-reception'").get()
  assert.deepEqual(slotsFor(f.db,mayor,f.date,new Date(`${f.date}T04:00:00Z`)),['09:30','10:00'])
  assert.deepEqual(slotsFor(f.db,mayor,f.date,new Date(`${f.date}T05:00:00Z`)),[])
})
