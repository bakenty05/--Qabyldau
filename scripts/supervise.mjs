import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

// Own and restart only the server process created here.
const port=Number(process.env.PORT||3001)
if(!Number.isInteger(port)||port<1||port>65535) throw new Error('PORT дұрыс емес.')
let child=null,stopping=false,restartTimer=null,healthTimer=null,failures=0,attempts=0,startedAt=0
function launch() {
  if(stopping)return
  startedAt=Date.now();failures=0
  child=spawn(process.execPath,['--env-file-if-exists=.env',resolve('server/start.mjs')],{stdio:'inherit',windowsHide:true,env:process.env})
  const current=child
  current.once('spawn',()=>console.log(JSON.stringify({event:'server.spawned',pid:current.pid})))
  current.once('error',error=>console.error(JSON.stringify({event:'server.spawn-error',code:error.code})))
  current.once('exit',code=>{
    clearInterval(healthTimer)
    if(stopping)return
    attempts=Date.now()-startedAt>60000?1:attempts+1
    if(attempts>=10){console.error('Сервер 10 рет іске қосылмады. Порт пен баптауларды тексеріңіз.');process.exitCode=1;return}
    const delay=Math.min(30000,1000*2**Math.min(attempts,5))
    console.error(JSON.stringify({event:'server.restarting',code,delay}))
    restartTimer=setTimeout(launch,delay)
  })
  let checking=false
  healthTimer=setInterval(async()=>{
    if(stopping||checking)return
    checking=true
    try {
      const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(5000)})
      if(!response.ok || (await response.json()).ok!==true) throw new Error('unhealthy')
      failures=0
    } catch {
      failures++
      console.error(JSON.stringify({event:'server.health-failed',failures}))
      if(failures>=3 && child===current) current.kill()
    } finally {checking=false}
  },20000)
}
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{
  if(stopping)return
  stopping=true;clearTimeout(restartTimer);clearInterval(healthTimer)
  child?.kill()
})
launch()
