import { getLanguage } from './i18n.ts'
const monthNames = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан']
export type ReceptionException = {date:string;closed:boolean;periods:{start:string;end:string}[];slotMinutes:number|null}

export function formatReceptionMonth(month: string): string {
  return `${month.slice(0, 4)}.${month.slice(5, 7)}`
}

export function formatReceptionDate(date: string): string {
  if(getLanguage()==='ru')return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${date}T00:00:00Z`))
  return `${date.slice(0, 4)} жылғы ${Number(date.slice(8, 10))} ${monthNames[Number(date.slice(5, 7)) - 1]}`
}

export function addDays(date: string, count: number): string {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + count)
  return day.toISOString().slice(0, 10)
}

export function isReceptionDate(date: string, min: string, max: string, weekdays: number[], exceptions:Pick<ReceptionException,'date'|'closed'>[]=[]): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const day = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) return false
  if(date<min||date>max)return false
  const exception=exceptions.find(item=>item.date===date)
  if(exception)return !exception.closed
  const weekday = day.getUTCDay()
  return date >= min && date <= max && weekday !== 0 && weekday !== 6 && weekdays.includes(weekday)
}

export function monthDays(month: string): (string | null)[] {
  const first = new Date(`${month}-01T00:00:00Z`)
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const padding = (first.getUTCDay() + 6) % 7
  return [...Array<string | null>(padding).fill(null), ...Array.from({length: count}, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)]
}
