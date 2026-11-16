import { t } from './i18n'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import PhoneInput from './PhoneInput'
import TicketCard from './TicketCard'
import type { ReceiptTicket } from './ticket-receipt'
import { readTicketLink } from './ticket-access'
import { api, errorMessage } from './api'
import FeedbackForm from './FeedbackForm'

export default function TicketLookup({ address }: { address: string }) {
  const [initial] = useState(() => readTicketLink(window.location.hash))
  const [legacy,setLegacy] = useState(initial?.legacy || false)
  const [identifier,setIdentifier] = useState(initial?.identifier || '+7')
  const [code,setCode] = useState(initial?.code || '')
  const [ticket,setTicket] = useState<ReceiptTicket|null>(null)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(!!initial)
  const [cancelOpen,setCancelOpen] = useState(false)
  const [now,setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const path = legacy ? `/api/tickets/${encodeURIComponent(identifier)}` : '/api/tickets/lookup'

  useEffect(() => {
    if (!initial) return
    const controller = new AbortController()
    window.history.replaceState(null,'',window.location.pathname + window.location.search + '#ticket')
    const endpoint = initial.legacy ? `/api/tickets/${initial.identifier}` : '/api/tickets/lookup'
    api<Omit<ReceiptTicket,'accessToken'>>(endpoint,{ phone: initial.identifier, accessToken: initial.code },'POST',controller.signal)
      .then(result => { if (!controller.signal.aborted) setTicket({...result,accessToken:initial.code}) })
      .catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  },[initial])

  async function load(event?: FormEvent, cancel = false) {
    event?.preventDefault(); setBusy(true); setError('')
    try {
      const result = await api<Omit<ReceiptTicket,'accessToken'>>(path + (cancel ? '/cancel' : ''),{phone:identifier,accessToken:code})
      setTicket({...result,accessToken:code}); setCancelOpen(false)
    } catch (error) { setError(errorMessage(error)); if (!cancel) setTicket(null) }
    finally { setBusy(false) }
  }
  function resetResult() { setTicket(null); setError(''); setCancelOpen(false) }

  return <div className="panel ticket-lookup">
    <p className="hint">{t("Талондағы QR кодты сканерлеңіз немесе телефон нөмірі мен 6 таңбалы кодты енгізіңіз.")}</p>
    <form onSubmit={load}>
      <fieldset disabled={busy} className="ticket-lookup-fields">
        {legacy ? <label>{t("Бұрынғы талон ID")}<input required value={identifier} maxLength={36} onChange={event => {setIdentifier(event.target.value.trim());resetResult()}}/></label>
          : <PhoneInput value={identifier} onChange={phone => {setIdentifier(phone);resetResult()}}/>}
        <label>{legacy ? t('Бұрынғы жеке кілт') : t('Талон коды')}<input name="ticketCode" className={legacy ? '' : 'ticket-code-input'} type={legacy ? 'password' : 'text'} inputMode={legacy ? 'text' : 'numeric'} autoComplete="off" required minLength={legacy ? 1 : 6} maxLength={legacy ? 64 : 6} pattern={legacy ? undefined : '[0-9]{6}'} placeholder={legacy ? t('Талондағы жеке кілт') : '000000'} value={code} onChange={event => {setCode(legacy ? event.target.value.trim() : event.target.value.replace(/\D/g,'').slice(0,6));resetResult()}} onPaste={event => {if(!legacy){event.preventDefault();setCode(event.clipboardData.getData('text').replace(/\D/g,'').slice(0,6));resetResult()}}}/></label>
        {!legacy && <p className="hint">{t("6 таңбалы код сақталған талонда көрсетілген.")}</p>}
        <button className="primary wide" disabled={busy}>{busy ? t('Тексерілуде…') : t('Талонды тексеру')}</button>
      </fieldset>
    </form>
    <button className="text-button no-print" disabled={busy} onClick={() => {setLegacy(!legacy);setIdentifier(legacy ? '+7' : '');setCode('');resetResult()}}>{legacy ? t('Телефон және қысқа кодпен тексеру') : t('Бұрынғы талонмен тексеру')}</button>
    {error && <p role="alert" className="alert">{t(error)}</p>}
    {ticket && <><TicketCard ticket={ticket} address={address}/><FeedbackForm key={ticket.appointment.id} ticket={ticket} path={path} identifier={identifier} onSaved={setTicket}/>{ticket.appointment.status === 'scheduled' && new Date(`${ticket.appointment.date}T${ticket.appointment.time}:00+05:00`).getTime() > now && (cancelOpen ? <div className="notice"><p>{t("Жазылудан бас тартсаңыз, уақыт басқа азаматтарға ашылады.")}</p><div className="actions"><button className="danger" disabled={busy} onClick={() => load(undefined,true)}>{t("Бас тартуды растау")}</button><button className="outline" disabled={busy} onClick={() => setCancelOpen(false)}>{t("Артқа")}</button></div></div> : <button className="text-button" onClick={() => setCancelOpen(true)}>{t("Жазылудан бас тарту")}</button>)}</>}
  </div>
}
