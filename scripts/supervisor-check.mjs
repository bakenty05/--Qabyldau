import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

mkdirSync('.tmp',{recursive:true})
const directory=mkdtempSync(resolve('.tmp','supervisor-check-')),probe=createServer()
await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
const child=spawn(process.execPath,['scripts/supervise.mjs'],{windowsHide:true,env:{...process.env,PORT:String(port),STAFF_DB_PATH:resolve(directory,'staff.sqlite'),BACKUP_DIR:resolve(directory,'backups'),NODE_ENV:'development'},stdio:['ignore','pipe','pipe']})
const pids=[],events=[]
child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8')
let buffer=''
child.stdout.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){try{const event=JSON.parse(line);events.push(event);if(event.event==='server.spawned')pids.push(event.pid)}catch{/* Server startup text. */}}})
child.stderr.on('data',chunk=>{for(const line of chunk.split('\n')){try{events.push(JSON.parse(line))}catch{/* Node informational warnings. */}}})
const wait=async predicate=>{for(let i=0;i<200;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100))}throw Error('Supervisor check timed out')}
const healthy=async()=>{try{return (await(await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)})).json()).ok===true}catch{return false}}
try {
  await wait(healthy);assert.ok(pids[0]);assert.ok(readdirSync(resolve(directory,'backups')).some(name=>name.endsWith('.sqlite')))
  process.kill(pids[0])
  await wait(()=>pids.length>=2);await wait(healthy)
  assert.ok(events.some(event=>event.event==='server.restarting'));assert.notEqual(pids[0],pids[1])
  console.log(JSON.stringify({serverStarted:true,initialBackupCreated:true,crashDetected:true,serverRestarted:true,healthRecovered:true,isolatedDatabase:true}))
} finally {
  child.kill()
  for(const pid of pids)try{process.kill(pid)}catch{/* Already exited. */}
}
