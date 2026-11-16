import type { ReceiptTicket } from './ticket-receipt'

export function isShortTicketCode(code: string) {
  return /^\d{6}$/.test(code)
}

export function formatTicketCode(code: string) {
  return isShortTicketCode(code) ? `${code.slice(0,3)} ${code.slice(3)}` : code
}

export function ticketLookupUrl(ticket: ReceiptTicket, origin: string) {
  const params = new URLSearchParams(isShortTicketCode(ticket.accessToken)
    ? { phone: ticket.appointment.phone, code: ticket.accessToken }
    : { id: ticket.appointment.id, code: ticket.accessToken })
  // Fragment credentials stay out of HTTP requests and server access logs.
  return `${origin}/#ticket?${params}`
}

export function readTicketLink(hash: string) {
  const params = new URLSearchParams(hash.startsWith('#ticket?') ? hash.slice(8) : '')
  const phone = params.get('phone') || ''
  const id = params.get('id') || ''
  const code = params.get('code') || ''
  if (/^\+7\d{10}$/.test(phone) && isShortTicketCode(code)) return { identifier: phone, code, legacy: false }
  if (/^[a-f0-9-]{36}$/.test(id) && /^[a-f0-9]{64}$/.test(code)) return { identifier: id, code, legacy: true }
  return null
}
