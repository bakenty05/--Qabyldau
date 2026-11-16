import QRCode from 'qrcode'
import type { ReceiptTicket } from './ticket-receipt'
import { ticketLookupUrl } from './ticket-access'

export function createTicketQr(ticket: ReceiptTicket, origin: string) {
  const url = ticketLookupUrl(ticket,origin)
  const { modules } = QRCode.create(url,{errorCorrectionLevel:'M'})
  const margin = 4
  const size = modules.size + margin * 2
  const squares: [number,number][] = []
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row,col)) squares.push([col+margin,row+margin])
    }
  }
  return {url,size,squares}
}
