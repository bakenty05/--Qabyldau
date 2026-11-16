import { t } from './i18n'
import { formatReceptionDate } from './reception-calendar'
import { formatTicketCode, isShortTicketCode } from './ticket-access'
import { createTicketQr } from './ticket-qr'

export type ReceiptTicket = {
  appointment: {
    id: string
    number: string
    departmentName: string
    fullName: string
    phone: string
    date: string
    time: string
    status: string
  }
  accessToken: string
  feedback?: {rating:number;comment:string;createdAt:number}|null
  feedbackEligible?: boolean
}

export const statuses: Record<string, string> = {
  scheduled: 'Жазылды', completed: 'Қабылданды', cancelled: 'Бас тартылды', no_show: 'Келмеді',
}

export const receiptChecklist = [
  'Талонды телефоныңызға сақтаңыз',
  'Жеке куәлігіңізді өзіңізбен алыңыз',
  'Қабылдауға 10 минут бұрын келіңіз',
]

// Draw locally so private ticket data never leaves the browser during export.
export async function downloadTicketImage(ticket: ReceiptTicket, address: string) {
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('Талон суретін жасау мүмкін болмады. Басып шығару батырмасын қолданыңыз.'))

  const a = ticket.appointment
  const width = 720
  const font = '"Segoe UI", Arial, sans-serif'
  const setFont = (size: number, weight = 400) => { ctx.font = `${weight} ${size}px ${font}` }
  function lines(value: string, maxWidth: number, size: number, weight = 400) {
    setFont(size, weight)
    const result: string[] = []
    for (const paragraph of value.split(/\r?\n/)) {
      let line = ''
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && ctx!.measureText(`${line} ${word}`).width > maxWidth) {
          result.push(line)
          line = ''
        }
        // Long identifiers and words also wrap, without dropping any characters.
        for (const character of (line ? ' ' : '') + word) {
          if (line && ctx!.measureText(line + character).width > maxWidth) {
            result.push(line)
            line = ''
          }
          line += character
        }
      }
      result.push(line)
    }
    return result
  }

  const fields = [
    [t('БӨЛІМ'), t(a.departmentName)],
    [t('АТЫ-ЖӨНІ'), a.fullName],
    [t('ҚАБЫЛДАУ МЕКЕНЖАЙЫ'), address || t('Мекенжайды ұйымнан нақтылаңыз.')],
  ].map(([label, value]) => ({ label, lines: lines(value, 560, 23, 600) }))
  const numberLines = lines(a.number, 560, 56, 800)
  const dateLines = lines(formatReceptionDate(a.date), 320, 23, 700)
  const shortCode = isShortTicketCode(ticket.accessToken)
  const idLines = lines(shortCode ? a.phone : a.id, 560, 23, 600)
  const tokenLines = lines(formatTicketCode(ticket.accessToken), 560, shortCode ? 32 : 18, 600)
  const qr = createTicketQr(ticket,window.location.origin)
  const headerHeight = 250 + (numberLines.length - 1) * 64
  const dateHeight = 88 + dateLines.length * 30
  const fieldsHeight = fields.reduce((height, field) => height + 60 + field.lines.length * 32, 0)
  const privateHeight = 420 + (idLines.length + tokenLines.length) * 38
  const height = 64 + headerHeight + dateHeight + fieldsHeight + 240 + privateHeight + 56
  canvas.width = width * 2
  canvas.height = height * 2
  ctx.scale(2, 2)
  ctx.textBaseline = 'top'

  function box(x: number, y: number, w: number, h: number, radius: number, color: string | CanvasGradient) {
    ctx!.fillStyle = color
    ctx!.beginPath()
    ctx!.roundRect(x, y, w, h, radius)
    ctx!.fill()
  }
  function text(value: string, x: number, y: number, size: number, color: string, weight = 400) {
    setFont(size, weight)
    ctx!.fillStyle = color
    ctx!.fillText(t(value), x, y)
  }
  function multiline(values: string[], x: number, y: number, size: number, color: string, weight = 400, leading = 32) {
    values.forEach((line, index) => text(line, x, y + index * leading, size, color, weight))
  }
  function separator(y: number) {
    ctx!.strokeStyle = '#bed4e2'
    ctx!.lineWidth = 1.5
    ctx!.setLineDash([6, 7])
    ctx!.beginPath()
    ctx!.moveTo(64, y)
    ctx!.lineTo(656, y)
    ctx!.stroke()
    ctx!.setLineDash([])
  }

  const background = ctx.createLinearGradient(0, 0, width, height)
  background.addColorStop(0, '#d7e9fb')
  background.addColorStop(1, '#c5eae7')
  box(0, 0, width, height, 0, background)
  box(32, 32, 656, height - 64, 26, '#edf5fb')
  const header = ctx.createLinearGradient(32, 32, 688, headerHeight)
  header.addColorStop(0, '#122c5b')
  header.addColorStop(0.6, '#164e7c')
  header.addColorStop(1, '#137f8a')
  box(32, 32, 656, headerHeight, 26, header)
  // Overlap the lower corners to keep the receipt header joined to the body.
  box(32, headerHeight, 656, 32, 0, header)
  ctx.save()
  ctx.beginPath()
  ctx.rect(32, 32, 656, headerHeight)
  ctx.clip()
  ctx.strokeStyle = '#ffffff18'
  ctx.lineWidth = 32
  ctx.beginPath()
  ctx.arc(645, 80, 130, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
  text(t('Е-Qabyldau'), 80, 65, 25, '#ffffff', 800)
  text(t('ЭЛЕКТРОНДЫ ҚАБЫЛДАУ ТАЛОНЫ'), 80, 112, 15, '#bde4f3', 600)
  multiline(numberLines, 80, 147, 56, '#ffffff', 800, 64)
  const isPositive = a.status === 'scheduled' || a.status === 'completed'
  const statusLabel = statuses[a.status] || a.status
  setFont(16, 600)
  const statusWidth = Math.max(140, ctx.measureText(statusLabel).width + 38)
  box(80, headerHeight - 17, statusWidth, 33, 16, isPositive ? '#c4f1df' : '#ffe0d9')
  text(statusLabel, 99, headerHeight - 11, 16, isPositive ? '#145b46' : '#953b35', 600)

  let y = 32 + headerHeight + 28
  box(64, y, 592, dateHeight, 16, '#dcebf7')
  text(t('ҚАБЫЛДАУ КҮНІ'), 86, y + 18, 13, '#486681', 700)
  multiline(dateLines, 86, y + 43, 23, '#142f53', 700, 30)
  text(t('Қызылорда уақыты · UTC+5'), 86, y + dateHeight - 30, 13, '#486681')
  text(t('УАҚЫТЫ'), 470, y + 18, 13, '#486681', 700)
  text(a.time, 470, y + 43, 37, '#125d74', 800)
  y += dateHeight + 24
  for (const field of fields) {
    text(field.label, 80, y, 13, '#54708c', 700)
    multiline(field.lines, 80, y + 26, 23, '#142f53', 600)
    y += 60 + field.lines.length * 32
  }
  separator(y - 6)
  y += 22
  text(t('ҚАБЫЛДАУҒА ДАЙЫНДЫҚ'), 80, y, 15, '#125d74', 800)
  y += 39
  for (const item of receiptChecklist) {
    box(80, y - 2, 26, 26, 8, '#c5e9de')
    ctx.strokeStyle = '#18705c'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(87, y + 10)
    ctx.lineTo(92, y + 15)
    ctx.lineTo(100, y + 5)
    ctx.stroke()
    text(item, 120, y, 20, '#254b60', 500)
    y += 43
  }
  y += 18
  separator(y)
  y += 24
  text(t('ЖЕКЕ ТАЛОН ДЕРЕКТЕРІ'), 80, y, 15, '#125d74', 800)
  y += 32
  text(shortCode ? t('Телефон нөмірі') : t('Бұрынғы талон ID'), 80, y, 13, '#54708c', 600)
  y += 22
  multiline(idLines, 80, y, 23, '#254b60', 600, 30)
  y += idLines.length * 30 + 18
  text(shortCode ? t('Талон коды · 6 цифр') : t('Бұрынғы жеке кілт'), 80, y, 13, '#54708c', 600)
  y += 22
  multiline(tokenLines, 80, y, shortCode ? 32 : 18, '#142f53', 600, 38)
  y += tokenLines.length * 38 + 24
  const moduleSize = Math.floor(224 / qr.size)
  const qrSize = qr.size * moduleSize
  box(80,y,qrSize,qrSize,0,'#ffffff')
  ctx.fillStyle = '#000000'
  for (const [col,row] of qr.squares) ctx.fillRect(80+col*moduleSize,y+row*moduleSize,moduleSize,moduleSize)
  text(t('Талонды тексеру'), 330, y+24, 22, '#125d74', 700)
  multiline(lines(t('QR кодты телефон камерасымен сканерлеңіз.'),290,19),330,y+64,19,'#486681',400,28)
  y += qrSize + 20
  text(t('Талон мен кодты басқа адамға бермеңіз.'), 80, y, 15, '#54708c')

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
    if (value) resolve(value)
    else reject(new Error(t('Талон сақталмады. Қайта көріңіз немесе басып шығарыңыз.')))
  }, 'image/png'))
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `talon-${a.number.replace(/[^\p{L}\p{N}_-]/gu, '-')}.png`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
