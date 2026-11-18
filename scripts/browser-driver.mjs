import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export async function browserDriver({directory,debugPort=9226,width=390,executable=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'}) {
  mkdirSync(directory,{recursive:true})
  const browser=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${resolve(directory,'profile-'+randomUUID())}`,'about:blank'],{windowsHide:true,stdio:'ignore'})
  let spawnError=null,socket,sequence=0
  browser.once('error',error=>{spawnError=error})
  const pending=new Map(),errors=[]
  const close=()=>{for(const job of pending.values())clearTimeout(job.timer);socket?.close();browser.kill()}
  try {
    let targets
    for(let i=0;i<100;i++) {
      if(spawnError)throw spawnError
      try{targets=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();break}catch{await delay(100)}
    }
    if(!targets)throw Error('Browser did not start')
    socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl)
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
    socket.onmessage=({data})=>{
      const event=JSON.parse(data)
      if(event.id){const job=pending.get(event.id);if(!job)return;pending.delete(event.id);clearTimeout(job.timer);if(event.error)job.reject(Error(event.error.message));else job.resolve(event.result)}
      else if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text)
    }
    const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser timeout: '+method))},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})
    const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value}
    const waitFor=async(expression,label)=>{const predicate=expression.startsWith('.')||expression.startsWith('textarea[')?`document.querySelector(${JSON.stringify(expression)})`:expression;for(let i=0;i<120;i++){if(await evaluate(`Boolean(${predicate})`))return;await delay(100)}throw Error(label+'\n'+await evaluate('document.body.innerText.slice(-2200)'))}
    const fill=async(selector,value)=>{await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing field');const prototype=element instanceof HTMLSelectElement?HTMLSelectElement.prototype:element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event(element instanceof HTMLSelectElement?'change':'input',{bubbles:true}));})()`)}
    const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    const screenshot=async name=>{const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(directory,name),Buffer.from(shot.data,'base64'))}
    await send('Runtime.enable');await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false})
    return {send,evaluate,waitFor,fill,click,screenshot,errors,close}
  } catch(error){close();throw error}
}
