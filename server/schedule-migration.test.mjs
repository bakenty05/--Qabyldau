import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openStore } from './store.mjs'

test('legacy database receives split hours and independent mayor once without reopening closed departments',()=>{
  const directory=mkdtempSync(join(tmpdir(),'qabyldau-schedule-'))
  const path=join(directory,'legacy.sqlite')
  let db=new DatabaseSync(path)
  try {
    db.exec(`CREATE TABLE departments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 0, weekdays TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
      start_time TEXT NOT NULL DEFAULT '09:00',end_time TEXT NOT NULL DEFAULT '18:00',
      slot_minutes INTEGER NOT NULL DEFAULT 30);
      INSERT INTO departments(id,name,active) VALUES ('retained','Existing closed department',0);`)
    db.close();db=openStore(path)
    const retained=db.prepare('SELECT * FROM departments WHERE id=?').get('retained')
    assert.equal(retained.active,0);assert.equal(retained.name,'Existing closed department')
    assert.equal(retained.start_time,'09:30');assert.equal(retained.end_time,'18:30')
    assert.equal(retained.break_start,'12:30');assert.equal(retained.break_end,'15:30')
    const mayor=db.prepare('SELECT * FROM departments WHERE id=?').get('mayor-reception')
    assert.equal(mayor.start_time,'09:30');assert.equal(mayor.end_time,'18:30')
    db.prepare("UPDATE departments SET start_time='10:00' WHERE id='retained'").run()
    db.prepare("INSERT INTO schedule_exceptions(id,department_id,date,closed,periods,note,created_at,updated_at) VALUES ('retained-day',NULL,'2026-12-01',1,'[]','Saved day off',1,1)").run()
    db.close();db=openStore(path)
    assert.equal(db.prepare("SELECT start_time FROM departments WHERE id='retained'").get().start_time,'10:00')
    assert.equal(db.prepare("SELECT count(*) AS n FROM departments WHERE id='mayor-reception'").get().n,1)
    assert.equal(db.prepare("SELECT note FROM schedule_exceptions WHERE id='retained-day'").get().note,'Saved day off')
  } finally {db.close();unlinkSync(path);rmdirSync(directory)}
})
