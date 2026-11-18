import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { randomUUID, randomInt } from 'node:crypto'
import { gzip } from 'node:zlib'
import { promisify } from 'node:util'
import { openStore, digest, token, passwordHash, verifyPassword, publicUser, transaction, audit, slotsFor, localDate, DEFAULT_PRIVACY_TEXT } from './store.mjs'
import { statistics } from './statistics.mjs'
import { validDate, addDateDays, publicException, effectiveExceptions, receptionSchedule, validPeriods } from './schedule.mjs'
import { issuePasswordReset, replacePassword } from './passwords.mjs'
import { currentPolicy } from './privacy.mjs'

class HttpError extends Error { constructor(status, message) { super(message); this.status = status } }
const fail = (status, message) => { throw new HttpError(status, message) }
const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max
const compress = promisify(gzip)
const safeUser = (db, user) => ({ ...publicUser(user), departmentIds: db.prepare('SELECT department_id FROM staff_departments WHERE user_id=?').all(user.id).map(x => x.department_id) })
const appointment = row => ({ id: row.id, number: `A-${String(row.sequence).padStart(4,'0')}`, departmentId: row.department_id, departmentName: row.department_name, fullName: row.full_name, phone: row.phone, issue: row.issue, date: row.date, time: row.time, status: row.status, note: row.note, createdAt: row.created_at })
const appointmentSelect = 'SELECT a.*, d.name AS department_name FROM appointments a JOIN departments d ON d.id=a.department_id'
const department = row => ({ id: row.id, name: row.name, description: row.description, active: !!row.active, weekdays: JSON.parse(row.weekdays), startTime: row.start_time, endTime: row.end_time, breakStart: row.break_start, breakEnd: row.break_end, slotMinutes: row.slot_minutes })

