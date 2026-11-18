import { useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage } from './api'
import { t, locale } from './i18n'

type StaffUser = {id:string;username:string;fullName:string;role:string;status:string}
type Recovery = {id:string;username:string;fullName:string;role:string;requestedAt:number}
const changedMessage='Құпиясөз сақталды. Барлық құрылғыдағы сессиялар жабылды. Қайта кіріңіз.'

export function RecoveryRequest({onBack}:{onBack:()=>void}) {
  const [username,setUsername]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');setMessage('')
    try {const result=await api<{message:string}>('/api/auth/recovery',{username});setMessage(result.message)}
    catch(error){setError(errorMessage(error))}finally{setBusy(false)}
  }
  return <><h2 id="auth-title">{t('Құпиясөзді қалпына келтіру')}</h2><p>{t('Логиніңізді жазыңыз. Ұйым әкімшісі жеке басыңызды тексеріп, бір реттік сілтеме береді.')}</p><form className="recovery-request" onSubmit={submit}><label>{t('Логин')}<input name="recoveryUsername" required minLength={3} maxLength={40} autoComplete="username" value={username} onChange={event=>setUsername(event.target.value)}/></label><button className="primary wide" disabled={busy}>{busy?t('Күтіңіз…'):t('Сұрау жіберу')}</button></form>{error&&<p role="alert" className="alert">{t(error)}</p>}{message&&<p role="status" className="notice">{t(message)}</p>}<p className="hint">{t('Әкімші аккаунты үшін серверге жауапты маманға хабарласыңыз.')}</p><button className="text-button" disabled={busy} onClick={onBack}>{t('Кіруге оралу')}</button></>
}

function NewPasswordFields() {
  return <><label>{t('Жаңа құпиясөз')}<input type="password" name="newPassword" required minLength={15} maxLength={128} autoComplete="new-password"/></label><label>{t('Жаңа құпиясөзді қайталаңыз')}<input type="password" name="confirmPassword" required minLength={15} maxLength={128} autoComplete="new-password"/></label><p className="hint">{t('Кемінде 15 таңба. Жаңа құпиясөз бұрынғысынан өзгеше болуы керек.')}</p></>
}
function passwordFrom(form:HTMLFormElement) {
  const data=new FormData(form), password=String(data.get('newPassword'))
  if(password!==data.get('confirmPassword')) throw new Error('Құпиясөздер бірдей емес.')
  return password
}

export function PasswordReset({token,onDone}:{token:string;onDone:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false)
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setError('');setBusy(true)
    const form=event.currentTarget
    try {const newPassword=passwordFrom(form);await api('/api/auth/reset-password',{token,newPassword});form.reset();setDone(true)}
    catch(error){setError(errorMessage(error))}finally{setBusy(false)}
  }
  return <><h2 id="reset-title">{t('Жаңа құпиясөз орнату')}</h2>{done?<><p role="status" className="notice">{t(changedMessage)}</p><button className="primary" onClick={onDone}>{t('Кіру')}</button></>:<><p className="hint">{t('Сілтеме 30 минут жарамды және бір рет қолданылады.')}</p><form className="password-reset" onSubmit={submit}><fieldset disabled={busy} className="auth-fields"><NewPasswordFields/><button className="primary wide">{busy?t('Сақталуда…'):t('Құпиясөзді сақтау')}</button></fieldset></form>{error&&<p className="alert" role="alert">{t(error)}</p>}</>}</>
}

export default function Security({admin,users,onChanged}:{admin:boolean;users:StaffUser[];onChanged:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('')
    const form=event.currentTarget
    try {const newPassword=passwordFrom(form);await api('/api/auth/password',{currentPassword:new FormData(form).get('currentPassword'),newPassword});form.reset();onChanged()}
    catch(error){setError(errorMessage(error))}finally{setBusy(false)}
  }
  return <div className="security-panel"><form className="panel narrow password-change" onSubmit={submit}><h2>{t('Құпиясөзді ауыстыру')}</h2><p>{t('Құпиясөз өзгергенде барлық құрылғыдағы ашық сессиялар жабылады.')}</p><fieldset disabled={busy} className="auth-fields"><label>{t('Ағымдағы құпиясөз')}<input type="password" name="currentPassword" required maxLength={128} autoComplete="current-password"/></label><NewPasswordFields/><button className="primary">{busy?t('Сақталуда…'):t('Құпиясөзді сақтау')}</button></fieldset>{error&&<p role="alert" className="alert">{t(error)}</p>}</form>{admin&&<RecoveryAdmin users={users}/>}</div>
}

