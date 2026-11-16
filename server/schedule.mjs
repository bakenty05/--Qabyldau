export const validDate = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value

export function addDateDays(date,count) {
  const result=new Date(`${date}T00:00:00Z`)
  result.setUTCDate(result.getUTCDate()+count)
  return result.toISOString().slice(0,10)
}

export const publicException = row => ({date:row.date,closed:!!row.closed,periods:JSON.parse(row.periods),slotMinutes:row.slot_minutes})

export function effectiveExceptions(db,departmentId,from,to) {
  const rows=db.prepare(`SELECT * FROM schedule_exceptions WHERE date BETWEEN ? AND ?
    AND (department_id IS NULL OR department_id=?) ORDER BY date,department_id IS NULL DESC`).all(from,to,departmentId)
  const days=new Map()
  for(const row of rows)days.set(row.date,publicException(row))
  return [...days.values()]
}

export function receptionSchedule(db,department,date) {
  if(!department?.active)return {closed:true,periods:[],slotMinutes:department?.slot_minutes||30}
  // An explicitly configured department day takes precedence over a general day.
  const exception=db.prepare(`SELECT * FROM schedule_exceptions WHERE date=? AND (department_id=? OR department_id IS NULL)
    ORDER BY department_id IS NULL LIMIT 1`).get(date,department.id)
  if(exception)return publicException(exception)
  const weekday=new Date(`${date}T00:00:00Z`).getUTCDay()
  const closed=weekday===0||weekday===6||!JSON.parse(department.weekdays).includes(weekday)
  return {closed,periods:closed?[]:[{start:department.start_time,end:department.break_start},{start:department.break_end,end:department.end_time}],slotMinutes:department.slot_minutes}
}

export function validPeriods(periods,slotMinutes) {
  const time=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3))
  return [15,20,30,60].includes(slotMinutes)&&Array.isArray(periods)&&periods.length>=1&&periods.length<=2
    &&periods.every((period,index)=>period&&typeof period==='object'&&!Array.isArray(period)&&time(period.start)&&time(period.end)
      &&minutes(period.end)-minutes(period.start)>=slotMinutes&&(index===0||periods[index-1].end<=period.start))
}
