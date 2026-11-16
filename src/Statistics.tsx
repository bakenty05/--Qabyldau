import { useEffect, useState } from 'react'
import { api, errorMessage } from './api'
import { t, locale } from './i18n'
import { addDays } from './reception-calendar'
import './statistics.css'

type Metrics = { total:number; scheduled:number; completed:number; cancelled:number; noShow:number; feedbackCount:number; averageRating:number|null }
type StatisticsData = {
  summary:Metrics
  daily:(Metrics&{date:string})[]
  departments:(Metrics&{id:string;name:string})[]
  feedback:{appointmentId:string;sequence:number;departmentName:string;rating:number;comment:string;createdAt:number}[]
}
function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()) }

export default function Statistics({departments}:{departments:{id:string;name:string}[]}) {
  const [filter,setFilter]=useState(()=>({from:addDays(today(),-29),to:today(),departmentId:''}))
  const [result,setResult]=useState<{key:string;data:StatisticsData}|null>(null)
  const [error,setError]=useState('')
  const [retry,setRetry]=useState(0)
  const [settled,setSettled]=useState('')
  const query=new URLSearchParams({...filter,retry:String(retry)}).toString()
  const validRange=!!filter.from&&!!filter.to&&filter.from<=filter.to&&(Date.parse(filter.to)-Date.parse(filter.from))/86400000<=365
  const data=validRange&&result?.key===query?result.data:null
  const loading=validRange&&settled!==query
  useEffect(()=>{
    if(!validRange)return
    const controller=new AbortController()
    api<StatisticsData>(`/api/admin/statistics?${query}`,undefined,'GET',controller.signal)
      .then(data=>{if(!controller.signal.aborted){setResult({key:query,data});setError('')}})
      .catch(error=>{if(!controller.signal.aborted)setError(errorMessage(error))})
      .finally(()=>{if(!controller.signal.aborted)setSettled(query)})
    return()=>controller.abort()
  },[query,validRange])
  const number=(value:number)=>new Intl.NumberFormat(locale(),{maximumFractionDigits:2}).format(value)
  return <div className="statistics" aria-busy={loading}>
    <div className="stats-title"><div><h2>{t('Статистика')}</h2><p className="hint">{t('Қабылдау күні бойынша · UTC+5')}</p></div><div className="actions"><button className="outline" onClick={()=>setFilter({...filter,from:today(),to:today()})}>{t('Бүгін')}</button><button className="outline" onClick={()=>setFilter({...filter,from:addDays(today(),-29),to:today()})}>{t('Соңғы 30 күн')}</button></div></div>
    <form className="panel filters" onSubmit={event=>{event.preventDefault();setRetry(value=>value+1)}}>
      <label>{t('Бастапқы күн')}<input name="statsFrom" type="date" required value={filter.from} max={filter.to} onChange={event=>setFilter({...filter,from:event.target.value})}/></label>
      <label>{t('Соңғы күн')}<input name="statsTo" type="date" required value={filter.to} min={filter.from} onChange={event=>setFilter({...filter,to:event.target.value})}/></label>
      <label>{t('Бөлім')}<select name="statsDepartment" value={filter.departmentId} onChange={event=>setFilter({...filter,departmentId:event.target.value})}><option value="">{t('Барлық бөлімдер')}</option>{departments.map(d=><option key={d.id} value={d.id}>{t(d.name)}</option>)}</select></label>
      <button className="outline" disabled={loading||!validRange}>{t('Жаңарту')}</button>
    </form>
    {loading&&<p role="status" className="notice">{t('Жүктелуде…')}</p>}
    {!validRange&&<p className="alert" role="alert">{t('Күн аралығын тексеріңіз. Ең көбі 366 күн таңдауға болады.')}</p>}
    {!loading&&validRange&&error&&<p className="alert" role="alert">{t(error)} <button onClick={()=>setRetry(value=>value+1)}>{t('Қайталау')}</button></p>}
    {data&&<>
      <div className="stats-cards">{([
        ['total','Жазылу саны'],['scheduled','Күтілуде'],['completed','Қабылданғандар'],['cancelled','Бас тартқандар'],['noShow','Келмегендер'],
      ] as const).map(([key,label])=><article className={`panel metric metric-${key}`} key={key}><span>{t(label)}</span><strong data-metric={key}>{number(data.summary[key])}</strong></article>)}
        <article className="panel metric metric-rating"><span>{t('Орташа баға')}</span><strong data-metric="averageRating">{data.summary.averageRating===null?'—':number(data.summary.averageRating)+' / 5'}</strong><small>{number(data.summary.feedbackCount)} {t('бағалау')}</small></article>
      </div>
      <div className="stats-columns">
        <section className="panel"><h3>{t('Бөлімдердің жүктемесі')}</h3>{!data.departments.length?<p className="empty">{t('Осы аралықта жазылу жоқ.')}</p>:<ol className="department-ranking">{data.departments.map(d=><li key={d.id}><div><span>{t(d.name)}</span><strong>{number(d.total)}</strong></div><progress value={d.total} max={Math.max(...data.departments.map(item=>item.total),1)} aria-label={t(d.name)}/><small>{t('Қабылданды')}: {number(d.completed)} · {t('Бас тартылды')}: {number(d.cancelled)} · {t('Келмеді')}: {number(d.noShow)}</small></li>)}</ol>}</section>
        <section className="panel"><h3>{t('Соңғы пікірлер')}</h3>{!data.feedback.length?<p className="empty">{t('Осы аралықта пікірлер жоқ.')}</p>:<ul className="feedback-list">{data.feedback.map(f=><li key={f.appointmentId}><div><strong>{'★'.repeat(f.rating)}<span className="sr-only"> {f.rating} / 5</span></strong><time dateTime={new Date(f.createdAt).toISOString()}>{new Intl.DateTimeFormat(locale(),{dateStyle:'short',timeZone:'Asia/Qyzylorda'}).format(f.createdAt)}</time></div><p className="preserve">{f.comment||t('Пікірсіз бағалау')}</p><small>{t(f.departmentName)} · A-{String(f.sequence).padStart(4,'0')}</small></li>)}</ul>}</section>
      </div>
      <section className="panel stats-daily"><h3>{t('Күндер бойынша')}</h3><div className="table-wrap"><table><thead><tr>{['Күні','Жазылу саны','Күтілуде','Қабылданғандар','Бас тартқандар','Келмегендер'].map(label=><th key={label}>{t(label)}</th>)}</tr></thead><tbody>{data.daily.map(day=><tr key={day.date}><td><time dateTime={day.date}>{new Intl.DateTimeFormat(locale(),{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(new Date(day.date+'T00:00:00Z'))}</time></td>{(['total','scheduled','completed','cancelled','noShow'] as const).map(key=><td key={key}>{number(day[key])}</td>)}</tr>)}</tbody></table></div></section>
      <p className="hint">{t('Барлық жазылулар есептеледі, тізімдегі 1000 жазба шегі қолданылмайды.')}</p>
    </>}
  </div>
}