export function createApp({ db = openStore(), origin = process.env.APP_ORIGIN || 'http://127.0.0.1:5173', production = process.env.NODE_ENV === 'production', staticDir = resolve('dist'), allowTestOrigin = false, operations = null } = {}) {
  if (production && !origin.startsWith('https://')) throw new Error('Production requires APP_ORIGIN=https://your-domain')
  const allowedOrigins = new Set([origin, ...(!production ? ['http://localhost:5173','http://127.0.0.1:3001','http://localhost:3001'] : [])])
  const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
  const limit = (key, max, ms) => {
    const now = Date.now()
    db.prepare('DELETE FROM rate_limits WHERE expires_at<=?').run(now)
    db.prepare('INSERT INTO rate_limits(key,hits,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1').run(key, now+ms)
    if (db.prepare('SELECT hits FROM rate_limits WHERE key=?').get(key).hits > max) fail(429, 'Тым көп әрекет. Кейінірек қайталаңыз.')
  }
  const sessionUser = req => {
    const raw = /(?:^|;\s*)eq_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]
    if (!raw) return null
    return db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'").get(digest(raw), Date.now()) || null
  }
  function authenticate(req, admin = false) {
    const user = sessionUser(req)
    if (!user) fail(401, 'Кабинетке қайта кіріңіз.')
    if (admin && user.role !== 'admin') fail(403, 'Әкімші рұқсаты қажет.')
    return user
  }
  function canAccess(user, departmentId) {
    if (user.role !== 'admin' && !db.prepare('SELECT 1 FROM staff_departments WHERE user_id=? AND department_id=?').get(user.id, departmentId)) fail(403, 'Бұл бөлімге рұқсатыңыз жоқ.')
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'JSON қажет.')
    let size = 0; const chunks = []
    for await (const chunk of req) { size += chunk.length; if (size > 128000) fail(413, 'Сұрау тым үлкен.'); chunks.push(chunk) }
    try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value }
    catch { fail(400, 'Сұрау пішімі дұрыс емес.') }
  }
  async function staffBody(req, admin = false) {
    authenticate(req, admin)
    const data = await body(req)
    // Permissions may have been revoked while a slow request body arrived.
    return { data, user: authenticate(req, admin) }
  }
  function createSession(res, userId) {
    const raw = token()
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now())
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(raw), userId, Date.now()+8*3600000)
    res.setHeader('Set-Cookie', `eq_session=${raw}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${production ? '; Secure' : ''}`)
  }
  const clearCookie = res => res.setHeader('Set-Cookie',`eq_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production?'; Secure':''}`)
  const validNewPassword = value => typeof value === 'string' && value.length <= 128 && value.trim().length >= 15
  function confirmPassword(user, password) {
    if (typeof password !== 'string' || password.length > 128 || !verifyPassword(password, user.password_hash)) fail(400,'Ағымдағы құпиясөз дұрыс емес.')
  }
  const server = createServer(async (req, res) => {
    if(operations) res.once('finish',()=>operations.recordResponse(res.statusCode))
    res.setHeader('X-Content-Type-Options','nosniff')
    res.setHeader('Referrer-Policy','no-referrer')
    res.setHeader('X-Frame-Options','DENY')
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    if (production) res.setHeader('Strict-Transport-Security','max-age=31536000')
    try {
      const url = new URL(req.url, origin), path = url.pathname, method = req.method
      if (path.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(method) && !allowedOrigins.has(req.headers.origin) && !allowTestOrigin) fail(403, 'Сұрау көзі расталмады.')
        const ip = req.socket.remoteAddress || 'unknown'
        if (path === '/api/health' && method === 'GET') {
          try { db.prepare('SELECT 1 FROM app_settings LIMIT 1').get(); return send(res,200,{ ok: true }) }
          catch { return send(res,503,{ok:false}) }
        }
        if (path === '/api/admin/operations' && method === 'GET') {
          authenticate(req,true)
          return send(res,200,operations ? operations.status() : {enabled:false,available:false})
        }
        if (path === '/api/admin/operations/backup' && method === 'POST') {
          const {user:u} = await staffBody(req,true)
          if (!operations) fail(503,'Сақтық көшірме қызметі іске қосылмаған.')
          limit(`backup:${u.id}`,12,3600000)
          let result
          try {result=operations.runBackup()} catch(error) {fail(503,error.message)}
          audit(db,u.id,'backup.created',result.file)
          return send(res,201,result)
        }
        if (path === '/api/privacy' && method === 'GET') return send(res,200,{policy:currentPolicy(db)})
        if (path === '/api/admin/privacy' && method === 'GET') {
          authenticate(req,true)
          const draft = db.prepare('SELECT text_kk AS text,text_ru AS textRu FROM privacy_draft WHERE id=1').get() || null
          return send(res,200,{policy:currentPolicy(db),draft})
        }
        if (path === '/api/admin/privacy' && method === 'POST') {
          const {user:u,data:b}=await staffBody(req,true)
          if (!text(b.text,1,12000) || typeof b.textRu !== 'string' || b.textRu.length>12000 || !['draft','publish'].includes(b.action)) fail(400,'Шарттар мәтінін тексеріңіз. Ең көбі 12000 таңба.')
          if (b.action==='publish') {
            const settings=Object.fromEntries(db.prepare('SELECT key,value FROM app_settings').all().map(r=>[r.key,r.value]))
            if (b.approved!==true || !settings.organization?.trim() || !settings.phone?.trim() || b.text.trim().length<200 || b.textRu.trim().length<200) fail(400,'Жариялау үшін ұйым атауы мен телефонын толтырып, екі тілдегі шарттарды бекітіңіз.')
            if (/\[[^\]]+\]|— ЖОБА|— ПРОЕКТ/.test(b.text+'\n'+b.textRu)) fail(400,'Жариялаудан бұрын үлгідегі жақшалы өрістерді толтырып, жоба белгісін алып тастаңыз.')
          }
          transaction(db,()=>{
            db.prepare('INSERT INTO privacy_draft VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET text_kk=excluded.text_kk,text_ru=excluded.text_ru').run(b.text.trim(),b.textRu.trim())
            if (b.action==='publish') {
              const version=digest(JSON.stringify([b.text.trim(),b.textRu.trim()]))
              db.prepare('INSERT INTO privacy_policies VALUES (?,?,?,?,?) ON CONFLICT(version) DO UPDATE SET published_at=excluded.published_at,published_by=excluded.published_by').run(version,b.text.trim(),b.textRu.trim(),Date.now(),u.id)
            }
            audit(db,u.id,b.action==='publish'?'privacy.published':'privacy.draft-saved','privacy')
          })
          return send(res,200,{policy:currentPolicy(db)})
        }
        if (path === '/api/departments' && method === 'GET') return send(res,200,{ departments: db.prepare('SELECT * FROM departments WHERE active=1 ORDER BY name').all().map(department) })
        if (path === '/api/staff/departments' && method === 'GET') {
          const user = authenticate(req)
          const rows = user.role === 'admin'
            ? db.prepare('SELECT * FROM departments ORDER BY name').all()
            : db.prepare('SELECT d.* FROM departments d JOIN staff_departments s ON s.department_id=d.id WHERE s.user_id=? ORDER BY d.name').all(user.id)
          return send(res,200,{ departments: rows.map(department) })
        }
        if (path === '/api/availability' && method === 'GET') {
          const row = db.prepare('SELECT * FROM departments WHERE id=?').get(url.searchParams.get('departmentId'))
          return send(res,200,{ slots: slotsFor(db,row,url.searchParams.get('date') || '') })
        }
        if (path === '/api/schedule-exceptions' && method === 'GET') {
          const departmentId=url.searchParams.get('departmentId')||''
          if(!db.prepare('SELECT 1 FROM departments WHERE id=? AND active=1').get(departmentId)) fail(404,'Бөлім табылмады.')
          const from=url.searchParams.get('from')||localDate(),to=url.searchParams.get('to')||addDateDays(localDate(),90)
          if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>90*86400000) fail(400,'Күн аралығын тексеріңіз. Жазылу алдағы 90 күнге ашылады.')
          return send(res,200,{exceptions:effectiveExceptions(db,departmentId,from,to)})
        }
        if (path === '/api/appointments' && method === 'POST') {
          limit(`booking:${ip}`,20,3600000)
          const b = await body(req)
          if (!text(b.fullName,3,120) || b.fullName.trim().split(/\s+/).length < 2 || !text(b.issue,10,2000) || typeof b.phone !== 'string' || !/^\+7\d{10}$/.test(b.phone) || b.consent !== true || typeof b.departmentId !== 'string' || typeof b.date !== 'string' || typeof b.time !== 'string') fail(400,'Аты-жөніңізді, телефонды, мәселені және деректерді өңдеуге келісімді тексеріңіз.')
          const policy = currentPolicy(db)
          if (b.consentVersion!==undefined && b.consentVersion!==policy.version) fail(409,'Деректерді өңдеу шарттары жаңарды. Шарттарды қайта оқып, келісімді растаңыз.')
          const consentText = b.consentLanguage==='ru' && policy.textRu ? policy.textRu : policy.text
          const id = randomUUID()
          let accessToken
          transaction(db, () => {
            const d = db.prepare('SELECT * FROM departments WHERE id=?').get(b.departmentId)
            if (!slotsFor(db,d,b.date).includes(b.time)) fail(409,'Таңдалған уақыт бос емес. Басқа уақытты таңдаңыз.')
            // A phone can have several tickets; each must have a different short code.
            let attempts = 0
            do {
              if (++attempts > 100) fail(503,'Код жасау мүмкін болмады. Қайта көріңіз.')
              accessToken = String(randomInt(1_000_000)).padStart(6,'0')
            } while (db.prepare('SELECT 1 FROM appointments WHERE phone=? AND access_hash=?').get(b.phone,digest(accessToken)))
            db.prepare('INSERT INTO appointments(id,access_hash,department_id,full_name,phone,issue,date,time,slot_minutes,consent_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,digest(accessToken),b.departmentId,b.fullName.trim(),b.phone,b.issue.trim(),b.date,b.time,receptionSchedule(db,d,b.date).slotMinutes,consentText,Date.now(),Date.now())
            db.prepare('UPDATE appointments SET consent_version=? WHERE id=?').run(policy.version,id)
            audit(db,null,'appointment.created',id)
          })
          return send(res,201,{ appointment: appointment(db.prepare(`${appointmentSelect} WHERE a.id=?`).get(id)), accessToken })
        }
        const ticketMatch = /^\/api\/tickets\/(lookup|[a-f0-9-]{36})(\/(?:cancel|feedback))?$/.exec(path)
        if (ticketMatch && ['POST'].includes(method)) {
          limit(`ticket:${ip}`,60,900000)
          const b = await body(req)
          const byPhone = ticketMatch[1] === 'lookup'
          const phone = typeof b.phone === 'string' ? b.phone.replace(/[\s()-]/g,'') : ''
          const secret = typeof b.accessToken === 'string' ? b.accessToken : ''
          const identifier = byPhone ? phone : ticketMatch[1]
          const failureKey = `ticket-failed:${digest(identifier)}`
          const failures = db.prepare('SELECT hits FROM rate_limits WHERE key=? AND expires_at>?').get(failureKey,Date.now())
          if (failures?.hits >= 5) fail(429,'Код бірнеше рет қате енгізілді. 15 минуттан кейін қайталаңыз.')
          const row = db.prepare(`${appointmentSelect} WHERE a.${byPhone ? 'phone' : 'id'}=? AND a.access_hash=?`).get(identifier,digest(secret))
          if (!row || (byPhone && !/^\+7\d{10}$/.test(phone))) {
            limit(failureKey,5,900000)
            fail(404,'Талон табылмады. Телефон нөмірі мен кодты тексеріңіз.')
          }
          const feedbackEligible = () => row.status === 'completed' && new Date(`${row.date}T${row.time}:00+05:00`).getTime() + row.slot_minutes*60000 <= Date.now()
          if (ticketMatch[2] === '/feedback') {
            if (!feedbackEligible()) fail(409,'Бағалауды аяқталған қабылдаудан кейін ғана жіберуге болады.')
            const comment=b.comment===undefined?'':b.comment
            if (!Number.isInteger(b.rating) || b.rating<1 || b.rating>5 || typeof comment!=='string' || comment.length>1000) fail(400,'1–5 аралығында баға қойыңыз. Пікір 1000 таңбадан аспауы керек.')
            transaction(db,()=>{
              if(db.prepare('SELECT 1 FROM appointment_feedback WHERE appointment_id=?').get(row.id)) fail(409,'Бұл қабылдау бағаланған.')
              db.prepare('INSERT INTO appointment_feedback VALUES (?,?,?,?)').run(row.id,b.rating,comment.trim(),Date.now())
              audit(db,null,'appointment.feedback',row.id)
            })
          }
          if (ticketMatch[2] === '/cancel') {
            if (row.status !== 'scheduled' || new Date(`${row.date}T${row.time}:00+05:00`) <= new Date()) fail(409,'Бұл жазылудан бас тарту мүмкін емес.')
            transaction(db,()=>{ db.prepare("UPDATE appointments SET status='cancelled',updated_at=? WHERE id=?").run(Date.now(),row.id); audit(db,null,'appointment.cancelled',row.id) })
            row.status = 'cancelled'
          }
          // Internal staff notes are never part of a public ticket.
          const feedback=db.prepare('SELECT rating,comment,created_at AS createdAt FROM appointment_feedback WHERE appointment_id=?').get(row.id)||null
          return send(res,ticketMatch[2]==='/feedback'?201:200,{ appointment: { ...appointment(row), note: undefined }, feedback, feedbackEligible:feedbackEligible()&&!feedback })
        }
        if (path === '/api/auth/session' && method === 'GET') { const u = sessionUser(req); return send(res,200,{ user: u ? safeUser(db,u) : null }) }
        if (path === '/api/auth/password' && method === 'POST') {
          const {user:u,data:b}=await staffBody(req)
          limit(`password:${u.id}`,5,900000)
          confirmPassword(u,b.currentPassword)
          if (!validNewPassword(b.newPassword)) fail(400,'Жаңа құпиясөз 15–128 таңба болуы керек.')
          if (verifyPassword(b.newPassword,u.password_hash)) fail(400,'Жаңа құпиясөз бұрынғысынан өзгеше болуы керек.')
          replacePassword(db,u.id,b.newPassword,'password.changed')
          clearCookie(res)
          return send(res,200,{ok:true})
        }
        if (path === '/api/auth/recovery' && method === 'POST') {
          limit(`recovery:${ip}`,5,900000)
          const b=await body(req)
          if (!text(b.username,3,40)) fail(400,'Логинді енгізіңіз.')
          const user=db.prepare("SELECT id FROM users WHERE username=? AND status='active'").get(b.username.trim().toLowerCase())
          if(user) db.prepare('INSERT INTO recovery_requests VALUES (?,?) ON CONFLICT(user_id) DO NOTHING').run(user.id,Date.now())
          return send(res,200,{message:'Егер белсенді аккаунт бар болса, сұрау әкімшіге жіберілді. Жеке басыңызды растау үшін ұйым әкімшісімен байланысыңыз.'})
        }
        if (path === '/api/auth/reset-password' && method === 'POST') {
          limit(`reset:${ip}`,10,900000)
          const b=await body(req)
          if (typeof b.token!=='string' || !/^[a-f0-9]{64}$/.test(b.token)) fail(400,'Қалпына келтіру сілтемесі жарамсыз немесе мерзімі өткен.')
          const row=db.prepare("SELECT r.*,u.status,u.password_hash FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=? AND r.expires_at>?").get(digest(b.token),Date.now())
          if (!row || row.status!=='active') fail(400,'Қалпына келтіру сілтемесі жарамсыз немесе мерзімі өткен.')
          if (!validNewPassword(b.newPassword)) fail(400,'Жаңа құпиясөз 15–128 таңба болуы керек.')
          if (verifyPassword(b.newPassword,row.password_hash)) fail(400,'Жаңа құпиясөз бұрынғысынан өзгеше болуы керек.')
          replacePassword(db,row.user_id,b.newPassword,'password.reset')
          clearCookie(res)
          return send(res,200,{ok:true})
        }
        if (path === '/api/admin/recovery' && method === 'GET') {
          authenticate(req,true)
          return send(res,200,{requests:db.prepare("SELECT u.id,u.username,u.full_name AS fullName,u.role,r.requested_at AS requestedAt FROM recovery_requests r JOIN users u ON u.id=r.user_id WHERE u.status='active' ORDER BY r.requested_at").all()})
        }
        const resetMatch=/^\/api\/admin\/users\/([a-f0-9-]{36})\/reset-password$/.exec(path)
        if(resetMatch && method==='POST') {
          const {user:u,data:b}=await staffBody(req,true)
          limit(`password:${u.id}`,5,900000)
          confirmPassword(u,b.currentPassword)
          const target=db.prepare("SELECT id,role,status FROM users WHERE id=?").get(resetMatch[1])
          if(!target || target.role==='admin' || target.status!=='active') fail(400,'Тек белсенді қызметкерге қалпына келтіру сілтемесін беруге болады.')
          const result=issuePasswordReset(db,target.id,u.id)
          return send(res,201,result)
        }
        if (path === '/api/auth/register' && method === 'POST') {
          limit(`register:${ip}`,10,3600000)
          const b = await body(req), username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : ''
          if (!/^[a-z0-9._-]{3,40}$/.test(username) || !text(b.fullName,3,120) || !text(b.password,15,128) || b.governmentEmployee !== true) fail(400,'Логин: 3–40 латын таңбасы. Құпиясөз: 15–128 таңба. Қызметкер белгісін растаңыз.')
          const id = randomUUID(), hash = passwordHash(b.password)
          let admin = false
          transaction(db,()=>{
            if (b.bootstrapToken) {
              const key = db.prepare('SELECT * FROM bootstrap_keys WHERE token_hash=? AND used_at IS NULL AND expires_at>?').get(digest(String(b.bootstrapToken)),Date.now())
              if (!key || db.prepare("SELECT 1 FROM users WHERE role='admin'").get()) fail(403,'Әкімші сілтемесі жарамсыз.')
              db.prepare('UPDATE bootstrap_keys SET used_at=? WHERE token_hash=?').run(Date.now(),key.token_hash); admin=true
            }
            if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) fail(409,'Бұл логин қолданылған.')
            db.prepare('INSERT INTO users(id,username,full_name,password_hash,role,status,government_employee,created_at) VALUES (?,?,?,?,?,?,1,?)').run(id,username,b.fullName.trim(),hash,admin?'admin':'staff',admin?'active':'pending',Date.now())
            audit(db,id,'user.registered',id)
          })
          return send(res,201,{ message:admin?'Әкімші аккаунты құрылды. Енді логин мен құпиясөз арқылы кіріңіз.':'Аккаунт құрылды. Қызметкер аккаунтын әкімші растауы қажет.' })
        }
        if (path === '/api/auth/login' && method === 'POST') {
          limit(`login:${ip}`,30,900000)
          const b = await body(req)
          if (!text(b.username,1,40) || !text(b.password,1,128)) fail(400,'Логин мен құпиясөзді енгізіңіз.')
          const u = db.prepare('SELECT * FROM users WHERE username=?').get(b.username.trim().toLowerCase())
          // Run the same expensive hash operation for unknown usernames.
          const valid = verifyPassword(b.password,u?.password_hash || `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`)
          if (!u || !valid || u.status !== 'active') fail(401,'Кіру мүмкін болмады. Деректерді немесе аккаунттың расталуын тексеріңіз.')
          createSession(res,u.id); audit(db,u.id,'user.login',u.id)
          return send(res,200,{ user: safeUser(db,u) })
        }
        if (path === '/api/auth/logout' && method === 'POST') {
          const raw = /eq_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1]
          if (raw) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(raw))
          clearCookie(res)
          return send(res,200,{ ok:true })
        }
        if (path === '/api/staff/appointments' && method === 'GET') {
          const u = authenticate(req), clauses = [], args = []
          if (u.role !== 'admin') { clauses.push('a.department_id IN (SELECT department_id FROM staff_departments WHERE user_id=?)'); args.push(u.id) }
          for (const [key,column] of [['departmentId','department_id'],['date','date'],['status','status']]) if (url.searchParams.get(key)) { clauses.push(`a.${column}=?`); args.push(url.searchParams.get(key)) }
          const rows = db.prepare(`${appointmentSelect}${clauses.length ? ' WHERE '+clauses.join(' AND ') : ''} ORDER BY a.date DESC,a.time DESC LIMIT 1000`).all(...args)
          return send(res,200,{ appointments: rows.map(appointment), limit:1000 })
        }
        const updateMatch = /^\/api\/staff\/appointments\/([a-f0-9-]{36})$/.exec(path)
        if (updateMatch && method === 'PATCH') {
          const {user:u,data:b} = await staffBody(req), row = db.prepare('SELECT * FROM appointments WHERE id=?').get(updateMatch[1])
          if (!row) fail(404,'Жазылу табылмады.'); canAccess(u,row.department_id)
          if (!['scheduled','completed','cancelled','no_show'].includes(b.status) || typeof b.note !== 'string' || b.note.length>2000) fail(400,'Мәртебе немесе ескерту дұрыс емес.')
          if (row.status === 'cancelled' && b.status !== 'cancelled') fail(409,'Бас тартылған талонды қайта ашуға болмайды. Жаңа жазылу қажет.')
          transaction(db,()=>{ db.prepare('UPDATE appointments SET status=?,note=?,updated_at=? WHERE id=?').run(b.status,b.note,Date.now(),row.id); audit(db,u.id,`appointment.${b.status}`,row.id) })
          return send(res,200,{ ok:true })
        }
        if (path === '/api/admin/departments' && method === 'GET') { authenticate(req,true); return send(res,200,{ departments:db.prepare('SELECT * FROM departments ORDER BY name').all().map(department) }) }
        if (path === '/api/admin/schedule-exceptions' && method === 'GET') {
          authenticate(req,true)
          const from=url.searchParams.get('from')||localDate(),to=url.searchParams.get('to')||addDateDays(localDate(),366)
          if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>366*86400000) fail(400,'Ерекше күндер аралығын тексеріңіз. Ең көбі 367 күн көрсетіледі.')
          const rows=db.prepare(`SELECT e.*,(SELECT COUNT(*) FROM appointments a WHERE a.date=e.date AND a.status='scheduled'
            AND (e.department_id IS NULL OR a.department_id=e.department_id)) AS scheduled_count
            FROM schedule_exceptions e WHERE e.date BETWEEN ? AND ? ORDER BY e.date,e.department_id`).all(from,to)
          return send(res,200,{exceptions:rows.map(row=>({...publicException(row),id:row.id,departmentId:row.department_id||'',note:row.note,scheduledCount:row.scheduled_count}))})
        }
        if (path === '/api/admin/schedule-exceptions' && method === 'POST') {
          const {user:u,data:b}=await staffBody(req,true)
          if(!validDate(b.date)||b.date<localDate()||b.date>addDateDays(localDate(),366)) fail(400,'Ерекше күнді бүгіннен бастап алдағы 366 күн ішінен таңдаңыз.')
          if(typeof b.departmentId!=='string'||(b.departmentId&&!db.prepare('SELECT 1 FROM departments WHERE id=?').get(b.departmentId))) fail(400,'Бөлімді тексеріңіз.')
          if(typeof b.closed!=='boolean'||typeof b.note!=='string'||b.note.length>500||(!b.closed&&!validPeriods(b.periods,b.slotMinutes))) fail(400,'Арнайы кестені тексеріңіз: 1–2 уақыт аралығы, қабылдау ұзақтығы 15, 20, 30 немесе 60 минут. Ескерту 500 таңбадан аспауы керек.')
          const departmentId=b.departmentId||null
          if(b.id!==undefined){
            if(typeof b.id!=='string')fail(400,'Ереже табылмады.')
            const existing=db.prepare('SELECT * FROM schedule_exceptions WHERE id=?').get(b.id)
            if(!existing)fail(404,'Ереже табылмады.')
            if(existing.date!==b.date||existing.department_id!==departmentId)fail(400,'Өңдеу кезінде күн мен бөлімді өзгертуге болмайды. Жаңа ереже қосыңыз.')
          }else if(db.prepare('SELECT 1 FROM schedule_exceptions WHERE date=? AND department_id IS ?').get(b.date,departmentId))fail(409,'Бұл күн мен бөлімге ереже бар. Тізімдегі ережені өңдеңіз.')
          const id=b.id||randomUUID(),periods=b.closed?[]:b.periods.map(({start,end})=>({start,end}))
          transaction(db,()=>{
            db.prepare(`INSERT INTO schedule_exceptions(id,department_id,date,closed,periods,slot_minutes,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET closed=excluded.closed,periods=excluded.periods,slot_minutes=excluded.slot_minutes,note=excluded.note,updated_at=excluded.updated_at`)
              .run(id,departmentId,b.date,b.closed?1:0,JSON.stringify(periods),b.closed?null:b.slotMinutes,b.note.trim(),Date.now(),Date.now())
            audit(db,u.id,'schedule_exception.saved',id)
          })
          const scheduledCount=db.prepare("SELECT COUNT(*) n FROM appointments WHERE date=? AND status='scheduled' AND (? IS NULL OR department_id=?)").get(b.date,departmentId,departmentId).n
          return send(res,200,{id,scheduledCount})
        }
        const exceptionMatch=/^\/api\/admin\/schedule-exceptions\/([a-f0-9-]{36})$/.exec(path)
        if(exceptionMatch&&method==='DELETE'){
          const {user:u}=await staffBody(req,true)
          if(!db.prepare('SELECT 1 FROM schedule_exceptions WHERE id=?').get(exceptionMatch[1]))fail(404,'Ереже табылмады.')
          transaction(db,()=>{db.prepare('DELETE FROM schedule_exceptions WHERE id=?').run(exceptionMatch[1]);audit(db,u.id,'schedule_exception.deleted',exceptionMatch[1])})
          return send(res,200,{ok:true})
        }
        if (path === '/api/admin/departments' && method === 'POST') {
          const {user:u,data:b}=await staffBody(req,true)
          const validTime = v => typeof v==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
          if (!text(b.name,2,150) || typeof b.description!=='string' || b.description.length>1000 || typeof b.active!=='boolean' || !Array.isArray(b.weekdays) || b.weekdays.length<1 || b.weekdays.length>5 || !b.weekdays.every(n=>Number.isInteger(n)&&n>=1&&n<=5) || ![b.startTime,b.breakStart,b.breakEnd,b.endTime].every(validTime) || !(b.startTime<b.breakStart&&b.breakStart<b.breakEnd&&b.breakEnd<b.endTime) || ![15,20,30,60].includes(b.slotMinutes)) fail(400,'Бөлім кестесін тексеріңіз. Сенбі мен жексенбі — демалыс.')
          const minute = v => Number(v.slice(0,2))*60+Number(v.slice(3))
          if (minute(b.breakStart)-minute(b.startTime)<b.slotMinutes || minute(b.endTime)-minute(b.breakEnd)<b.slotMinutes) fail(400,'Әр қабылдау аралығында кемінде бір бос уақыт болуы керек.')
          if (b.id !== undefined && (typeof b.id!=='string' || !db.prepare('SELECT 1 FROM departments WHERE id=?').get(b.id))) fail(404,'Бөлім табылмады.')
          const id = b.id || randomUUID()
          transaction(db,()=>{ db.prepare(`INSERT INTO departments(id,name,description,active,weekdays,start_time,end_time,break_start,break_end,slot_minutes) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,active=excluded.active,weekdays=excluded.weekdays,start_time=excluded.start_time,end_time=excluded.end_time,break_start=excluded.break_start,break_end=excluded.break_end,slot_minutes=excluded.slot_minutes`).run(id,b.name.trim(),b.description,b.active?1:0,JSON.stringify([...new Set(b.weekdays)]),b.startTime,b.endTime,b.breakStart,b.breakEnd,b.slotMinutes); audit(db,u.id,'department.saved',id) })
          return send(res,200,{ id })
        }
        if (path === '/api/admin/users' && method === 'GET') {
          authenticate(req,true)
          return send(res,200,{ users:db.prepare('SELECT * FROM users ORDER BY created_at DESC').all().map(u=>safeUser(db,u)) })
        }
        const userMatch = /^\/api\/admin\/users\/([a-f0-9-]{36})$/.exec(path)
        if (userMatch && method === 'DELETE') {
          const {user:u}=await staffBody(req,true)
          const target=db.prepare('SELECT * FROM users WHERE id=?').get(userMatch[1])
          if (!target) fail(404,'Қызметкер табылмады.')
          if (target.role==='admin') fail(400,'Әкімші аккаунтын өшіруге болмайды.')
          transaction(db,()=>{
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id)
            db.prepare('DELETE FROM password_resets WHERE user_id=?').run(target.id)
            db.prepare('DELETE FROM recovery_requests WHERE user_id=?').run(target.id)
            db.prepare('DELETE FROM staff_departments WHERE user_id=?').run(target.id)
            db.prepare('UPDATE users SET approved_by=NULL WHERE approved_by=?').run(target.id)
            db.prepare('DELETE FROM users WHERE id=?').run(target.id)
            audit(db,u.id,'user.deleted',target.id)
          })
          return send(res,200,{ok:true,id:target.id})
        }
        if (userMatch && method === 'PATCH') {
          const {user:u,data:b}=await staffBody(req,true), target=db.prepare('SELECT * FROM users WHERE id=?').get(userMatch[1])
          if (!target) fail(404,'Қызметкер табылмады.')
          if (target.role==='admin') fail(400,'Әкімші аккаунтын бұл жерден өзгертуге болмайды.')
          if (!['active','rejected','disabled','pending'].includes(b.status) || !Array.isArray(b.departmentIds) || b.departmentIds.length>100 || !b.departmentIds.every(id=>typeof id==='string'&&db.prepare('SELECT 1 FROM departments WHERE id=?').get(id))) fail(400,'Мәртебе мен бөлімдерді тексеріңіз.')
          if (b.status==='active' && !b.departmentIds.length) fail(400,'Рұқсат беру үшін кемінде бір бөлімді таңдаңыз.')
          transaction(db,()=>{
            db.prepare('UPDATE users SET status=?,approved_by=?,approved_at=? WHERE id=?').run(b.status,u.id,Date.now(),target.id)
            db.prepare('DELETE FROM staff_departments WHERE user_id=?').run(target.id)
            for (const id of new Set(b.departmentIds)) db.prepare('INSERT INTO staff_departments VALUES (?,?)').run(target.id,id)
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id)
            db.prepare('DELETE FROM password_resets WHERE user_id=?').run(target.id)
            db.prepare('DELETE FROM recovery_requests WHERE user_id=?').run(target.id)
            audit(db,u.id,`user.${b.status}`,target.id)
          })
          return send(res,200,{ ok:true, user:safeUser(db,db.prepare('SELECT * FROM users WHERE id=?').get(target.id)) })
        }
        if (path === '/api/admin/audit' && method === 'GET') { authenticate(req,true); return send(res,200,{ events:db.prepare('SELECT e.*,u.full_name AS actor_name FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id ORDER BY e.id DESC LIMIT 200').all() }) }
        if (path === '/api/admin/statistics' && method === 'GET') {
          authenticate(req,true)
          const to=url.searchParams.get('to')||localDate()
          const first=new Date(`${to}T00:00:00Z`);first.setUTCDate(first.getUTCDate()-29)
          const from=url.searchParams.get('from')||(Number.isNaN(first.getTime())?'':first.toISOString().slice(0,10))
          const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value
          if(!validDate(from)||!validDate(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>365) fail(400,'Күн аралығын тексеріңіз. Ең көбі 366 күн таңдауға болады.')
          const departmentId=url.searchParams.get('departmentId')||''
          if(departmentId&&!db.prepare('SELECT 1 FROM departments WHERE id=?').get(departmentId)) fail(404,'Бөлім табылмады.')
          return send(res,200,statistics(db,{from,to,departmentId}))
        }
        if (path === '/api/settings' && method === 'GET') {
          const settings = Object.fromEntries(db.prepare('SELECT key,value FROM app_settings').all().map(r=>[r.key,r.value]))
          if (!settings.privacyText?.trim()) settings.privacyText = DEFAULT_PRIVACY_TEXT
          const policy=currentPolicy(db)
          settings.privacyText=policy.text
          settings.privacyTextRu=policy.textRu
          settings.privacyVersion=policy.version
          settings.privacyApproved=policy.approved
          return send(res,200,{ settings })
        }
        if (path === '/api/admin/settings' && method === 'POST') {
          const {user:u,data:b}=await staffBody(req,true), keys=['organization','address','phone',...(b.privacyText===undefined?[]:['privacyText'])]
          if (!keys.every(k=>typeof b[k]==='string'&&b[k].length<=(k==='privacyText'?5000:500))) fail(400,'Баптауларды тексеріңіз.')
          transaction(db,()=>{ for (const k of keys) db.prepare('INSERT INTO app_settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,b[k]); audit(db,u.id,'settings.saved','organization') })
          return send(res,200,{ ok:true })
        }
        fail(404,'API табылмады.')
      }
      if (!['GET','HEAD'].includes(method)) fail(405,'Әдіске рұқсат жоқ.')
      let requested
      try { requested = decodeURIComponent(path) } catch { fail(400,'Мекенжай дұрыс емес.') }
      if (requested.split('/').some(p=>p.startsWith('.') || p.includes('\\') || p.includes(':'))) fail(404,'Файл табылмады.')
      let file = resolve(staticDir, `.${requested}`)
      if (!file.startsWith(staticDir+sep) && file!==staticDir) fail(404,'Файл табылмады.')
      if (requested==='/' || !extname(requested)) file=resolve(staticDir,'index.html')
      let data
      try { data=await readFile(file) } catch { fail(404,'Файл табылмады. Алдымен npm run build орындаңыз.') }
      const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'}
      const compressible = ['.html','.js','.css','.svg'].includes(extname(file))
      const acceptsGzip = (req.headers['accept-encoding'] || '').split(',').some(value => {
        const [encoding,...parameters] = value.trim().split(';')
        return encoding.toLowerCase() === 'gzip' && !parameters.some(parameter => /^\s*q=0(?:\.0*)?\s*$/i.test(parameter))
      })
      if (compressible) res.setHeader('Vary','Accept-Encoding')
      if (compressible && acceptsGzip) { data=await compress(data);res.setHeader('Content-Encoding','gzip') }
      res.setHeader('Content-Length',data.length)
      res.writeHead(200,{'Content-Type':types[extname(file)] || 'application/octet-stream','Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=3600'})
      res.end(method==='HEAD'?undefined:data)
    } catch (error) {
      if (error.status) send(res,error.status,{ error:error.message })
      else if (error.code?.startsWith('ERR_SQLITE') && error.message?.includes('UNIQUE constraint failed: appointments')) send(res,409,{ error:'Бұл уақыт бос емес. Басқа уақытты таңдаңыз.' })
      else { console.error('Request failed:',error.code || error.name); send(res,500,{ error:'Серверде қате болды. Қайталап көріңіз.' }) }
    }
  })
  server.headersTimeout=15000; server.requestTimeout=30000
  return { server, db }
}
