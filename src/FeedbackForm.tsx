import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ReceiptTicket } from './ticket-receipt'
import { api, errorMessage } from './api'
import { t } from './i18n'

export default function FeedbackForm({ticket,path,identifier,onSaved}:{ticket:ReceiptTicket;path:string;identifier:string;onSaved:(ticket:ReceiptTicket)=>void}) {
  const [rating,setRating]=useState('')
  const [comment,setComment]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('')
    try {
      const result=await api<Omit<ReceiptTicket,'accessToken'>>(path+'/feedback',{phone:identifier,accessToken:ticket.accessToken,rating:Number(rating),comment})
      onSaved({...result,accessToken:ticket.accessToken})
    }catch(error){setError(errorMessage(error))}
    finally{setBusy(false)}
  }
  if(ticket.feedback)return <section className="notice feedback-saved no-print" aria-label={t('Қабылдауды бағалау')}><p role="status">{t('Бағаңыз сақталды. Рақмет!')}</p><strong>{'★'.repeat(ticket.feedback.rating)}<span className="sr-only"> {ticket.feedback.rating} / 5</span></strong>{ticket.feedback.comment&&<p className="preserve">{ticket.feedback.comment}</p>}</section>
  if(!ticket.feedbackEligible)return ticket.appointment.status==='scheduled'?<p className="hint no-print">{t('Қызметкер қабылдауды аяқталған деп белгілегеннен кейін осы жерде баға бере аласыз.')}</p>:null
  return <section className="feedback-form no-print"><h2>{t('Қабылдауды бағалау')}</h2><p>{t('Қызмет сапасын қалай бағалайсыз?')}</p><form onSubmit={submit}>
    <fieldset disabled={busy}><legend>{t('Баға')}</legend><div className="feedback-stars">{[1,2,3,4,5].map(value=><label key={value}><input type="radio" name="rating" required value={value} checked={rating===String(value)} onChange={event=>setRating(event.target.value)}/><span aria-hidden="true">{value} ★</span><span className="sr-only">{value} / 5</span></label>)}</div></fieldset>
    <label>{t('Пікір (міндетті емес)')}<textarea name="feedbackComment" rows={3} maxLength={1000} placeholder={t('Қысқаша пікір қалдырыңыз')} value={comment} disabled={busy} onChange={event=>setComment(event.target.value)}/></label>
    <p className="hint">{t('Пікірде жеке деректерді көрсетпеңіз. Пікірді тек әкімші көреді.')}</p>
    <button className="primary wide" disabled={busy}>{t(busy?'Сақталуда…':'Бағалауды жіберу')}</button>
    {error&&<p role="alert" className="alert">{t(error)}</p>}
  </form></section>
}
