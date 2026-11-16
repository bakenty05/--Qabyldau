import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, errorMessage } from './api'
import { t } from './i18n'
import { addDays, formatReceptionDate } from './reception-calendar'
import type { ReceptionException } from './reception-calendar'
import './special-days.css'

type Rule=ReceptionException&{id:string;departmentId:string;note:string;scheduledCount:number}
type Draft={id?:string;date:string;departmentId:string;closed:boolean;periods:{start:string;end:string}[];slotMinutes:number;note:string}
const blank=(departmentId=''):Draft=>({date:'',departmentId,closed:true,periods:[{start:'09:30',end:'12:30'}],slotMinutes:30,note:''})
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}

export default function SpecialDays({departments,onAppointments}:{departments:{id:string;name:string;active:boolean;slotMinutes:number}[];onAppointments:(date:string,departmentId:string)=>void}) {
  const [draft,setDraft]=useState<Draft>(()=>blank())
  const [rules,setRules]=useState<Rule[]>([])
  const [error,setError]=useState(''),[message,setMessage]=useState('')
  const [loadError,setLoadError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false)
  const [retry,setRetry]=useState(0),[confirmDelete,setConfirmDelete]=useState('')
  const [saved,setSaved]=useState<{date:string;departmentId:string;count:number}|null>(null)
  const saving=useRef(false)
  const from=today(),to=addDays(from,366)
  useEffect(()=>{
    const controller=new AbortController()
    api<{exceptions:Rule[]}>(`/api/admin/schedule-exceptions?${new URLSearchParams({from,to})}`,undefined,'GET',controller.signal)
      .then(data=>{if(!controller.signal.aborted){setRules(data.exceptions);setLoadError('')}})
      .catch(error=>{if(!controller.signal.aborted)setLoadError(errorMessage(error))})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[from,to,retry])
  function change<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(current=>({...current,[key]:value}));setError('');setMessage('')}
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(saving.current)return
    saving.current=true;setBusy(true);setError('');setMessage('');setSaved(null)
    try{
      const result=await api<{id:string;scheduledCount:number}>('/api/admin/schedule-exceptions',{...draft,periods:draft.closed?[]:draft.periods})
      setSaved({date:draft.date,departmentId:draft.departmentId,count:result.scheduledCount})
      setMessage('Ерекше күн сақталды.');setDraft(blank(draft.departmentId));setRetry(value=>value+1)
    }catch(error){setError(errorMessage(error))}
    finally{saving.current=false;setBusy(false)}
  }
  async function remove(rule:Rule){
    if(saving.current)return
    saving.current=true;setBusy(true);setError('');setMessage('');setSaved(null)
    try{
      await api(`/api/admin/schedule-exceptions/${rule.id}`,{},'DELETE')
      if(draft.id===rule.id)setDraft(blank(draft.departmentId))
      setConfirmDelete('');setMessage('Ереже өшірілді. Қалған ережелер мен апталық кесте қолданылады.');setRetry(value=>value+1)
    }catch(error){setError(errorMessage(error))}
    finally{saving.current=false;setBusy(false)}
  }
  function edit(rule:Rule){setDraft({id:rule.id,date:rule.date,departmentId:rule.departmentId,closed:rule.closed,periods:rule.periods.length?rule.periods:[{start:'09:30',end:'12:30'}],slotMinutes:rule.slotMinutes||30,note:rule.note});setError('');setMessage('');document.getElementById('special-day-editor')?.scrollIntoView({block:'start',behavior:'smooth'})}
  return <div className="special-days">
    <h2>{t('Ерекше күндер')}</h2><p className="hint">{t('Мереке, демалыс немесе қызметкер болмайтын күнді жабыңыз. Қажет болса бір күнге бөлек қабылдау ашыңыз. Уақыттар UTC+5 бойынша.')}</p>
    <p className="notice">{t('Бөлімнің жеке күндік ережесі жалпы ережеден басым. Жабық бөлім арнайы кестемен де ашылмайды. Бұрын берілген талондар автоматты өзгермейді және жойылмайды.')}</p>
    <form id="special-day-editor" className="panel special-day-editor" onSubmit={submit}>
      <h3>{t(draft.id?'Ережені өңдеу':'Ерекше күн қосу')}</h3>
      <fieldset disabled={busy} className="auth-fields">
        <div className="form-row"><label>{t('Күні')}<input type="date" name="exceptionDate" required min={from} max={to} disabled={!!draft.id} value={draft.date} onChange={event=>change('date',event.target.value)}/></label><label>{t('Қолданылатын бөлім')}<select name="exceptionDepartment" disabled={!!draft.id} value={draft.departmentId} onChange={event=>{change('departmentId',event.target.value);change('slotMinutes',departments.find(d=>d.id===event.target.value)?.slotMinutes||30)}}><option value="">{t('Барлық бөлімдерге')}</option>{departments.map(d=><option key={d.id} value={d.id}>{t(d.name)}{!d.active?' · '+t('Жабық'):''}</option>)}</select></label></div>
        <label>{t('Күннің тәртібі')}<select name="exceptionMode" value={draft.closed?'closed':'custom'} onChange={event=>change('closed',event.target.value==='closed')}><option value="closed">{t('Қабылдауды толық жабу')}</option><option value="custom">{t('Арнайы қабылдау уақытын қою')}</option></select></label>
        {!draft.closed&&<>
          <p className="hint">{t('Арнайы уақыт апталық кестені осы күнге толық алмастырады. Сенбі не жексенбіге де қабылдау ашуға болады.')}</p>
          {draft.periods.map((period,index)=><div className="form-row exception-period" key={index}><label>{t('Басталуы')}<input type="time" name={`exceptionStart${index}`} required value={period.start} onChange={event=>change('periods',draft.periods.map((item,n)=>n===index?{...item,start:event.target.value}:item))}/></label><label>{t('Аяқталуы')}<input type="time" name={`exceptionEnd${index}`} required value={period.end} onChange={event=>change('periods',draft.periods.map((item,n)=>n===index?{...item,end:event.target.value}:item))}/></label></div>)}
          <label className="check"><input name="exceptionSecondPeriod" type="checkbox" checked={draft.periods.length===2} onChange={event=>change('periods',event.target.checked?[draft.periods[0],{start:'15:30',end:'18:30'}]:[draft.periods[0]])}/>{t('Екінші уақыт аралығын қосу')}</label>
          <label>{t('Қабылдау ұзақтығы')}<select name="exceptionSlotMinutes" value={draft.slotMinutes} onChange={event=>change('slotMinutes',Number(event.target.value))}>{[15,20,30,60].map(minutes=><option key={minutes} value={minutes}>{minutes} {t('минут')}</option>)}</select></label>
        </>}
        <label>{t('Ішкі себеп / ескерту')}<textarea name="exceptionNote" rows={2} maxLength={500} value={draft.note} onChange={event=>change('note',event.target.value)}/></label><p className="hint">{t('Бұл ескерту азаматтарға көрсетілмейді.')}</p>
        <div className="actions"><button className="primary" disabled={busy}>{t(busy?'Сақталуда…':'Сақтау')}</button>{draft.id&&<button type="button" className="outline" onClick={()=>{setDraft(blank(draft.departmentId));setError('')}}>{t('Болдырмау')}</button>}</div>
      </fieldset>
      {error&&<p className="alert" role="alert">{t(error)}</p>}
      {message&&<p className="notice" role="status">{t(message)}</p>}
      {saved&&saved.count>0&&<div className="notice"><p>{formatReceptionDate(saved.date)} · {t('Жоспарланған қабылдау саны:')} <strong>{saved.count}</strong></p><p>{t('Бұрынғы талондар сақталды. Кесте өзгерісі оларға әсер етсе, азаматтармен байланысыңыз.')}</p><button type="button" className="outline" onClick={()=>onAppointments(saved.date,saved.departmentId)}>{t('Осы күннің жазылуларын көру')}</button></div>}
    </form>
    <section className="exception-list"><div className="exception-list-heading"><h3>{t('Алдағы ерекше күндер')}</h3><button className="outline" disabled={loading||busy} onClick={()=>{setLoading(true);setRetry(value=>value+1)}}>{t('Жаңарту')}</button></div>
      {loading&&<p role="status">{t('Жүктелуде…')}</p>}
      {loadError&&<p className="alert" role="alert">{t(loadError)} <button onClick={()=>{setLoading(true);setRetry(value=>value+1)}}>{t('Қайталау')}</button></p>}
      {!loading&&!loadError&&!rules.length&&<p className="panel empty">{t('Әзірге ерекше күндер жоқ. Апталық кесте қолданылады.')}</p>}
      {rules.map(rule=><article className="panel exception-card" key={rule.id} data-exception-id={rule.id}><div className="exception-card-heading"><div><h3>{formatReceptionDate(rule.date)}</h3><p className="hint">{rule.departmentId?t(departments.find(d=>d.id===rule.departmentId)?.name||rule.departmentId):t('Барлық бөлімдерге')}</p></div><span className={`badge ${rule.closed?'cancelled':'completed'}`}>{t(rule.closed?'Қабылдау жабық':'Арнайы кесте')}</span></div>
        {!rule.closed&&<p className="exception-hours">{rule.periods.map(period=>period.start+'–'+period.end).join(' · ')} · {rule.slotMinutes} {t('минут')}</p>}{rule.note&&<p className="preserve">{rule.note}</p>}
        {rule.scheduledCount>0&&<p className="hint">{t('Жоспарланған қабылдау саны:')} {rule.scheduledCount}</p>}
        <div className="actions"><button type="button" className="outline" disabled={busy} onClick={()=>edit(rule)}>{t('Өңдеу')}</button>{confirmDelete===rule.id?<><span>{t('Күндік ережені өшіру керек пе?')}</span><button className="danger" disabled={busy} onClick={()=>remove(rule)}>{t('Өшіру')}</button><button className="outline" disabled={busy} onClick={()=>setConfirmDelete('')}>{t('Болдырмау')}</button></>:<button className="outline delete-account" disabled={busy} onClick={()=>setConfirmDelete(rule.id)}>{t('Ережені өшіру')}</button>}{rule.scheduledCount>0&&<button className="text-button" disabled={busy} onClick={()=>onAppointments(rule.date,rule.departmentId)}>{t('Осы күннің жазылуларын көру')}</button>}</div>
      </article>)}
    </section>
  </div>
}
