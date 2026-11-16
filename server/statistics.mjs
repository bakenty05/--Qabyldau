// These aggregates deliberately have no appointment-list limit.
export function statistics(db,{from,to,departmentId=''}) {
  const args=[from,to,...(departmentId?[departmentId]:[])]
  const where=`a.date BETWEEN ? AND ?${departmentId?' AND a.department_id=?':''}`
  const metrics=`COUNT(*) AS total,
    COALESCE(SUM(a.status='scheduled'),0) AS scheduled,
    COALESCE(SUM(a.status='completed'),0) AS completed,
    COALESCE(SUM(a.status='cancelled'),0) AS cancelled,
    COALESCE(SUM(a.status='no_show'),0) AS noShow,
    COUNT(f.rating) AS feedbackCount, ROUND(AVG(f.rating),2) AS averageRating`
  const join='FROM appointments a LEFT JOIN appointment_feedback f ON f.appointment_id=a.id'
  const summary=db.prepare(`SELECT ${metrics} ${join} WHERE ${where}`).get(...args)
  const days=db.prepare(`SELECT a.date,${metrics} ${join} WHERE ${where} GROUP BY a.date ORDER BY a.date`).all(...args)
  const byDay=new Map(days.map(row=>[row.date,row]))
  const daily=[]
  for(let cursor=new Date(`${from}T00:00:00Z`);cursor.toISOString().slice(0,10)<=to;cursor.setUTCDate(cursor.getUTCDate()+1)) {
    const date=cursor.toISOString().slice(0,10)
    daily.push(byDay.get(date)||{date,total:0,scheduled:0,completed:0,cancelled:0,noShow:0,feedbackCount:0,averageRating:null})
  }
  const departments=db.prepare(`SELECT a.department_id AS id,d.name,${metrics} ${join}
    JOIN departments d ON d.id=a.department_id WHERE ${where} GROUP BY a.department_id ORDER BY total DESC,d.name`).all(...args)
  const feedback=db.prepare(`SELECT a.id AS appointmentId,a.sequence,d.name AS departmentName,
    f.rating,f.comment,f.created_at AS createdAt ${join} JOIN departments d ON d.id=a.department_id
    WHERE ${where} AND f.rating IS NOT NULL ORDER BY f.created_at DESC,a.sequence DESC LIMIT 20`).all(...args)
  return {from,to,departmentId,summary,daily,departments,feedback}
}
