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
const filterModule='data:text/javascript;base64,'+Buffer.from(await readFile('src/rating-filters.js','utf8')).toString('base64')
const worker=(await readFile('src/archive-worker.js','utf8')).replace("new URL(/* @vite-ignore */ '../', import.meta.url)","new URL('https://example.test/forum/')").replace('./rating-filters.js',filterModule)
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
for (const scope of ['title', 'author', 'body']) {
  for (const q of ['使命', '炒鸡飞侠', '飞']) {
    const params={q,scope,year:'2008',page:1,page_size:30}
    const fetchCount=requested.length
    const actual=await search(params)
    const script='import sqlite3,json; d=sqlite3.connect("data/forum.db"); q='+JSON.stringify(q)+'; print(json.dumps(d.execute("select id from posts where '+scope+' like ? and publish_time like ? order by publish_time desc,id desc",("%"+q+"%","2008%")).fetchall()))'
    const expected=JSON.parse(execFileSync('python',['-c',script],{encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}})).map(r=>r[0])
    assert.equal(actual.total,expected.length,`${scope}: ${q}`)
    assert.deepEqual(actual.items.map(r=>r.id),expected.slice(0,30))
    if(scope!=='body') {
      const fetched=requested.slice(fetchCount)
      assert.ok(fetched.some(path=>path.includes(`/search-${scope}/`)), 'must use dedicated field index')
      assert.ok(fetched.every(path=>path.includes(`/search-${scope}/`)), 'field search must not load body or general index shards')
    }
    const cachedCount=requested.length
    const next=await search({...params,page:2})
    assert.deepEqual(next.items.map(r=>r.id),expected.slice(30,60))
    assert.equal(requested.length,cachedCount,'scoped pagination must reuse cache')
    console.log(JSON.stringify({scope,q,total:actual.total}))
  }
}
const result=await search({year:'2008',board:'学习机',page:1,page_size:30})
assert.ok(result.items.every(r=>r.board==='学习机'&&r.publish_time.startsWith('2008')))
const gzip=await import('node:zlib')
const digestMap=JSON.parse(gzip.gunzipSync(await readFile(`${archive}/digest.json.gz`)))
const cat=JSON.parse(gzip.gunzipSync(await readFile(`${archive}/catalog.json.gz`)))
const ratings=JSON.parse(gzip.gunzipSync(await readFile(`${archive}/ratings.json.gz`)))
for(const reason of ['活动奖励','原创内容','鼓励分享','不存在的分类','']) {
  const expected=cat.filter(r=>(ratings[r.id]||[]).some(log=>String(log.reason??'').trim()===reason))
  const result=await search({rated:`reason:${reason}`,page:1,page_size:30})
  assert.equal(result.total,expected.length)
  assert.deepEqual(result.items.map(r=>r.id),expected.slice(0,30).map(r=>r.id))
}
for(const params of [{rated:'1'}, {rated:'1',year:'2008'}, {rated:'1',digest:'1'}]) {
  const expected=cat.filter(r=>ratings[r.id]?.length && (!params.year || r.publish_time.startsWith(params.year)) && (!params.digest || digestMap[r.post_id]))
  const actual=await search({...params,page:1,page_size:30})
  assert.equal(actual.total,expected.length)
  assert.deepEqual(actual.items.map(r=>r.id),expected.slice(0,30).map(r=>r.id))
  assert.ok(actual.items.every(r=>r.rating_count>0))
  const before=requested.length
  const next=await search({...params,page:2,page_size:30})
  assert.deepEqual(next.items.map(r=>r.id),expected.slice(30,60).map(r=>r.id))
  assert.equal(requested.length,before)
}
for(const year of ['', '2008']) {
  const expected=cat.filter(r=>digestMap[r.post_id] && (!year || r.publish_time.startsWith(year)))
  const actual=await search({digest:'1',year,page:1,page_size:30})
  assert.equal(actual.total,expected.length)
  assert.deepEqual(actual.items.map(r=>r.id),expected.slice(0,30).map(r=>r.id))
  assert.ok(actual.items.every(r=>r.digest?.snapshot || ['candidate_review','screenshot_confirmed'].includes(r.digest?.source)))
  const next=await search({digest:'1',year,page:2,page_size:30})
  assert.deepEqual(next.items.map(r=>r.id),expected.slice(30,60).map(r=>r.id))
}
const detail=JSON.parse(gzip.gunzipSync(await readFile(`${archive}/posts/314.json.gz`)))[157323]
assert.equal(detail.replies_list[0].message_html.match(/<img /g).length,2)
assert.ok(!JSON.stringify(detail).includes('local_html_path'))
async function bytes(dir){let n=0;for(const entry of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+entry.name;n+=entry.isDirectory()?await bytes(path):(await stat(path)).size}return n}
const size=await bytes('dist')
assert.ok(size<1_000_000_000,'Pages output exceeds 1 GB')
console.log(JSON.stringify({status:'PASS',bytes:size,posts:manifest.total_posts,failed_details:manifest.failed_details}))
globalThis.fetch=originalFetch
