import test from 'node:test'
import assert from 'node:assert/strict'
import { addDays, isReceptionDate, monthDays } from '../src/reception-calendar.ts'

test('calendar disables Saturday and Sunday even if present in department settings',()=>{
  const all=[0,1,2,3,4,5,6]
  assert.equal(isReceptionDate('2026-11-14','2026-11-09','2027-02-07',all),false)
  assert.equal(isReceptionDate('2026-11-15','2026-11-09','2027-02-07',all),false)
  assert.equal(isReceptionDate('2026-11-13','2026-11-09','2027-02-07',all),true)
})
test('calendar enforces valid dates, department weekdays and booking horizon',()=>{
  const days=[1,2,3,4,5]
  assert.equal(isReceptionDate('2026-11-31','2026-11-09','2027-02-07',days),false)
  assert.equal(isReceptionDate('2026-11-06','2026-11-09','2027-02-07',days),false)
  assert.equal(isReceptionDate('2027-02-08','2026-11-09','2027-02-07',days),false)
  assert.equal(isReceptionDate('2026-11-10','2026-11-09','2027-02-07',[1]),false)
  assert.equal(isReceptionDate('2026-11-09','2026-11-09','2027-02-07',days),true)
})
test('calendar aligns weekdays Monday first and handles year and leap day boundaries',()=>{
  const days=monthDays('2026-11')
  assert.deepEqual(days.slice(0,6),Array(6).fill(null))
  assert.equal(days[6],'2026-11-01');assert.equal(days.at(-1),'2026-11-30')
  assert.equal(addDays('2026-12-31',1),'2027-01-01')
  assert.equal(addDays('2028-02-28',1),'2028-02-29')
})
