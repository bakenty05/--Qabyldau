import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import { receptionSchedule } from './schedule.mjs'

export const digest = value => createHash('sha256').update(value).digest('hex')
export const token = () => randomBytes(32).toString('hex')
export const DEFAULT_PRIVACY_TEXT = 'Аты-жөніңіз, телефон нөміріңіз және көрсеткен мәселеңіз қабылдауға жазылуды ұйымдастыру үшін осы жүйеде сақталады. Жазбаға әкімші және тиісті бөлімнің рұқсаты бар қызметкерлері қол жеткізе алады. Талонның жеке кілті арқылы жазылуыңызды тексеріп, қабылдау басталғанға дейін одан бас тарта аласыз.'
export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex')
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}
export function verifyPassword(password, hash) {
  const parts = hash.split(/[:$]/)
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !/^[a-f0-9]{128}$/i.test(parts[2])) return false
  return timingSafeEqual(scryptSync(password, parts[1], 64), Buffer.from(parts[2], 'hex'))
}
export function openStore(path = process.env.STAFF_DB_PATH || '.data/staff.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','staff')),
      status TEXT NOT NULL CHECK(status IN ('pending','active','rejected','disabled')),
      government_employee INTEGER NOT NULL CHECK(government_employee=1),
      created_at INTEGER NOT NULL, approved_by TEXT REFERENCES users(id), approved_at INTEGER);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bootstrap_keys (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used_at INTEGER);
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 0, weekdays TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
      start_time TEXT NOT NULL DEFAULT '09:30', end_time TEXT NOT NULL DEFAULT '18:30',
      break_start TEXT NOT NULL DEFAULT '12:30', break_end TEXT NOT NULL DEFAULT '15:30',
      slot_minutes INTEGER NOT NULL DEFAULT 30);
    CREATE TABLE IF NOT EXISTS staff_departments (
      user_id TEXT NOT NULL REFERENCES users(id), department_id TEXT NOT NULL REFERENCES departments(id),
      PRIMARY KEY(user_id,department_id));
    CREATE TABLE IF NOT EXISTS appointments (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      access_hash TEXT NOT NULL, department_id TEXT NOT NULL REFERENCES departments(id),
      full_name TEXT NOT NULL, phone TEXT NOT NULL, issue TEXT NOT NULL,
      date TEXT NOT NULL, time TEXT NOT NULL, slot_minutes INTEGER NOT NULL DEFAULT 30,
      consent_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled','no_show')),
      note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS appointment_slot ON appointments(department_id,date,time) WHERE status <> 'cancelled';
    CREATE INDEX IF NOT EXISTS appointment_phone_access ON appointments(phone,access_hash);
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT NOT NULL,
      target_id TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS appointment_feedback (
      appointment_id TEXT PRIMARY KEY REFERENCES appointments(id),
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS appointment_date ON appointments(date,department_id);
    CREATE TABLE IF NOT EXISTS schedule_exceptions (
      id TEXT PRIMARY KEY, department_id TEXT REFERENCES departments(id), date TEXT NOT NULL,
      closed INTEGER NOT NULL CHECK(closed IN (0,1)), periods TEXT NOT NULL DEFAULT '[]',
      slot_minutes INTEGER, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS exception_scope_date ON schedule_exceptions(date,COALESCE(department_id,''));
    CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY);`)
  const columns = db.prepare('PRAGMA table_info(appointments)').all().map(c=>c.name)
  if (!columns.includes('slot_minutes')) db.exec('ALTER TABLE appointments ADD COLUMN slot_minutes INTEGER NOT NULL DEFAULT 30')
  if (!columns.includes('consent_text')) db.exec("ALTER TABLE appointments ADD COLUMN consent_text TEXT NOT NULL DEFAULT ''")
  const departmentColumns = db.prepare('PRAGMA table_info(departments)').all().map(c=>c.name)
  if (!departmentColumns.includes('break_start')) db.exec("ALTER TABLE departments ADD COLUMN break_start TEXT NOT NULL DEFAULT '12:30'")
  if (!departmentColumns.includes('break_end')) db.exec("ALTER TABLE departments ADD COLUMN break_end TEXT NOT NULL DEFAULT '15:30'")
  // Keep a public intake available until the administrator configures departments.
  // Existing departments (including deliberately closed ones) are never reopened.
  db.prepare(`INSERT INTO departments(id,name,description,active,start_time,end_time,break_start,break_end,weekdays)
    SELECT 'general-reception','Жалпы қабылдау','Қабылдауға жазылу және жалпы мәселелер.',1,'09:30','18:30','12:30','15:30','[1,2,3,4,5]'
    WHERE NOT EXISTS (SELECT 1 FROM departments)`).run()
  transaction(db,()=>{
    if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('split-reception-schedule-v1')) {
      db.prepare("UPDATE departments SET start_time='09:30',end_time='18:30',break_start='12:30',break_end='15:30',weekdays='[1,2,3,4,5]'").run()
      db.prepare(`INSERT OR IGNORE INTO departments(id,name,description,active,start_time,end_time,break_start,break_end,weekdays)
        VALUES ('mayor-reception','Әкімге жазылу','Әкімнің жеке қабылдауына жазылу.',1,'09:30','18:30','12:30','15:30','[1,2,3,4,5]')`).run()
      db.prepare('INSERT INTO schema_migrations VALUES (?)').run('split-reception-schedule-v1')
    }
  })
  return db
}
export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE')
  try { const value = work(); db.exec('COMMIT'); return value }
  catch (error) { db.exec('ROLLBACK'); throw error }
}
export const audit = (db, actor, action, target) => db.prepare('INSERT INTO audit_events(actor_id,action,target_id,created_at) VALUES (?,?,?,?)').run(actor, action, target, Date.now())
export const publicUser = row => row && ({ id: row.id, username: row.username, fullName: row.full_name, role: row.role, status: row.status })
export function localDate(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const v = Object.fromEntries(p.map(x => [x.type, x.value]))
  return `${v.year}-${v.month}-${v.day}`
}
export function slotsFor(db, department, date, now = new Date()) {
  if (!department?.active || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
  const day = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0,10) !== date || date < localDate(now) || day.getTime() > new Date(`${localDate(now)}T00:00:00Z`).getTime() + 90 * 86400000) return []
  const schedule=receptionSchedule(db,department,date)
  if(schedule.closed)return []
  const minutes = value => Number(value.slice(0,2)) * 60 + Number(value.slice(3))
  const occupied = db.prepare("SELECT time,slot_minutes FROM appointments WHERE department_id=? AND date=? AND status <> 'cancelled'").all(department.id, date)
  const result = []
  for (const {start,end} of schedule.periods) {
    for (let m = minutes(start); m + schedule.slotMinutes <= minutes(end); m += schedule.slotMinutes) {
      const time = `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
      if (!occupied.some(x=>m < minutes(x.time)+x.slot_minutes && m+schedule.slotMinutes > minutes(x.time)) && new Date(`${date}T${time}:00+05:00`) > now) result.push(time)
    }
  }
  return result
}
