import { createApp } from './app.mjs'
import { openStore } from './store.mjs'
import { createOperations } from './operations.mjs'
const db = openStore()
const operations = createOperations(db)
const { server } = createApp({db,operations})
const port = Number(process.env.PORT || 3001)
operations.start()
server.listen(port,process.env.HOST || '127.0.0.1',()=>console.log(`Е-Qabyldau: http://${process.env.HOST || '127.0.0.1'}:${port}`))
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{operations.stop();server.close(()=>{ db.close(); process.exit(0) })})