function RecoveryAdmin({users}:{users:StaffUser[]}) {
  const [requests,setRequests]=useState<Recovery[]>([]),[userId,setUserId]=useState(''),[password,setPassword]=useState(''),[link,setLink]=useState(''),[expiresAt,setExpiresAt]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false)
  useEffect(()=>{
    const controller=new AbortController()
    const load=()=>api<{requests:Recovery[]}>('/api/admin/recovery',undefined,'GET',controller.signal).then(result=>{if(!controller.signal.aborted)setRequests(result.requests)}).catch(error=>{if(!controller.signal.aborted)setError(errorMessage(error))})
    void load();const timer=window.setInterval(load,30000)
    return()=>{controller.abort();window.clearInterval(timer)}
  },[])
  async function issue(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');setLink('');setCopied(false)
    try {
      const result=await api<{token:string;expiresAt:number}>(`/api/admin/users/${userId}/reset-password`,{currentPassword:password})
      setLink(`${window.location.origin}/#reset=${result.token}`);setExpiresAt(result.expiresAt);setPassword('');setRequests(items=>items.filter(item=>item.id!==userId))
    }catch(error){setError(errorMessage(error))}finally{setBusy(false)}
  }
  return <section className="panel recovery-admin"><h2>{t('Қызметкерге кіруді қалпына келтіру')}</h2><p>{t('Алдымен қызметкердің жеке басын тексеріңіз. Сілтемені тек сол адамға жеке беріңіз. Қайта берілген сілтеме алдыңғысын жарамсыз етеді.')}</p><h3>{t('Қалпына келтіру сұраулары')}</h3>{requests.length?<ul className="recovery-list">{requests.map(item=><li key={item.id}><strong>{item.fullName}</strong> · {item.username}<br/><time>{new Intl.DateTimeFormat(locale(),{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Qyzylorda'}).format(item.requestedAt)}</time>{item.role==='admin'?<p className="hint">{t('Әкімші аккаунты үшін серверге жауапты маманға хабарласыңыз.')}</p>:<button type="button" className="text-button" onClick={()=>{setUserId(item.id);setLink('')}}>{t('Қызметкерді таңдау')}</button>}</li>)}</ul>:<p className="hint">{t('Қалпына келтіру сұрауы жоқ.')}</p>}<form className="reset-issue" onSubmit={issue}><fieldset disabled={busy} className="auth-fields"><label>{t('Қызметкер')}<select required name="resetUser" value={userId} onChange={event=>{setUserId(event.target.value);setLink('')}}><option value="">{t('Қызметкерді таңдаңыз')}</option>{users.filter(user=>user.role!=='admin'&&user.status==='active').map(user=><option key={user.id} value={user.id}>{user.fullName} · {user.username}</option>)}</select></label><label>{t('Әкімшінің ағымдағы құпиясөзі')}<input type="password" name="adminPassword" required maxLength={128} autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/></label><button className="primary">{busy?t('Күтіңіз…'):t('Бір реттік сілтеме жасау')}</button></fieldset></form>{error&&<p role="alert" className="alert">{t(error)}</p>}{link&&<div className="notice" role="status"><label>{t('Жеке қалпына келтіру сілтемесі')}<textarea className="reset-link" readOnly value={link} onFocus={event=>event.target.select()} rows={3}/></label><p>{t('Жарамдылық мерзімі · UTC+5')}: {new Intl.DateTimeFormat(locale(),{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Qyzylorda'}).format(expiresAt)}</p><button type="button" className="outline" onClick={async()=>{try{await navigator.clipboard.writeText(link);setCopied(true)}catch{setError('Сілтемені белгілеп, қолмен көшіріңіз.')}}}>{t(copied?'Көшірілді':'Сілтемені көшіру')}</button></div>}</section>
}
