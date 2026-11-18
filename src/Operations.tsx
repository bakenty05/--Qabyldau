import { useEffect, useState } from 'react'
import { api, errorMessage } from './api'
import { t, locale } from './i18n'

type Status={available:boolean;enabled:boolean;healthy:boolean;databaseOk:boolean;checkedAt:number|null;startedAt:number;uptimeSeconds:number;intervalHours:number;retentionDays:number;lastBackup:{file:string;createdAt:number;verified:boolean}|null;lastFailureAt:number|null;lastError:string|null;overdue:boolean;nextBackupAt:number|null;requests:number;serverErrors:number}
const date=(value:number|null|undefined)=>value?new Intl.DateTimeFormat(locale(),{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Qyzylorda'}).format(value):'—'
export default function Operations() {
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{
    const controller=new AbortController()
    const load=()=>api<Status>('/api/admin/operations',undefined,'GET',controller.signal).then(result=>{if(!controller.signal.aborted){setStatus(result);setError('')}}).catch(error=>{if(!controller.signal.aborted)setError(errorMessage(error))})
    void load();const timer=window.setInterval(load,30000)
    return()=>{controller.abort();window.clearInterval(timer)}
  },[])
  async function backup() {
    setBusy(true);setError('');setMessage('')
    try {await api('/api/admin/operations/backup',{});setStatus(await api<Status>('/api/admin/operations'));setMessage('Сақтық көшірме жасалды және тұтастығы тексерілді.')}
    catch(error){setError(errorMessage(error))}finally{setBusy(false)}
  }
  return <section className="panel operations-panel"><h2>{t('Жүйе күйі және сақтық көшірме')}</h2><p className="hint">{t('Күй әр 30 секунд сайын жаңарады. Уақыттар UTC+5 бойынша.')}</p>{error&&<p className="alert" role="alert">{t(error)}</p>}{message&&<p className="notice" role="status">{t(message)}</p>}{!status?<p role="status">{t('Жүктелуде…')}</p>:!status.available?<p className="notice">{t('Сақтық көшірме қызметі іске қосылмаған.')}</p>:<><p className={status.healthy?'notice':'alert'} role="status">{t(status.healthy?'Жүйе қалыпты жұмыс істеп тұр.':'Жүйені тексеру қажет.')}</p>{!status.enabled&&<p className="alert">{t('Автоматты сақтық көшірме өшірілген.')}</p>}{status.lastError&&<p className="alert">{t(status.lastError)}</p>}{status.overdue&&<p className="alert">{t('Сақтық көшірме мерзімі өтіп кетті.')}</p>}<dl className="details"><div><dt>{t('Дерекқор')}</dt><dd>{t(status.databaseOk?'Тұтастығы дұрыс':'Тексеру өтпеді')}</dd></div><div><dt>{t('Соңғы тексеру')}</dt><dd>{date(status.checkedAt)}</dd></div><div><dt>{t('Сервер іске қосылды')}</dt><dd>{date(status.startedAt)}</dd></div><div><dt>{t('Сұраулар / сервер қателері')}</dt><dd>{status.requests} / {status.serverErrors}</dd></div><div><dt>{t('Көшірме аралығы, сағат')}</dt><dd>{status.intervalHours}</dd></div><div><dt>{t('Көшірмелерді сақтау, күн')}</dt><dd>{status.retentionDays}</dd></div><div><dt>{t('Соңғы көшірме')}</dt><dd>{date(status.lastBackup?.createdAt)}<br/><span className="break">{status.lastBackup?.file||'—'}</span></dd></div><div><dt>{t('Келесі көшірме')}</dt><dd>{date(status.nextBackupAt)}</dd></div></dl><button type="button" className="primary" disabled={busy} onClick={()=>void backup()}>{busy?t('Көшірме жасалуда…'):t('Қазір сақтық көшірме жасау')}</button><p className="hint">{t('Автоматты көшірме сервер қосулы кезде жасалады. Көшірмелерді бөлек қорғалған дискіде де сақтаңыз. Қалпына келтіру жаңа файлға орындалады.')}</p></>}</section>
}
