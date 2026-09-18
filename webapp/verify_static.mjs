// Run after export and build: node verify_static.mjs
import { readFile, readdir, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const archive=resolve('public/archive')
const manifest=JSON.parse(await readFile(`${archive}/manifest.json`,'utf8'))
assert.equal(manifest.total_posts,267213)
const originalFetch=globalThis.fetch
const requested=[]
globalThis.fetch=async input=>{
  const url=new URL(input)
  assert.equal(url.origin,'https://example.test')
  assert.ok(url.pathname.startsWith('/forum/archive/'),'must retain GitHub project subdirectory')
  requested.push(url.pathname)
  const path=url.pathname.slice('/forum/archive/'.length)
  return new Response(await readFile(`${archive}/${path}`))
}
let complete
globalThis.self={postMessage:result=>complete(result)}
const worker=(await readFile('src/archive-worker.js','utf8')).replace("new URL(/* @vite-ignore */ '../', import.meta.url)","new URL('https://example.test/forum/')")
await import('data:text/javascript;base64,'+Buffer.from(worker).toString('base64'))
async function search(params){
  return new Promise((resolve,reject)=>{complete=reply=>reply.error?reject(new Error(reply.error)):resolve(reply.result);self.onmessage({data:{id:1,params}})})
}
for(const q of ['', '使命', '炒鸡飞侠', '" OR 1=1 --']){
  const t=performance.now()
  const result=await search({q,page:1,page_size:30})
  const script='import sqlite3,json; d=sqlite3.connect("data/forum.db"); q='+JSON.stringify(q)+'; p="%"+q+"%"; print(json.dumps(d.execute("select id from posts where title like ? or author like ? or board like ? or body like ? order by publish_time desc,id desc",(p,p,p,p)).fetchall()))'
  const expected=JSON.parse(execFileSync('python',['-c',script],{encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}})).map(x=>x[0])
  assert.equal(result.total,expected.length,q)
  assert.deepEqual(result.items.map(r=>r.id),expected.slice(0,30),q)
  console.log(JSON.stringify({q,total:result.total,ms:Math.round(performance.now()-t)}))
}
const before=requested.length
await search({q:'使命',page:2,page_size:30})
assert.equal(requested.length,before,'cached pagination should not fetch again')
const result=await search({year:'2008',board:'学习机',page:1,page_size:30})
assert.ok(result.items.every(r=>r.board==='学习机'&&r.publish_time.startsWith('2008')))
const gzip=await import('node:zlib')
const detail=JSON.parse(gzip.gunzipSync(await readFile(`${archive}/posts/314.json.gz`)))[157323]
assert.equal(detail.replies_list[0].message_html.match(/<img /g).length,2)
assert.ok(!JSON.stringify(detail).includes('local_html_path'))
async function bytes(dir){let n=0;for(const entry of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+entry.name;n+=entry.isDirectory()?await bytes(path):(await stat(path)).size}return n}
const size=await bytes('dist')
assert.ok(size<1_000_000_000,'Pages output exceeds 1 GB')
console.log(JSON.stringify({status:'PASS',bytes:size,posts:manifest.total_posts,failed_details:manifest.failed_details}))
globalThis.fetch=originalFetch
