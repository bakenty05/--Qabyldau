import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { t } from './i18n'
import './staff-sidebar.css'

type Section = { id:string; label:string }
const preferenceKey='eq-sidebar-collapsed'

function MenuIcon({name}:{name:string}) {
  const paths:Record<string,ReactNode>={
    appointments:<><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-11 4h2m3 0h1m-6 3h2"/></>,
    departments:<><path d="m3 9 9-6 9 6M4 21h16M6 11v7m6-7v7m6-7v7M3 9h18"/></>,
    users:<><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4a6 6 0 0 1 3 5v2"/></>,
    settings:<><path d="m9 3-.6 3-2 .9-2.7-1-2 3.5 2.2 2v2.2l-2.2 2 2 3.5 2.7-1 2 .9.6 3h4l.6-3 2-.9 2.7 1 2-3.5-2.2-2v-2.2l2.2-2-2-3.5-2.7 1-2-.9L13 3Z"/><circle cx="11" cy="12.5" r="3"/></>,
    audit:<><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l3 2"/></>,
    statistics:<><path d="M4 3v18h17M8 16v-5m5 5V6m5 10v-7"/></>,
    'special-days':<><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-11 4 2 2 4-4"/></>,
    operations:<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M6 11h3l2-4 3 7 2-3h2"/></>,
    privacy:<><path d="M13 3H5v18h14V9l-6-6Zm0 0v6h6M8 13h8m-8 4h5"/></>,
    security:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
    menu:<path d="M4 6h16M4 12h16M4 18h16"/>,
    close:<path d="m6 6 12 12M6 18 18 6"/>,
    collapse:<><path d="m14 7-5 5 5 5"/><path d="M4 4v16"/></>,
    expand:<><path d="m10 7 5 5-5 5"/><path d="M4 4v16"/></>,
    chevron:<path d="m9 6 6 6-6 6"/>,
  }
  return <svg className="staff-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.menu}</svg>
}

export default function StaffSidebar({sections,active,onSelect}:{sections:Section[];active:string;onSelect:(id:string)=>void}) {
  const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem(preferenceKey)==='true'}catch{return false}})
  const [mobile,setMobile]=useState(()=>window.matchMedia('(max-width: 900px)').matches)
  const [open,setOpen]=useState(false)
  const sidebar=useRef<HTMLElement>(null),trigger=useRef<HTMLButtonElement>(null),toggle=useRef<HTMLButtonElement>(null)
  useEffect(()=>{
    const query=window.matchMedia('(max-width: 900px)')
    const change=()=>{setMobile(query.matches);setOpen(false)}
    query.addEventListener('change',change)
    return()=>query.removeEventListener('change',change)
  },[])
  useEffect(()=>{
    if(!open||!mobile)return
    const previousOverflow=document.body.style.overflow
    const returnTarget=trigger.current
    document.body.style.overflow='hidden';toggle.current?.focus()
    return()=>{document.body.style.overflow=previousOverflow;returnTarget?.focus({preventScroll:true})}
  },[open,mobile])
  function toggleSidebar(){
    if(mobile){setOpen(false);return}
    const next=!collapsed;setCollapsed(next)
    try{localStorage.setItem(preferenceKey,String(next))}catch{/* Use the current session when storage is disabled. */}
  }
  function keydown(event:KeyboardEvent<HTMLElement>){
    if(!mobile||!open)return
    if(event.key==='Escape'){event.preventDefault();setOpen(false)}
    if(event.key==='Tab'){
      const buttons=sidebar.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
      if(!buttons?.length)return
      const first=buttons[0],last=buttons[buttons.length-1]
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
  }
  const action=mobile?'Мәзірді жабу':collapsed?'Мәзірді кеңейту':'Мәзірді ықшамдау'
  return <>
    <button ref={trigger} type="button" className="staff-menu-trigger" aria-controls="staff-sidebar" aria-expanded={open} onClick={()=>setOpen(true)}><MenuIcon name="menu"/><span>{t('Бөлімдер мәзірі')}</span><span className="staff-menu-current">{t(sections.find(section=>section.id===active)?.label||'Қабылдаулар')}</span></button>
    {mobile&&open&&<div className="staff-sidebar-backdrop" onClick={()=>setOpen(false)} aria-hidden="true"/>}
    <aside ref={sidebar} id="staff-sidebar" className={`staff-sidebar${collapsed?' is-collapsed':''}${open?' is-open':''}`} role={mobile?'dialog':undefined} aria-modal={mobile&&open?true:undefined} aria-label={t('Кабинет бөлімдері')} inert={mobile&&!open?true:undefined} onKeyDown={keydown}>
      <div className="staff-sidebar-heading"><span>{t('БАСҚАРУ')}</span><button ref={toggle} type="button" className="staff-sidebar-toggle" aria-label={t(action)} title={t(action)} aria-expanded={mobile?open:!collapsed} aria-controls="staff-navigation" onClick={toggleSidebar}><MenuIcon name={mobile?'close':collapsed?'expand':'collapse'}/></button></div>
      <nav className="tabs staff-nav" id="staff-navigation" aria-label={t('Кабинет бөлімдері')}>{sections.map(section=><button type="button" key={section.id} data-section={section.id} className={section.id===active?'selected':''} aria-pressed={section.id===active} aria-current={section.id===active?'page':undefined} aria-label={t(section.label)} title={t(section.label)} onClick={()=>{onSelect(section.id);if(mobile)setOpen(false)}}><MenuIcon name={section.id}/><span className="staff-nav-label">{t(section.label)}</span><span className="staff-nav-chevron"><MenuIcon name="chevron"/></span></button>)}</nav>
      <div className="staff-sidebar-footer"><span className="staff-sidebar-mark">E</span><span className="staff-sidebar-caption">Е-Qabyldau<small>{t('Электронды қабылдау')}</small></span></div>
    </aside>
  </>
}
