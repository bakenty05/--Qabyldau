import { createApp } from './app.mjs'
const { server, db } = createApp()
const port = Number(process.env.PORT || 3001)
server.listen(port,process.env.HOST || '127.0.0.1',()=>console.log(`Е-Qabyldau: http://${process.env.HOST || '127.0.0.1'}:${port}`))
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(()=>{ db.close(); process.exit(0) }))
