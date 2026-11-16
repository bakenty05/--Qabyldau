import { t } from './i18n'
import { useMemo, useState } from 'react'
import { formatReceptionDate } from './reception-calendar'
import { downloadTicketImage, receiptChecklist, statuses } from './ticket-receipt'
import type { ReceiptTicket } from './ticket-receipt'
import { formatTicketCode, isShortTicketCode } from './ticket-access'
import { createTicketQr } from './ticket-qr'
import './ticket.css'

function ReceiptIcon({ name }: { name: 'check' | 'download' | 'print' | 'calendar' | 'clock' }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'check' && <path d="m5 12 4 4L19 6" />}
    {name === 'download' && <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>}
    {name === 'print' && <><path d="M7 8V3h10v5M7 17H4V8h16v9h-3" /><path d="M7 14h10v7H7zM17 11h.01" /></>}
    {name === 'calendar' && <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18" /></>}
    {name === 'clock' && <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}
  </svg>
}

export default function TicketCard({ ticket, address }: { ticket: ReceiptTicket; address: string }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const a = ticket.appointment
  const shortCode = isShortTicketCode(ticket.accessToken)
  const qr = useMemo(() => createTicketQr(ticket,window.location.origin),[ticket])
  async function save() {
    setSaving(true)
    setError('')
    try { await downloadTicketImage(ticket, address) }
    catch (error) { setError(error instanceof Error ? error.message : t('Талон сақталмады. Қайта көріңіз.')) }
    finally { setSaving(false) }
  }

  return <div className="ticket">
    <article className="receipt" aria-label={`${t('Талон')} ${a.number}`}>
      <div className="receipt-header">
        <div className="receipt-brand"><span className="receipt-brand-mark" aria-hidden="true">E</span><span>{t("Е-Qabyldau")}<small>{t("Электронды қабылдау")}</small></span></div>
        <p className="receipt-kicker">{t("СІЗДІҢ ҚАБЫЛДАУ ТАЛОНЫҢЫЗ")}</p>
        <h2 id="booking-title">{a.number}</h2>
        <span className={`receipt-status ${a.status}`}><span aria-hidden="true" />{t(statuses[a.status] || a.status)}</span>
      </div>
      <div className="receipt-body">
        <div className="receipt-schedule">
          <div><span className="receipt-label"><ReceiptIcon name="calendar" />{t("Қабылдау күні")}</span><strong>{formatReceptionDate(a.date)}</strong></div>
          <div><span className="receipt-label"><ReceiptIcon name="clock" />{t("Уақыты")}</span><strong className="receipt-time">{a.time}</strong></div>
          <small>{t("Қызылорда уақыты · UTC+5")}</small>
        </div>
        <dl className="receipt-fields">
          {[[t('Бөлім'), t(a.departmentName)], [t('Аты-жөні'), a.fullName], [t('Қабылдау мекенжайы'), address || t('Мекенжайды ұйымнан нақтылаңыз.')]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <div className="receipt-tear" aria-hidden="true"><span /></div>
        <section className="receipt-checklist" aria-label={t("Қабылдауға дайындық чек-листі")}>
          <h3>{t("Қабылдауға дайындық")}</h3>
          <ul>{receiptChecklist.map(item => <li key={item}><span className="receipt-check"><ReceiptIcon name="check" /></span>{t(item)}</li>)}</ul>
        </section>
        <section className="receipt-private" aria-label={t("Талонды тексеру деректері")}>
          <h3>{t("Талонды тексеру")}</h3>
          <dl className={shortCode ? 'receipt-access' : ''}><div><dt>{shortCode ? t('Телефон нөмірі') : t('Бұрынғы талон ID')}</dt><dd>{shortCode ? a.phone : a.id}</dd></div><div><dt>{shortCode ? t('Талон коды') : t('Бұрынғы жеке кілт')}</dt><dd className={shortCode ? 'receipt-code' : ''}>{formatTicketCode(ticket.accessToken)}</dd></div></dl>
          <a className="receipt-qr" href={qr.url} aria-label={t("QR код арқылы талонды ашу")}>
            <svg role="img" aria-label={t("Талонды тексеруге арналған QR код")} viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges"><rect width={qr.size} height={qr.size} fill="#fff"/><path d={qr.squares.map(([x,y]) => `M${x} ${y}h1v1h-1z`).join('')} fill="#000"/></svg>
            <span>{t("QR кодты сканерлеңіз")}<small>{t("Талоныңыз бірден ашылады")}</small></span>
          </a>
          <p>{t("Талон мен кодты құпия сақтаңыз.")}</p>
        </section>
        <p className="receipt-footer">{t("Талоныңызды сақтап, қабылдауда көрсетіңіз.")}</p>
      </div>
    </article>
    <div className="receipt-actions no-print">
      <button className="primary" onClick={save} disabled={saving}><ReceiptIcon name="download" />{saving ? t('Сақталуда…') : t('Талонды сақтау')}<span className="receipt-format">PNG</span></button>
      <button className="outline" onClick={() => window.print()}><ReceiptIcon name="print" />{t("Басып шығару / PDF")}</button>
    </div>
    <p className="receipt-save-hint no-print">{t("Талон QR кодымен бірге сурет болып сақталады.")}</p>
    {error && <p className="alert no-print" role="alert">{t(error)}</p>}
  </div>
}
