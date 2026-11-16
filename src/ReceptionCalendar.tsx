import { t } from './i18n'
import { useEffect, useId, useRef, useState } from 'react'
import { addDays, formatReceptionDate, formatReceptionMonth, isReceptionDate, monthDays } from './reception-calendar'
import type { ReceptionException } from './reception-calendar'

type Props = { value: string; onChange: (date: string) => void; min: string; weekdays: number[]; disabled: boolean; exceptions?:ReceptionException[]; onOpen?:()=>void }
const weekdayNames = ['Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сб', 'Жс']

export default function ReceptionCalendar({ value, onChange, min, weekdays, disabled, exceptions=[], onOpen }: Props) {
  const [month, setMonth] = useState(() => (value || min).slice(0, 7))
  const [open, setOpen] = useState(false)
  const container = useRef<HTMLFieldSetElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const helpId = useId()
  const isOpen = open && !disabled
  const max = addDays(min, 90)
  const monthDate = new Date(`${month}-01T00:00:00Z`)
  const monthTitle = formatReceptionMonth(month)
  useEffect(() => {
    if (!open) return
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])
  function moveMonth(offset: number) {
    const date = new Date(monthDate)
    date.setUTCMonth(date.getUTCMonth() + offset)
    setMonth(date.toISOString().slice(0, 7))
  }
  return <fieldset ref={container} className="reception-calendar" disabled={disabled} aria-describedby={helpId} onKeyDown={event => {
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
  }}>
    <legend>{t("Қабылдау күні")}</legend>
    <button ref={trigger} type="button" className="calendar-trigger" disabled={disabled} aria-expanded={isOpen} aria-controls={panelId} onClick={() => {
      if (!isOpen) {setMonth((value || min).slice(0, 7));onOpen?.()}
      setOpen(!isOpen)
    }}>
      <span>{value ? formatReceptionDate(value) : t('Күнді таңдаңыз')}</span>
      <span className="calendar-chevron" aria-hidden="true">⌄</span>
    </button>
    <div id={panelId} className="calendar-panel" hidden={!isOpen}>
    <div className="calendar-heading">
      <button type="button" aria-label={t("Алдыңғы ай")} disabled={disabled || month <= min.slice(0, 7)} onClick={() => moveMonth(-1)}>‹</button>
      <strong aria-live="polite">{monthTitle}</strong>
      <button type="button" aria-label={t("Келесі ай")} disabled={disabled || month >= max.slice(0, 7)} onClick={() => moveMonth(1)}>›</button>
    </div>
    <div className="calendar-grid" role="group" aria-label={t("Қабылдау күндері")}>
      {weekdayNames.map((name, index) => <span key={name} className={index >= 5 ? 'weekend-label' : ''}>{t(name)}</span>)}
      {monthDays(month).map((date, index) => {
        if (!date) return <span key={`empty-${index}`} aria-hidden="true" />
        const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())
        const exception=exceptions.find(item=>item.date===date)
        const allowed = !disabled && isReceptionDate(date, min, max, weekdays,exceptions)
        const label = formatReceptionDate(date)
        const description=exception?t(exception.closed?'Қабылдау жабық':'Арнайы кесте'):weekend?t('Демалыс күні'):''
        return <button key={date} type="button" data-date={date} className={[weekend?'weekend':'',exception?(exception.closed?'exception-closed':'exception-open'):''].join(' ')} disabled={!allowed} aria-label={`${label}${description?', '+description:''}`} aria-pressed={value === date} title={description||undefined} onClick={() => {
          onChange(date)
          setOpen(false)
          trigger.current?.focus()
        }}>{Number(date.slice(8))}</button>
      })}
    </div>
    </div>
    <input type="hidden" name="date" value={value} />
    <p className="hint" id={helpId}>{t('Әдетте сенбі мен жексенбі — демалыс. Ерекше күндер әкімші бекіткен кестемен көрсетіледі.')}</p>
  </fieldset>
}
