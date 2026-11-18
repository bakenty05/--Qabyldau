import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import ReceptionCalendar from './ReceptionCalendar'
import PhoneInput from './PhoneInput'
import TicketCard from './TicketCard'
import TicketLookup from './TicketLookup'
import { statuses } from './ticket-receipt'
import { addDays, formatReceptionDate, isReceptionDate } from './reception-calendar'
import { api, errorMessage } from './api'
import bookingIllustration from './assets/booking-calendar.webp'
import Statistics from './Statistics'
import SpecialDays from './SpecialDays'
import { useScheduleExceptions } from './use-schedule-exceptions'
import { t, locale, getLanguage } from './i18n'
import { useLanguage } from './use-language'
import LanguageSwitch from './LanguageSwitch'
import Security, { RecoveryRequest, PasswordReset } from './Security'
import Operations from './Operations'
import PrivacyEditor, { PrivacyPage, type Policy } from './Privacy'
import StaffSidebar from './StaffSidebar'

type Department = { id: string; name: string; description: string; active: boolean; weekdays: number[]; startTime: string; endTime: string; breakStart: string; breakEnd: string; slotMinutes: number }
type User = { id: string; fullName: string; username: string; role: 'admin' | 'staff'; status: string; departmentIds: string[] }
type Appointment = { id: string; number: string; departmentId: string; departmentName: string; fullName: string; phone: string; issue: string; date: string; time: string; status: string; note: string; createdAt: number }
type Ticket = { appointment: Appointment; accessToken: string }
type Settings = { organization: string; address: string; phone: string; privacyText: string; privacyTextRu?:string; privacyVersion?:string; privacyApproved?:boolean }
const emptySettings: Settings = { organization: '', address: '', phone: '', privacyText: '' }
const weekdays = ['Жс','Дс','Сс','Ср','Бс','Жм','Сб']
const dateLabel = formatReceptionDate
function today() { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qyzylorda',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}` }
function download(name: string, content: string, type: string) {
  const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
function Icon({name}:{name:string}) {
  const paths:Record<string,ReactNode>={building:<><path d="M3 10 12 4l9 6M4 21h16M6 11v7m6-7v7m6-7v7"/><path d="M3 10h18"/></>,calendar:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h2m4 0h2"/></>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>}
  return <svg className="icon" viewBox="0 0 24 24" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export default function App() {
  useLanguage()
  const [route,setPage]=useState(()=>window.location.hash.slice(1)||'home')
  const [ticketVisit,setTicketVisit]=useState(0)
  const page = route.split('?')[0]
  const [user,setUser]=useState<User|null>(null),[authOpen,setAuthOpen]=useState(()=>window.location.hash.startsWith('#setup='))
  const [departments,setDepartments]=useState<Department[]>([]),[settings,setSettings]=useState<Settings>(emptySettings),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const [bootstrapToken,setBootstrapToken]=useState(()=>window.location.hash.startsWith('#setup=')?window.location.hash.slice(7):'')
  const [resetToken,setResetToken]=useState(()=>window.location.hash.startsWith('#reset=')?window.location.hash.slice(7):'')
  const [authNotice,setAuthNotice]=useState('')
  const loadPublic=useCallback(async(signal?:AbortSignal)=>{
    const [d,s,u]=await Promise.all([api<{departments:Department[]}>('/api/departments',undefined,'GET',signal),api<{settings:Settings}>('/api/settings',undefined,'GET',signal),api<{user:User|null}>('/api/auth/session',undefined,'GET',signal)])
    if(signal?.aborted)return
    setDepartments(d.departments);setSettings({...emptySettings,...s.settings});setUser(u.user)
  },[])
  useEffect(()=>{
    const controller=new AbortController()
    Promise.resolve().then(()=>loadPublic(controller.signal)).catch(e=>{if(!controller.signal.aborted)setError(errorMessage(e))}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    function change(){
      const route=window.location.hash.slice(1)
      if(route.split('?')[0]==='ticket')setTicketVisit(value=>value+1)
      if(route.startsWith('reset=')){
        setResetToken(route.slice(6));setAuthOpen(false);setPage('home');window.history.replaceState(null,'','#home')
      }else if(route.startsWith('setup=')){
        setBootstrapToken(route.slice(6));setAuthOpen(true);setPage('home')
        window.history.replaceState(null,'','#home')
      }else setPage(route||'home')
      window.scrollTo(0,0)
    }
    function expired(){setUser(null)}
    window.addEventListener('hashchange',change);window.addEventListener('session-expired',expired)
    if(window.location.hash.startsWith('#setup=')||window.location.hash.startsWith('#reset=')) window.history.replaceState(null,'','#home')
    return()=>{controller.abort();window.removeEventListener('hashchange',change);window.removeEventListener('session-expired',expired)}
  },[loadPublic])
  useEffect(()=>{
    if(page==='booking'){
      document.getElementById('booking')?.scrollIntoView({block:'start',behavior:'instant'})
      document.getElementById('department')?.focus({preventScroll:true})
    }
  },[page,loading])
  async function logout(){try{await api('/api/auth/logout',{});setUser(null);window.location.hash='home'}catch(e){setError(errorMessage(e))}}
  async function retryPublic(){setLoading(true);setError('');try{await loadPublic()}catch(e){setError(errorMessage(e))}finally{setLoading(false)}}
  return <>
    <a className="skip-link" href="#main" onClick={event=>{event.preventDefault();document.getElementById('main')?.focus();document.getElementById('main')?.scrollIntoView()}}>{t("Негізгі мазмұнға өту")}</a>
    <header><div className="container header"><a href="#home" className="brand"><Icon name="building"/>{t("Е-Qabyldau")}</a><nav aria-label={t("Негізгі мәзір")}><a href="#home" aria-current={page==='home'?'page':undefined}>{t("Басты бет")}</a><a href="#booking" aria-current={page==='booking'?'page':undefined}>{t("Онлайн өтінім")}</a><a href="#how-to" aria-current={page==='how-to'?'page':undefined}>{t("Қалай жазыламын?")}</a><a href="#ticket" aria-current={page==='ticket'?'page':undefined}>{t("Талоным")}</a><a href="#contact" aria-current={page==='contact'?'page':undefined}>{t("Байланыс")}</a></nav><div className="header-actions"><LanguageSwitch/><button className="outline" onClick={()=>user?window.location.hash='staff':setAuthOpen(true)}>{user?t('Кабинет'):t('Кіру')}</button></div></div></header>
    {error&&<div role="alert" className="container alert">{t(error)}<button disabled={loading} onClick={retryPublic}>{t("Қайталау")}</button></div>}
    <main id="main" tabIndex={-1}>
      {page==='staff'?user?<Staff user={user} settings={settings} onSettings={s=>{setSettings(s);loadPublic().catch(e=>setError(errorMessage(e)))}} onLogout={logout} onPublicChanged={loadPublic} onPasswordChanged={()=>{setUser(null);setAuthNotice('Құпиясөз сақталды. Барлық құрылғыдағы сессиялар жабылды. Қайта кіріңіз.');setAuthOpen(true);window.location.hash='home'}}/>:<section className="container interior"><h1>{t("Қызметкер кабинеті")}</h1><p>{t("Кабинетке кіру үшін әкімші растаған аккаунт қажет.")}</p><button className="primary" onClick={()=>setAuthOpen(true)}>{t("Кіру / Тіркелу")}</button></section>
      :page==='how-to'?<section className="container interior narrow"><span className="eyebrow">{t("ҚАДАМДЫҚ НҰСҚАУЛЫҚ")}</span><h1>{t("Қабылдауға қалай жазыламын?")}</h1>{[[t('Бөлімді таңдаңыз'),t('Мәселеңізге жауапты бөлімді таңдап, аты-жөніңіз бен телефон нөміріңізді жазыңыз.')],[t('Күн мен уақытты белгілеңіз'),t('Кестедегі бос уақыттардың бірін таңдаңыз. Уақыттар Қызылорда уақытымен (UTC+5) көрсетіледі.')],[t('Мәліметтерді растаңыз'),t('Деректерді өңдеу шарттарымен танысып, жазылуды растаңыз.')],[t('Талонды сақтаңыз'),t('QR коды бар талонды жүктеп алыңыз. «Талоным» бөлімінде телефон нөмірі мен 6 таңбалы код арқылы тексеріңіз немесе QR кодты сканерлеңіз.')]].map(([title,description],i)=><article className="guide" key={title}><span>{String(i+1).padStart(2,'0')}</span><div><h2>{title}</h2><p>{description}</p></div></article>)}<p className="notice">{t("Қабылдауға 10 минут бұрын келіңіз. Талон мен кодты басқа адамға бермеңіз.")}</p><a href="#home" className="primary">{t("Қабылдауға жазылу →")}</a></section>
      :page==='privacy'?<PrivacyPage/>:page==='contact'?<section className="container interior narrow"><span className="eyebrow">{t("БАЙЛАНЫС")}</span><h1>{settings.organization||t('Әкімдікпен байланыс')}</h1><div className="panel"><h2>{t("Қабылдау орны")}</h2><p>{settings.address||t('Қабылдау мекенжайын ұйымнан нақтылаңыз.')}</p>{settings.phone&&<p>{t("Телефон: ")}{settings.phone}</p>}</div><h2>{t("Дербес деректерді өңдеу")}</h2><a className="inline-link" href="#privacy">{t("Дербес деректерді өңдеу шарттары")}</a><p className="preserve">{(settings.privacyText&&t(settings.privacyText))||t('Аты-жөніңіз, телефон нөміріңіз және мәселеңіз қабылдауға жазылуды ұйымдастыру үшін сақталады. Жазбаны тиісті бөлімнің рұқсаты бар қызметкерлері өңдейді.')}</p></section>
      :page==='ticket'?<section className="container interior narrow"><span className="eyebrow">{t("ЖАЗЫЛУДЫ БАСҚАРУ")}</span><h1>{t("Талоным")}</h1><TicketLookup key={route+':'+ticketVisit} address={settings.address}/></section>
      :<section className="home"><div className="container"><div className="home-grid"><div className="hero"><span className="eyebrow">{settings.organization||t('ЭЛЕКТРОНДЫ ҚАБЫЛДАУ')}</span><h1>{t("Әкімдік қабылдауына")}<br/>{t("онлайн жазылыңыз")}</h1><p>{t("Қажетті бөлімді, өзіңізге ыңғайлы күн мен уақытты таңдаңыз.")}</p><a href="#booking" className="primary hero-button">{t("Қабылдауға жазылу ")}<span>→</span></a><div className="benefits"><span><Icon name="calendar"/>{t("Ыңғайлы күн")}</span><span><Icon name="clock"/>{t("Кезексіз жазылу")}</span></div><img src={bookingIllustration} width="512" height="512" decoding="async" fetchPriority="high" alt={t("Қабылдау күнтізбесі мен талон")}/></div><Booking departments={departments} settings={settings} loading={loading}/></div><ol className="steps"><li><span>01</span><div><h3>{t("Өтінімді толтырыңыз")}</h3><p>{t("Бөлімді және мәселені көрсетіңіз")}</p></div></li><li><span>02</span><div><h3>{t("Уақытты таңдаңыз")}</h3><p>{t("Бөлімнің бос кестесінен")}</p></div></li><li><span>03</span><div><h3>{t("Талон алыңыз")}</h3><p>{t("Сақтап, қабылдауға келіңіз")}</p></div></li></ol></div></section>}
    </main><footer className="container"><a href="#home" className="brand">{t("Е-Qabyldau")}</a><p>{t("Әкімдік қабылдауына онлайн жазылу")}</p><a href="#contact">{t("Байланыс және деректерді өңдеу")}</a></footer>
    {resetToken&&<Modal label="reset-title" onClose={()=>setResetToken('')}><PasswordReset token={resetToken} onDone={()=>{setResetToken('');setUser(null);setAuthOpen(true);setAuthNotice('')}}/></Modal>}
    {authOpen&&!resetToken&&<Auth notice={authNotice} bootstrapToken={bootstrapToken} onRegistered={()=>setBootstrapToken('')} onClose={()=>setAuthOpen(false)} onLogin={u=>{setUser(u);setAuthOpen(false);window.location.hash='staff'}}/>}
  </>
}

function Booking({departments,settings,loading}:{departments:Department[];settings:Settings;loading:boolean}) {
  const [form,setForm]=useState({departmentId:'',fullName:'',phone:'+7',issue:'',date:'',time:'',consent:false})
  const [slots,setSlots]=useState<string[]>([]),[slotLoading,setSlotLoading]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[review,setReview]=useState(false),[ticket,setTicket]=useState<Ticket|null>(null)
  const [slotError,setSlotError]=useState(''),[slotRetry,setSlotRetry]=useState(0)
  const [bookingPolicy,setBookingPolicy]=useState<Policy|null>(null)
  const selectedDepartment=departments.find(d=>d.id===form.departmentId)
  const schedule=useScheduleExceptions(form.departmentId,today())
  const selectedDateException=schedule.exceptions.find(item=>item.date===form.date)
  useEffect(()=>{
    if(!form.departmentId||!form.date||!schedule.ready)return
    const controller=new AbortController()
    api<{slots:string[]}>(`/api/availability?departmentId=${encodeURIComponent(form.departmentId)}&date=${form.date}`,undefined,'GET',controller.signal).then(r=>{if(!controller.signal.aborted){setSlots(r.slots);setForm(current=>!current.time||r.slots.includes(current.time)?current:{...current,time:''});setSlotError('');setSlotLoading(false)}}).catch(e=>{if(!controller.signal.aborted){setSlotError(errorMessage(e));setSlotLoading(false)}})
    return()=>controller.abort()
  },[form.departmentId,form.date,slotRetry,schedule.ready,schedule.exceptions])
  function field(key:string,value:string|boolean){setError('');setForm(f=>({...f,[key]:value,...(key==='departmentId'?{date:'',time:''}:key==='date'?{time:''}:{})}));if(key==='date'||key==='departmentId'){setSlotError('');setSlots([]);setSlotLoading(key==='date'&&!!value&&!!form.departmentId)}}
  function validate(e:FormEvent){e.preventDefault();if(form.fullName.trim().length<3||form.fullName.trim().split(/\s+/).length<2){setError(t('Атыңыз бен тегіңізді толық енгізіңіз.'));return}if(!/^\+7\d{10}$/.test(form.phone.replace(/[\s()-]/g,''))){setError(t('Телефон нөмірі: +7 және 10 сан.'));return}if(form.issue.trim().length<10){setError(t('Мәселені кемінде 10 таңбамен сипаттаңыз. Бос орындар есептелмейді.'));return}if(!selectedDepartment||!isReceptionDate(form.date,today(),addDays(today(),90),selectedDepartment.weekdays,schedule.exceptions)){setError(t('Қабылдауға қолжетімді күнді таңдаңыз.'));return}if(!slots.includes(form.time)){setError(t('Бос уақытты таңдаңыз.'));return}setReview(true)}
  async function confirm(){
    setBusy(true);setError('')
    try {
      const latest=await api<{policy:Policy}>('/api/privacy')
      if(settings.privacyVersion&&latest.policy.version!==(bookingPolicy?.version||settings.privacyVersion)){
        setBookingPolicy(latest.policy);setForm(current=>({...current,consent:false}));setReview(false)
        setError('Деректерді өңдеу шарттары жаңарды. Шарттарды қайта оқып, келісімді растаңыз.');return
      }
      const result=await api<Ticket>('/api/appointments',{...form,consentVersion:bookingPolicy?.version||settings.privacyVersion,consentLanguage:getLanguage(),fullName:form.fullName.trim(),issue:form.issue.trim(),phone:form.phone.replace(/[\s()-]/g,'')})
      setTicket(result)
    }catch(error){
      const message=errorMessage(error)
      setError(message);setReview(false)
      if(message==='Деректерді өңдеу шарттары жаңарды. Шарттарды қайта оқып, келісімді растаңыз.'){
        setForm(current=>({...current,consent:false}))
        try{const latest=await api<{policy:Policy}>('/api/privacy');setBookingPolicy(latest.policy)}catch{/* Retry still checks the current version. */}
      }else if(form.departmentId&&form.date){
        try{const result=await api<{slots:string[]}>(`/api/availability?departmentId=${form.departmentId}&date=${form.date}`);setSlots(result.slots);setForm(current=>({...current,time:''}))}catch{/* Main error remains visible. */}
      }
    }finally{setBusy(false)}
  }
  return <section className="booking panel" id="booking" aria-labelledby="booking-title">
    {ticket?<><TicketCard ticket={ticket} address={settings.address}/><button className="text-button" onClick={()=>{setTicket(null);setReview(false);setForm({...form,fullName:'',phone:'+7',issue:'',date:'',time:'',consent:false})}}>{t("Жаңа жазылу")}</button></>:<><span className="eyebrow">{review?t('РАСТАУ АЛДЫНДА'):t('ҚАБЫЛДАУҒА ЖАЗЫЛУ')}</span><h2 id="booking-title">{review?t('Мәліметтерді тексеріңіз'):t('Онлайн өтінім')}</h2><p className="hint">{t("Өтінімді тіркелмей және аккаунтқа кірмей толтыра аласыз.")}</p>{loading&&<p role="status">{t("Кесте жүктелуде…")}</p>}{!loading&&!departments.length&&<p className="notice">{t("Қазіргі уақытта бөлімдердің қабылдау кестесі жабық.")}</p>}{review?<><dl className="details">{[[t('Бөлім'),t(departments.find(d=>d.id===form.departmentId)?.name||'')],[t('Аты-жөні'),form.fullName],[t('Телефон'),form.phone],[t('Күні'),dateLabel(form.date)],[t('Уақыты'),form.time+' · UTC+5'],[t('Мәселе'),form.issue]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><button className="primary wide" disabled={busy} onClick={confirm}>{busy?t('Сақталуда…'):t('Растау және талон алу')}</button><button disabled={busy} className="text-button" onClick={()=>setReview(false)}>{t("Мәліметтерді өзгерту")}</button></>:<form onSubmit={validate}>
      <label>{t("Бөлім")}<select id="department" required disabled={loading||!departments.length} value={form.departmentId} onChange={e=>field('departmentId',e.target.value)}><option value="">{t("Бөлімді таңдаңыз")}</option>{departments.map(d=><option key={d.id} value={d.id}>{t(d.name)}</option>)}</select></label>
      {selectedDepartment&&<><p className="hint">{t(selectedDepartment.description)}</p><p className="schedule-note">{t("Қабылдау: ")}{selectedDepartment.startTime}–{selectedDepartment.breakStart}{t(" және ")}{selectedDepartment.breakEnd}–{selectedDepartment.endTime}.<br/>{t('Бұл апталық кесте. Ерекше күндердің уақытын күнтізбеден тексеріңіз.')}</p></>}
      <label>{t("Аты-жөні")}<input autoComplete="name" required minLength={3} maxLength={120} placeholder={t("Атыңыз бен тегіңіз")} value={form.fullName} onChange={e=>field('fullName',e.target.value)}/></label>
      <PhoneInput value={form.phone} onChange={phone=>field('phone',phone)}/>
      <label>{t("Қандай мәселе бойынша?")}<textarea required minLength={10} maxLength={2000} rows={3} placeholder={t("Мәселеңізді қысқаша сипаттаңыз")} value={form.issue} onChange={e=>field('issue',e.target.value)}/></label>
      {selectedDepartment&&!schedule.ready&&!schedule.error&&<p className="exception-loading" role="status">{t('Ерекше күндер тексерілуде…')}</p>}
      {schedule.error&&<p className="alert" role="alert">{t(schedule.error)}<button type="button" onClick={schedule.refresh}>{t('Қайталау')}</button></p>}
      {selectedDateException&&<p className="schedule-note">{selectedDateException.closed?t('Қабылдау жабық'):t('Осы күннің арнайы кестесі:')+' '+selectedDateException.periods.map(period=>period.start+'–'+period.end).join(' · ')+' · '+selectedDateException.slotMinutes+' '+t('минут')}</p>}
      <ReceptionCalendar key={form.departmentId} min={today()} value={form.date} onChange={date=>field('date',date)} disabled={!selectedDepartment||!schedule.ready} weekdays={selectedDepartment?.weekdays||[1,2,3,4,5]} exceptions={schedule.exceptions} onOpen={schedule.refresh}/>
      {slotError&&<p className="alert" role="alert">{t(slotError)}<button type="button" disabled={slotLoading} onClick={()=>{setSlotLoading(true);setSlotRetry(n=>n+1)}}>{t("Уақыттарды қайта жүктеу")}</button></p>}
      <label>{form.departmentId==='mayor-reception'?t('Әкімнің қабылдау уақыты'):t('Қабылдау уақыты')}<select required disabled={!form.date||slotLoading} value={form.time} onChange={e=>field('time',e.target.value)}><option value="">{slotLoading&&form.date?t('Жүктелуде…'):form.date&&!slots.length?t('Бос уақыт жоқ'):t('Уақытты таңдаңыз')}</option>{slots.map(t=><option key={t}>{t}</option>)}</select></label>
      <p className="hint">{t("Қызылорда уақыты (UTC+5). Жазылу алдағы 90 күнге ашылады.")}</p>
      <label className="check"><input type="checkbox" required checked={form.consent} onChange={e=>field('consent',e.target.checked)}/><span><a href="#privacy" target="_blank" rel="noreferrer">{t("Дербес деректерді өңдеу шарттарымен")}</a>{t(" таныстым және келісемін.")}</span></label>
      <button className="primary wide" disabled={loading||!departments.length}>{t("Жазылу →")}</button>
    </form>}</>}{error&&<p className="alert" role="alert">{t(error)}</p>}
  </section>
}

function Auth({bootstrapToken,onRegistered,onClose,onLogin,notice=''}:{notice?:string;bootstrapToken:string;onRegistered:()=>void;onClose:()=>void;onLogin:(u:User)=>void}) {
  const [register,setRegister]=useState(!!bootstrapToken),[error,setError]=useState(''),[message,setMessage]=useState(notice),[busy,setBusy]=useState(false)
  const [forgot,setForgot]=useState(false)
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');setMessage('');const f=new FormData(e.currentTarget);try{if(register){const r=await api<{message:string}>('/api/auth/register',{fullName:f.get('fullName'),username:f.get('username'),password:f.get('password'),governmentEmployee:f.get('governmentEmployee')==='on',bootstrapToken});setMessage(r.message);setRegister(false);onRegistered()}else{const r=await api<{user:User}>('/api/auth/login',{username:f.get('username'),password:f.get('password')});onLogin(r.user)}}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
  if(forgot)return <Modal label="auth-title" onClose={onClose}><RecoveryRequest onBack={()=>setForgot(false)}/></Modal>
  return <Modal label="auth-title" onClose={onClose} busy={busy}><span className="eyebrow">{t("ҚЫЗМЕТКЕР КАБИНЕТІ")}</span><h2 id="auth-title">{register?(bootstrapToken?t('Әкімші тіркелуі'):t('Тіркелу')):t('Кіру')}</h2><form onSubmit={submit}><fieldset className="auth-fields" disabled={busy}>{register&&<label>{t("Аты-жөні")}<input name="fullName" required minLength={3} maxLength={120} autoComplete="name"/></label>}<label>{t("Логин")}<input autoFocus name="username" required minLength={3} maxLength={40} pattern="[a-zA-Z0-9._\-]+" autoComplete="username"/></label><label>{t("Құпиясөз")}<input type="password" name="password" required minLength={register?15:1} maxLength={128} autoComplete={register?'new-password':'current-password'}/></label>{register&&<><p className="hint">{t("Кемінде 15 таңба. Логинге латын әріптері мен сандарды қолданыңыз.")}</p><label className="check"><input type="checkbox" name="governmentEmployee" required/>{t("Мемлекеттік қызметкермін")}</label></>}<button className="primary wide" disabled={busy}>{busy?t('Күтіңіз…'):register?t('Аккаунт ашу'):t('Кіру')}</button></fieldset></form>{error&&<p role="alert" className="alert">{t(error)}</p>}{message&&<p role="status" className="notice">{t(message)}</p>}<button className="text-button" disabled={busy} onClick={()=>{setRegister(!register);setError('');setMessage('')}}>{register?t('Аккаунт бар · Кіру'):t('Жаңа қызметкер · Тіркелу')}</button>{!register&&<button className="text-button forgot-password" disabled={busy} onClick={()=>setForgot(true)}>{t('Құпиясөзді ұмыттыңыз ба?')}</button>}</Modal>
}

function Modal({label,onClose,children,busy=false}:{label:string;onClose:()=>void;children:ReactNode;busy?:boolean}) {
  const ref=useRef<HTMLDialogElement>(null)
  useEffect(()=>{const dialog=ref.current!;dialog.showModal();return()=>dialog.close()},[])
  return <dialog ref={ref} className="panel modal" aria-labelledby={label} onCancel={e=>{e.preventDefault();if(!busy)onClose()}}><button disabled={busy} className="close" aria-label={t("Жабу")} onClick={onClose}>×</button><div className="modal-language"><LanguageSwitch/></div>{children}</dialog>
}

function Staff({user,settings,onSettings,onLogout,onPublicChanged,onPasswordChanged}:{onPasswordChanged:()=>void;user:User;settings:Settings;onSettings:(s:Settings)=>void;onLogout:()=>void;onPublicChanged:()=>Promise<void>}) {
  const [tab,setTab]=useState('appointments'),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [departments,setDepartments]=useState<Department[]>([]),[users,setUsers]=useState<User[]>([]),[appointments,setAppointments]=useState<Appointment[]>([]),[events,setEvents]=useState<{id:number;actor_name:string;action:string;target_id:string;created_at:number}[]>([])
  const [filter,setFilter]=useState({date:today(),departmentId:'',status:''})
  const [edit,setEdit]=useState<Appointment|null>(null)
  const [refreshing,setRefreshing]=useState(true),[loadedFilter,setLoadedFilter]=useState<typeof filter|null>(null)
  const [newDepartmentVersion,setNewDepartmentVersion]=useState(0)
  const listReady=loadedFilter===filter&&!refreshing
  const visibleAppointments=listReady?appointments:[]
  const refreshVersion=useRef(0)
  const invalidateRefresh=useCallback(()=>{++refreshVersion.current},[])
  const refresh=useCallback(async()=>{
    const version=++refreshVersion.current
    const query=new URLSearchParams(Object.entries(filter).filter(([,v])=>v))
    setRefreshing(true)
    try {
    const [d,a,u,e]=await Promise.all([
      api<{departments:Department[]}>('/api/staff/departments'),
      api<{appointments:Appointment[]}>(`/api/staff/appointments?${query}`),
      user.role==='admin'?api<{users:User[]}>('/api/admin/users'):Promise.resolve(null),
      user.role==='admin'?api<{events:typeof events}>('/api/admin/audit'):Promise.resolve(null),
    ])
    if(version!==refreshVersion.current)return
    setDepartments(d.departments);setAppointments(a.appointments);setLoadedFilter(filter)
    if(u&&e){setUsers(u.users);setEvents(e.events)}
    setError('')
    } catch(error) {
      if(version===refreshVersion.current)throw error
    } finally {
      if(version===refreshVersion.current)setRefreshing(false)
    }
  },[filter,user.role])
  useEffect(()=>{let live=true;const timer=window.setInterval(()=>refresh().catch(e=>{if(live)setError(errorMessage(e))}),60000);Promise.resolve().then(()=>{if(live)return refresh()}).catch(e=>{if(live)setError(errorMessage(e))});return()=>{live=false;invalidateRefresh();window.clearInterval(timer)}},[refresh,invalidateRefresh])
  async function action(work:()=>Promise<unknown>,success:string){setBusy(true);setError('');setMessage('');try{await work();await refresh();await onPublicChanged();setMessage(success)}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
  function csv(){const fields=[t('Талон'),t('Бөлім'),t('Аты-жөні'),t('Телефон'),t('Күні'),t('Уақыты'),t('Мәртебе'),t('Мәселе')];const cell=(v:string)=>'"'+(/^[=+@\-\t\r]/.test(v)?"'":'')+v.replaceAll('"','""')+'"';download('qabyldau.csv','\uFEFF'+[fields,...appointments.map(a=>[a.number,a.departmentName,a.fullName,a.phone,a.date,a.time,t(statuses[a.status]),a.issue])].map(row=>row.map(cell).join(';')).join('\r\n'),'text/csv;charset=utf-8')}
  const shownDepartments=user.role==='admin'?departments:departments.filter(d=>user.departmentIds.includes(d.id))
  const sections=[
    {id:'appointments',label:'Қабылдаулар'},
    ...(user.role==='admin'?[
      {id:'departments',label:'Бөлімдер мен кестелер'},
      {id:'users',label:'Қызметкерлер'},
      {id:'settings',label:'Ұйым баптаулары'},
      {id:'audit',label:'Әрекеттер журналы'},
      {id:'statistics',label:'Статистика'},
      {id:'special-days',label:'Ерекше күндер'},
      {id:'operations',label:'Жүйе күйі'},
      {id:'privacy',label:'Деректер шарттары'},
    ]:[]),
    {id:'security',label:'Қауіпсіздік'},
  ]
  return <section className="container interior staff staff-shell"><StaffSidebar sections={sections} active={tab} onSelect={id=>{setTab(id);setMessage('');setError('')}}/><div className="staff-workspace"><div className="staff-heading"><div><span className="eyebrow">{t(user.role==='admin'?'ӘКІМШІ КАБИНЕТІ':'ҚЫЗМЕТКЕР КАБИНЕТІ')}</span><h1>{user.fullName}</h1></div><button className="outline" onClick={onLogout}>{t("Шығу")}</button></div>{error&&<p role="alert" className="alert">{t(error)}</p>}{message&&<p role="status" className="notice">{t(message)}</p>}
    {tab==='appointments'&&<><div className="panel filters"><label>{t("Күні")}<input type="date" value={filter.date} onChange={e=>setFilter({...filter,date:e.target.value})}/></label><label>{t("Бөлім")}<select value={filter.departmentId} onChange={e=>setFilter({...filter,departmentId:e.target.value})}><option value="">{t("Барлық бөлімдер")}</option>{shownDepartments.map(d=><option value={d.id} key={d.id}>{t(d.name)}</option>)}</select></label><label>{t("Мәртебе")}<select value={filter.status} onChange={e=>setFilter({...filter,status:e.target.value})}><option value="">{t("Барлығы")}</option>{Object.entries(statuses).map(([k,v])=><option value={k} key={k}>{t(v)}</option>)}</select></label><button className="outline" disabled={busy} onClick={()=>action(refresh,t('Тізім жаңартылды.'))}>{t("Жаңарту")}</button><button className="outline" disabled={!listReady} onClick={csv}>{t("CSV жүктеу")}</button></div><p className="hint">{listReady?appointments.length:'…'}{t(" жазылу. Ең көбі 1000 жазба көрсетіледі; күн мен бөлім арқылы сүзіңіз.")}</p>{user.role==='staff'&&!user.departmentIds.length&&<p className="notice">{t("Сізге бөлім тағайындалмаған. Әкімшіге хабарласыңыз.")}</p>}<div className="table-wrap panel" aria-busy={refreshing}><table><thead><tr><th>{t("Талон / күн")}</th><th>{t("Азамат")}</th><th>{t("Бөлім")}</th><th>{t("Мәселе")}</th><th>{t("Мәртебе")}</th><th>{t("Әрекет")}</th></tr></thead><tbody>{visibleAppointments.map(a=><tr key={a.id}><td><strong>{a.number}</strong><br/>{a.date}<br/>{a.time}</td><td>{a.fullName}<br/>{a.phone}</td><td>{t(a.departmentName)}</td><td className="issue">{a.issue}</td><td><span className={`badge ${a.status}`}>{t(statuses[a.status])}</span></td><td><button className="outline" onClick={()=>setEdit({...a})}>{t("Ашу")}</button></td></tr>)}</tbody></table>{!visibleAppointments.length&&<p className="empty" role="status">{refreshing?t('Тізім жүктелуде…'):listReady?t('Бұл сүзгі бойынша жазылу жоқ.'):t('Тізім жүктелмеді. «Жаңарту» батырмасын басыңыз.')}</p>}</div></>}
    {tab==='departments'&&<><div className="notice">{t("Әр бөлімнің қабылдауы бөлек. Кестедегі уақыттар UTC+5 бойынша көрсетіледі. Кестені өзгерту бұрын берілген талондарды өзгертпейді.")}</div><DepartmentEditor key={'new-'+newDepartmentVersion} onSave={d=>action(async()=>{await api('/api/admin/departments',d);setNewDepartmentVersion(n=>n+1)},t('Бөлім қосылды.'))} busy={busy}/>{departments.map(d=><DepartmentEditor key={d.id+JSON.stringify(d)} initial={d} onSave={v=>action(()=>api('/api/admin/departments',v),t('Бөлім сақталды.'))} busy={busy}/>)}</>}
    {tab==='users'&&<><p className="notice">{t("Қызметкердің бөлімдерін таңдап, «Рұқсат беру» батырмасын басыңыз. Қажет емес аккаунттың кіруін жабуға немесе аккаунтты өшіруге болады. Екі жағдайда да оның ашық сессиялары тоқтатылады.")}</p>{users.map(u=><UserEditor key={u.id} user={u} departments={departments} onSave={async data=>{
      const result=await api<{user:User}>(`/api/admin/users/${u.id}`,data,'PATCH')
      setUsers(current=>current.map(item=>item.id===result.user.id?result.user:item))
      return result.user
    }} onDelete={async()=>{
      await api(`/api/admin/users/${u.id}`,{},'DELETE')
      setUsers(current=>current.filter(item=>item.id!==u.id))
    }}/>)}</>}
    {tab==='security'&&<Security admin={user.role==='admin'} users={users} onChanged={onPasswordChanged}/>}
    {tab==='operations'&&user.role==='admin'&&<Operations/>}
    {tab==='privacy'&&user.role==='admin'&&<PrivacyEditor/>}
    {tab==='settings'&&<SettingsEditor initial={settings} busy={busy} onSave={s=>action(async()=>{await api('/api/admin/settings',{organization:s.organization,address:s.address,phone:s.phone});onSettings(s)},t('Ұйым баптаулары сақталды.'))}/>}
    {tab==='statistics'&&user.role==='admin'&&<Statistics departments={departments}/>}
    {tab==='special-days'&&user.role==='admin'&&<SpecialDays departments={departments} onAppointments={(date,departmentId)=>{setFilter({date,departmentId,status:'scheduled'});setTab('appointments')}}/>}
    {tab==='audit'&&<div className="table-wrap panel"><table><thead><tr><th>{t("Уақыты · UTC+5")}</th><th>{t("Қызметкер")}</th><th>{t("Әрекет")}</th><th>{t("Нысан ID")}</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{new Intl.DateTimeFormat(locale(),{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Qyzylorda'}).format(e.created_at)}</td><td>{e.actor_name||t('Азамат / жүйе')}</td><td>{e.action}</td><td className="break">{e.target_id}</td></tr>)}</tbody></table><p className="hint">{t("Соңғы 200 әрекет көрсетіледі.")}</p></div>}
    {edit&&<Modal label="edit-title" onClose={()=>setEdit(null)} busy={busy}><h2 id="edit-title">{edit.number} · {edit.fullName}</h2><p className="preserve">{edit.issue}</p><form onSubmit={e=>{e.preventDefault();action(async()=>{await api(`/api/staff/appointments/${edit.id}`,{status:edit.status,note:edit.note},'PATCH');setEdit(null)},t('Жазылу жаңартылды.'))}}><label>{t("Мәртебе")}<select value={edit.status} onChange={e=>setEdit({...edit,status:e.target.value})}>{Object.entries(statuses).map(([k,v])=><option key={k} value={k} disabled={appointments.find(a=>a.id===edit.id)?.status==='cancelled'&&k!=='cancelled'}>{t(v)}</option>)}</select></label><label>{t("Ішкі ескерту")}<textarea rows={4} maxLength={2000} value={edit.note} onChange={e=>setEdit({...edit,note:e.target.value})}/></label><button className="primary" disabled={busy}>{t("Сақтау")}</button></form>{error&&<p className="alert" role="alert">{t(error)}</p>}</Modal>}
  </div></section>
}

function DepartmentEditor({initial,busy,onSave}:{initial?:Department;busy:boolean;onSave:(d:Partial<Department>)=>Promise<void>}) {
  const [value,setValue]=useState<Partial<Department>>(initial||{name:'',description:'',active:false,weekdays:[1,2,3,4,5],startTime:'09:30',breakStart:'12:30',breakEnd:'15:30',endTime:'18:30',slotMinutes:30})
  return <details className="panel department-editor">
    <summary>{initial?`${initial.name} · ${initial.active?t('Ашық'):t('Жабық')}`:t('+ Жаңа бөлім қосу')}</summary>
    <form onSubmit={e=>{e.preventDefault();onSave(value)}}>
      <label>{t("Бөлім атауы")}<input required minLength={2} maxLength={150} value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/></label>
      <label>{t("Сипаттамасы")}<textarea maxLength={1000} value={value.description} onChange={e=>setValue({...value,description:e.target.value})}/></label>
      <fieldset><legend>{t("Қабылдау күндері")}</legend><div className="actions">{[1,2,3,4,5,6,0].map(n=><label className="check" key={n}><input type="checkbox" disabled={n===0||n===6} checked={n!==0&&n!==6&&value.weekdays?.includes(n)} onChange={e=>setValue({...value,weekdays:e.target.checked?[...value.weekdays!,n]:value.weekdays!.filter(d=>d!==n)})}/>{t(weekdays[n])}{n===0||n===6?t(' · демалыс'):''}</label>)}</div></fieldset>
      <div className="form-row">{([['startTime',t('Таңғы басталуы')],['breakStart',t('Таңғы аяқталуы')],['breakEnd',t('Түстен кейін басталуы')],['endTime',t('Түстен кейін аяқталуы')]] as const).map(([key,label])=><label key={key}>{label}<input type="time" required value={value[key]} onChange={e=>setValue({...value,[key]:e.target.value})}/></label>)}</div>
      <label>{t("Қабылдау ұзақтығы")}<select value={value.slotMinutes} onChange={e=>setValue({...value,slotMinutes:Number(e.target.value)})}>{[15,20,30,60].map(n=><option value={n} key={n}>{n}{t(" минут")}</option>)}</select></label>
      <label className="check"><input type="checkbox" checked={value.active} onChange={e=>setValue({...value,active:e.target.checked})}/>{t("Азаматтарға жазылуды ашу")}</label><button className="primary" disabled={busy}>{t("Сақтау")}</button>
    </form>
  </details>
}
function UserEditor({user,departments,onSave,onDelete}:{user:User;departments:Department[];onSave:(data:{status:string;departmentIds:string[]})=>Promise<User>;onDelete:()=>Promise<void>}) {
  const [status,setStatus]=useState(user.status),[ids,setIds]=useState(user.departmentIds)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  const [deleteOpen,setDeleteOpen]=useState(false)
  const saving=useRef(false)
  async function save(nextStatus=status){
    if(saving.current)return
    setError('');setMessage('')
    if(nextStatus==='active'&&!ids.length){setError(t('Рұқсат беру үшін кемінде бір бөлімді таңдаңыз.'));return}
    saving.current=true;setBusy(true)
    try{
      const saved=await onSave({status:nextStatus,departmentIds:nextStatus==='disabled'?[]:ids})
      setStatus(saved.status);setIds(saved.departmentIds)
      setMessage(saved.status==='active'?t('Рұқсат берілді. Қызметкер енді өз аккаунтымен кіре алады.'):saved.status==='disabled'?t('Кіру жабылды. Қызметкер барлық ашық сессиялардан шығарылды.'):t('Қызметкердің мәртебесі мен бөлімдері сақталды.'))
    }catch(e){setError(errorMessage(e))}
    finally{saving.current=false;setBusy(false)}
  }
  async function remove(){
    if(saving.current)return
    saving.current=true;setBusy(true);setError('')
    try{await onDelete()}
    catch(e){setError(errorMessage(e))}
    finally{saving.current=false;setBusy(false)}
  }
  return <article className="panel user-card" data-user-id={user.id}><h3>{user.fullName} <small>({user.username})</small></h3>{user.role==='admin'?<p>{t("Әкімші")}</p>:<form aria-busy={busy} onSubmit={e=>{e.preventDefault();void save()}}>
    <p className={user.status==='active'?'user-status active':'user-status'}>{({pending:t('Растауды күтуде'),active:t('Рұқсат берілген'),rejected:t('Қабылданбаған'),disabled:t('Кіруі жабық')} as Record<string,string>)[user.status]}</p>
    <label>{t("Мәртебе")}<select disabled={busy} value={status} onChange={e=>{setStatus(e.target.value);setMessage('');setError('')}}>{[['pending',t('Растауды күтуде')],['active',t('Расталған')],['rejected',t('Қабылданбаған')],['disabled',t('Кіруі жабық')]].map(([k,v])=><option key={k} value={k}>{t(v)}</option>)}</select></label>
    <fieldset disabled={busy}><legend>{t("Рұқсат берілетін бөлімдер")}</legend>{departments.map(d=><label className="check" key={d.id}><input type="checkbox" checked={ids.includes(d.id)} onChange={e=>{setIds(e.target.checked?[...ids,d.id]:ids.filter(id=>id!==d.id));setMessage('');setError('')}}/>{t(d.name)}</label>)}</fieldset>
    <div className="actions">{user.status!=='active'&&<button type="button" className="primary" disabled={busy} onClick={()=>void save('active')}>{busy?t('Сақталуда…'):t('Рұқсат беру')}</button>}<button type="submit" className={user.status==='active'?'primary':'outline'} disabled={busy}>{busy?t('Сақталуда…'):t('Өзгерістерді сақтау')}</button>{user.status!=='disabled'&&<button type="button" className="danger" disabled={busy} onClick={()=>void save('disabled')}>{t("Кіруді жабу")}</button>}<button type="button" className="outline delete-account" disabled={busy} onClick={()=>{setError('');setDeleteOpen(true)}}>{t("Аккаунтты өшіру")}</button></div>
    {error&&<p className="alert" role="alert">{t(error)}</p>}{message&&<p className="notice" role="status">{t(message)}</p>}
  </form>}{deleteOpen&&<Modal label={'delete-user-'+user.id} onClose={()=>{if(!busy){setDeleteOpen(false);setError('')}}}>
    <h2 id={'delete-user-'+user.id}>{t("Аккаунтты өшіру керек пе?")}</h2>
    <p><strong>{user.fullName}</strong> ({user.username})</p>
    <p>{t("Аккаунт пен оның бөлімдерге рұқсаттары өшіріледі, барлық сессиялары тоқтайды. Азаматтардың қабылдауға жазылулары мен әрекеттер журналы сақталады.")}</p>
    <div className="actions"><button type="button" className="danger" disabled={busy} onClick={()=>void remove()}>{busy?t('Өшірілуде…'):t('Өшіру')}</button><button type="button" className="outline" disabled={busy} onClick={()=>{setDeleteOpen(false);setError('')}}>{t("Болдырмау")}</button></div>
    {error&&<p className="alert" role="alert">{t(error)}</p>}
  </Modal>}</article>
}
function SettingsEditor({initial,busy,onSave}:{initial:Settings;busy:boolean;onSave:(s:Settings)=>Promise<void>}) {
  const [value,setValue]=useState(initial)
  return <form className="panel narrow" onSubmit={e=>{e.preventDefault();onSave(value)}}><h2>{t("Ұйым туралы ақпарат")}</h2><p className="hint">{t("Ұйым атауы мен мекенжайын кейін толтыруға болады. Онлайн өтінім бұл деректерсіз де қолжетімді.")}</p>{([['organization',t('Ұйым атауы')],['address',t('Қабылдау мекенжайы')],['phone',t('Байланыс телефоны')]] as const).map(([key,label])=><label key={key}>{label}<input maxLength={500} value={value[key]} onChange={e=>setValue({...value,[key]:e.target.value})}/></label>)}<p className="hint">{t("Шарттардың нобайын дайындау және жариялау үшін «Деректер шарттары» бөліміне өтіңіз.")}</p><button className="primary" disabled={busy}>{t("Баптауларды сақтау")}</button></form>
}
