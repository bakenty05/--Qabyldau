import test from 'node:test'
import assert from 'node:assert/strict'
import { formatTicketCode, readTicketLink, ticketLookupUrl } from '../src/ticket-access.ts'

test('QR ticket links preserve leading zeros and keep phone and code only in the fragment',()=>{
  const ticket={appointment:{id:'4d964290-3fe0-4c78-8b28-a01118aff300',phone:'+77771234567'},accessToken:'001234'}
  const url=new URL(ticketLookupUrl(ticket,'https://example.com'))
  assert.equal(url.search,'')
  assert.equal(url.pathname,'/')
  assert.deepEqual(readTicketLink(url.hash),{identifier:ticket.appointment.phone,code:'001234',legacy:false})
  assert.equal(formatTicketCode('001234'),'001 234')
})

test('legacy ticket QR links retain the old UUID and full secret',()=>{
  const ticket={appointment:{id:'4d964290-3fe0-4c78-8b28-a01118aff300',phone:'+77771234567'},accessToken:'a'.repeat(64)}
  assert.deepEqual(readTicketLink(new URL(ticketLookupUrl(ticket,'https://example.com')).hash),{identifier:ticket.appointment.id,code:ticket.accessToken,legacy:true})
  assert.equal(formatTicketCode(ticket.accessToken),ticket.accessToken)
})

test('incomplete, malformed and unrelated QR fragments cannot trigger automatic lookup',()=>{
  for(const hash of ['#ticket','#ticket?phone=%2B77771234567','#ticket?phone=%2B77771234567&code=12345','#ticket?phone=not-a-phone&code=123456','#ticket?id=wrong&code='+ 'a'.repeat(64),'#home?phone=%2B77771234567&code=123456']) assert.equal(readTicketLink(hash),null)
})
