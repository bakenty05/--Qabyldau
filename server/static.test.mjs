import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { createApp } from './app.mjs'
import { openStore } from './store.mjs'

test('static assets compress correctly, respect gzip refusal, and preserve HEAD and error responses', async t => {
  const directory = mkdtempSync(join(tmpdir(),'qabyldau-static-'))
  const content = 'console.log("Қабылдау");\n'.repeat(500)
  writeFileSync(join(directory,'app.js'),content)
  writeFileSync(join(directory,'index.html'),'<html>Қабылдау</html>')
  const { server, db } = createApp({ db:openStore(':memory:'), staticDir:directory })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();unlinkSync(join(directory,'app.js'));unlinkSync(join(directory,'index.html'));rmdirSync(directory)})
  async function request(path, encoding, method='GET') {
    return new Promise((resolve,reject)=>{
      const req=get({hostname:'127.0.0.1',port:server.address().port,path,method,headers:encoding?{'Accept-Encoding':encoding}:{}},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}))
      });req.on('error',reject)
    })
  }
  const zipped=await request('/app.js','gzip')
  assert.equal(zipped.status,200)
  assert.equal(zipped.headers['content-encoding'],'gzip')
  assert.equal(zipped.headers.vary,'Accept-Encoding')
  assert.equal(gunzipSync(zipped.body).toString(),content)
  assert.ok(zipped.body.length<Buffer.byteLength(content)/2)
  for (const encoding of [undefined,'gzip;q=0','br, gzip; q=0.00']) {
    const identity=await request('/app.js',encoding)
    assert.equal(identity.headers['content-encoding'],undefined)
    assert.equal(identity.body.toString(),content)
  }
  const head=await request('/app.js','gzip','HEAD')
  assert.equal(head.body.length,0)
  assert.equal(Number(head.headers['content-length']),zipped.body.length)
  const page=await request('/','gzip')
  assert.equal(page.headers['cache-control'],'no-cache')
  assert.equal(gunzipSync(page.body).toString(),'<html>Қабылдау</html>')
  const missing=await request('/missing.js','gzip')
  assert.equal(missing.status,404)
  assert.equal(missing.headers['content-encoding'],undefined)
  assert.ok(JSON.parse(missing.body).error)
})
