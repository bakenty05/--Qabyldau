import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createApp } from '../server/app.mjs'
import { openStore, passwordHash, localDate, digest } from '../server/store.mjs'
import { createOperations, verifyDatabase } from '../server/operations.mjs'
import { browserDriver } from './browser-driver.mjs'

mkdirSync('.tmp',{recursive:true})
const output=mkdtempSync(resolve('.tmp','security-browser-')),db=openStore(':memory:')
const operations=createOperations(db,{directory:resolve(output,'backups')});operations.check()
const {server}=createApp({db,operations,origin:'http://127.0.0.1:3006'})
const password='Browser original password 12345',newPassword='Browser replacement password 67890',changedPassword='Browser final password 98765'
const users={}
for(const role of ['admin','staff']) {
  const id=randomUUID();users[role]={id,username:'browser.'+role}
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1,?,NULL,NULL)').run(id,users[role].username,role==='admin'?'Сынақ Әкімші':'Сынақ Қызметкер',passwordHash(password),role,'active',Date.now())
}
db.prepare('INSERT INTO staff_departments VALUES (?,?)').run(users.staff.id,'general-reception')
await new Promise(resolve=>server.listen(3006,'127.0.0.1',resolve))
let browser
try {
  browser=await browserDriver({directory:output})
  const {send,evaluate,waitFor,fill,click,screenshot}=browser
  const tab=async label=>{await evaluate(`(()=>{const trigger=document.querySelector('.staff-menu-trigger');if(trigger&&getComputedStyle(trigger).display!=='none')trigger.click()})()`);await evaluate(`[...document.querySelectorAll('.tabs button')].find(button=>button.textContent===${JSON.stringify(label)}).click()`)}
  const login=async(username,secret)=>{
    await click('.header-actions>.outline');await waitFor('.modal input[name=username]','Login form')
    await fill('input[name=username]',username);await fill('input[name=password]',secret);await evaluate('document.querySelector(".modal form").requestSubmit()');await waitFor('.staff .tabs','Staff cabinet')
  }
  await send('Page.navigate',{url:'http://127.0.0.1:3006/'})
  await waitFor('.header-actions>.outline','Home')
  await click('.header-actions>.outline');await click('.forgot-password')
  await fill('input[name=recoveryUsername]',users.staff.username);await evaluate('document.querySelector(".recovery-request").requestSubmit()')
  await waitFor('.modal [role=status]','Recovery confirmation')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM recovery_requests').get().n,1)
  await screenshot('recovery-request-mobile.png');await click('.modal .close')
  await login(users.admin.username,password);await tab('Қауіпсіздік')
  await waitFor('.recovery-list li','Recovery queue')
  await click('.recovery-list .text-button');await fill('input[name=adminPassword]','wrong')
  await evaluate('document.querySelector(".reset-issue").requestSubmit()')
  await waitFor('.recovery-admin [role=alert]','Wrong password feedback')
  assert.equal(await evaluate('Boolean(document.querySelector(".staff"))'),true)
  await fill('input[name=adminPassword]',password);await evaluate('document.querySelector(".reset-issue").requestSubmit()')
  await waitFor('.reset-link','Reset link issued')
  const link=await evaluate('document.querySelector(".reset-link").value')
  assert.ok(link.startsWith('http://127.0.0.1:3006/#reset='))
  await screenshot('admin-security-mobile.png')
  await click('.staff-heading>button');await waitFor('!document.querySelector(".staff")','Logout')
  await send('Page.navigate',{url:link});await waitFor('.password-reset','Reset screen')
  assert.equal(await evaluate('location.hash'),'#home','Token must be removed from the address bar')
  await fill('input[name=newPassword]',newPassword);await fill('input[name=confirmPassword]','Different password 12345')
  await evaluate('document.querySelector(".password-reset").requestSubmit()');await waitFor('.modal [role=alert]','Password mismatch')
  await fill('input[name=confirmPassword]',newPassword)
  await click('.modal .language-switch button[lang=ru]')
  assert.equal(await evaluate('document.querySelector("input[name=newPassword]").value'),newPassword)
  await screenshot('password-reset-ru-mobile.png')
  await evaluate('document.querySelector(".password-reset").requestSubmit()');await waitFor('.modal [role=status]','Reset completed')
  await click('.modal .primary');await waitFor('.modal input[name=username]','Login after reset')
  await fill('input[name=username]',users.staff.username);await fill('input[name=password]',newPassword)
  await evaluate('document.querySelector(".modal form").requestSubmit()');await waitFor('.staff .tabs','Employee login with reset password')
  assert.equal(await evaluate('document.querySelectorAll(".tabs button").length'),2)
  await tab('Безопасность');await fill('.password-change input[name=currentPassword]',newPassword);await fill('.password-change input[name=newPassword]',changedPassword);await fill('.password-change input[name=confirmPassword]',changedPassword)
  await evaluate('document.querySelector(".password-change").requestSubmit()');await waitFor('.modal input[name=username]','Password change signs out')
  assert.equal(await evaluate('document.querySelector(".modal [role=status]").textContent.includes("Пароль сохранён")'),true)
  await click('.modal .close');await click('.header-actions .language-switch button[lang=kk]')
  await login(users.admin.username,password);await tab('Жүйе күйі');await waitFor('.operations-panel .details','Operations status')
  await click('.operations-panel>.primary');await waitFor('[...document.querySelectorAll(".operations-panel [role=status]")].some(element=>element.textContent.includes("Сақтық көшірме жасалды және тұтастығы тексерілді."))','Manual backup feedback')
  const backup=operations.status().lastBackup;assert.ok(backup.verified);assert.equal(verifyDatabase(resolve(output,'backups',backup.file)).users,2)
  await screenshot('operations-mobile.png')
  await tab('Деректер шарттары');await waitFor('textarea[name=privacyKK]:enabled','Privacy editor')
  const initialPolicy=(await evaluate('fetch("/api/privacy").then(response=>response.json())')).policy
  await click('.privacy-editor button[value=draft]');await waitFor('.privacy-editor [role=status]','Draft saved')
  assert.equal((await evaluate('fetch("/api/privacy").then(response=>response.json())')).policy.version,initialPolicy.version)
  await click('input[name=privacyApproval]');await click('.privacy-editor button[value=publish]');await waitFor('.privacy-editor [role=alert]','Publishing requires organization details')
  await screenshot('privacy-draft-mobile.png')
  await tab('Ұйым баптаулары')
  await evaluate(`(()=>{const fields=document.querySelectorAll('.staff form input');const values=['Сынақ ұйымы','Сынақ мекенжайы','+77001112233'];fields.forEach((field,index)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,values[index]);field.dispatchEvent(new Event('input',{bubbles:true}))})})()`)
  await evaluate('document.querySelector(".staff form").requestSubmit()');await waitFor('.staff-workspace>[role=status]','Organization saved')
  await tab('Деректер шарттары');await waitFor('textarea[name=privacyKK]:enabled','Privacy reload')
  assert.equal(await evaluate('document.querySelector("textarea[name=privacyKK]").value.includes("ЖОБА")'),true,'Draft survives navigation')
  await fill('textarea[name=privacyKK]','Сынақ ұйымының бекітілген шарттары. '.repeat(20));await fill('textarea[name=privacyRU]','Утверждённые условия тестовой организации. '.repeat(20))
  await click('input[name=privacyApproval]');await click('.privacy-editor button[value=publish]');await waitFor('.privacy-editor [role=status]','Policy published')
  assert.equal((await evaluate('fetch("/api/privacy").then(response=>response.json())')).policy.approved,true)
  // Test the new screens in both languages and common phone/tablet/desktop widths.
  for(const label of ['Деректер шарттары','Жүйе күйі','Қауіпсіздік']) {
    await tab(label)
    await waitFor(label==='Деректер шарттары'?'textarea[name=privacyKK]:enabled':label==='Жүйе күйі'?'.operations-panel .details':'.password-change','Panel ready')
    await click('.header-actions .language-switch button[lang=ru]')
    for(const width of [320,375,390,412,768,1366]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false})
      assert.equal(await evaluate('document.documentElement.scrollWidth>document.documentElement.clientWidth'),false,`${label} overflow at ${width}`)
    }
    await screenshot(label==='Жүйе күйі'?'operations-ru-desktop.png':label==='Қауіпсіздік'?'security-ru-desktop.png':'privacy-ru-desktop.png')
    await click('.header-actions .language-switch button[lang=kk]')
  }
  await send('Page.navigate',{url:'http://127.0.0.1:3006/#booking'})
  await waitFor('document.querySelector("#department")?.options.length>1','Booking after publication')
  await fill('#department','general-reception');await waitFor('!document.querySelector(".calendar-trigger").disabled','Booking schedule')
  await fill('.booking input[autocomplete=name]','Келісім Сынақ');await fill('.booking input[name=phone]','7001112233');await fill('.booking textarea','Жаңартылған шарттармен жазылу сынағы')
  await click('.calendar-trigger')
  const nextDay=new Date(localDate()+'T00:00:00Z');nextDay.setUTCDate(nextDay.getUTCDate()+1)
  while([0,6].includes(nextDay.getUTCDay()))nextDay.setUTCDate(nextDay.getUTCDate()+1)
  const receptionDate=nextDay.toISOString().slice(0,10)
  for(let i=0;i<3&&!await evaluate(`Boolean(document.querySelector('[data-date="${receptionDate}"]'))`);i++)await click('.calendar-heading button:last-child')
  await click(`[data-date="${receptionDate}"]`);await waitFor('document.querySelector(".booking select:not(#department)").options.length>1','Booking times')
  await fill('.booking select:not(#department)','09:30');await click('.booking input[type=checkbox]');await evaluate('document.querySelector(".booking form").requestSubmit()')
  await waitFor('document.querySelector(".booking h2")?.textContent==="Мәліметтерді тексеріңіз"','Booking review')
  const updatedText='Сынақ ұйымының жаңартылған бекітілген шарттары. '.repeat(20),updatedRussian='Утверждённые обновлённые условия тестовой организации. '.repeat(20),updatedVersion=digest(JSON.stringify([updatedText.trim(),updatedRussian.trim()]))
  db.prepare('INSERT INTO privacy_policies VALUES (?,?,?,?,?)').run(updatedVersion,updatedText.trim(),updatedRussian.trim(),Date.now(),users.admin.id)
  await click('.booking .primary.wide');await waitFor('.booking [role=alert]','Changed consent rejected')
  assert.equal(await evaluate('document.querySelector(".booking input[type=checkbox]").checked'),false)
  assert.equal(await evaluate('document.querySelector(".booking input[autocomplete=name]").value'),'Келісім Сынақ')
  assert.equal(await evaluate('document.querySelector(".booking select:not(#department)").value'),'09:30')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM appointments').get().n,0)
  await click('.booking input[type=checkbox]');await evaluate('document.querySelector(".booking form").requestSubmit()');await waitFor('document.querySelector(".booking h2")?.textContent==="Мәліметтерді тексеріңіз"','Renewed consent review')
  await click('.booking .primary.wide');await waitFor('.receipt-code','Renewed consent accepted')
  assert.equal(db.prepare('SELECT consent_version FROM appointments').get().consent_version,updatedVersion)
  // Mobile/touch emulation is not a physical Android or iPhone/Safari test.
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true})
  await send('Emulation.setTouchEmulationEnabled',{enabled:true})
  await evaluate('location.hash="privacy"');await waitFor('.privacy-page .panel','Public privacy page')
  await click('.header-actions .language-switch button[lang=ru]')
  assert.equal(await evaluate('document.querySelector(".privacy-page .panel").textContent.startsWith("Утверждённые")'),true)
  assert.equal(await evaluate('document.documentElement.scrollWidth>document.documentElement.clientWidth'),false)
  await screenshot('privacy-public-touch.png')
  assert.equal(await evaluate('Object.keys(localStorage).some(key=>/password|reset|token/i.test(key))'),false)
  assert.deepEqual(browser.errors,[])
  const report={browser:process.env.CHROME_PATH?'Edge':'Chrome',recoveryRequest:true,adminReauthentication:true,oneTimeLinkUI:true,tokenRemovedFromURL:true,passwordMismatch:true,bilingualPasswordPreservation:true,staffPasswordChangeSignsOut:true,manualBackupVerified:true,privacyDraftPrivate:true,privacyDraftPersists:true,publicationValidated:true,bilingualPublishedPolicy:true,staleConsentRejected:true,renewedConsentPreservesForm:true,responsiveWidths:[320,375,390,412,768,1366],touchEmulation:true,physicalPhoneTest:false,runtimeErrors:0,artifacts:output}
  writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
} finally {
  browser?.close();operations.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close()
}
