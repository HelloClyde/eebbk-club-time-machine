// Run after export and build: node verify_static.mjs
import { readFile, readdir, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const archive=resolve('public/archive')
const manifest=JSON.parse(await readFile(`${archive}/manifest.json`,'utf8'))
assert.equal(manifest.total_posts,265908)
assert.equal(manifest.archived_pages,267213)
const gzip=await import('node:zlib')
const threads=JSON.parse(gzip.gunzipSync(await readFile(`${archive}/thread-pages.json.gz`)))
const rawCatalog=JSON.parse(gzip.gunzipSync(await readFile(`${archive}/catalog.json.gz`)))
const cat=rawCatalog.filter(r=>!threads.aliases[r.id])
async function expectedSearch(q,scope='all',year='') {
  let matched=new Set()
  if(!q)matched=new Set(cat.map(r=>r.id))
  else {
    if(scope==='all' || scope==='body') {
      const script='import sqlite3,json; d=sqlite3.connect("data/forum.db"); q='+JSON.stringify(q)+'; print(json.dumps(d.execute("select id from posts where body like ?",("%"+q+"%",)).fetchall()))'
      for(const [id] of JSON.parse(execFileSync('python',['-c',script],{encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}})))matched.add(threads.aliases[id] || id)
    }
    if(scope!=='body') for(const r of cat) {
      const fields=scope==='all' ? ['title','author','board'] : [scope]
      if(fields.some(f=>(r[f] || '').toLowerCase().includes(q.toLowerCase())))matched.add(r.id)
    }
  }
  return cat.filter(r=>matched.has(r.id) && (!year || r.publish_time.startsWith(year))).map(r=>r.id)
}
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
const coldStart=await search({year:'2008',page:1,page_size:30})
const coldFiles=requested.slice()
let coldBytes=0, metadataBytes=0
for(const path of coldFiles) {
  const size=(await stat(`${archive}/${path.slice('/forum/archive/'.length)}`)).size
  coldBytes+=size
  if(path.includes('/catalog/') || path.includes('/browse/') || path.endsWith('/catalog-manifest.json.gz'))metadataBytes+=size
}
assert.ok(coldBytes<1_000_000, '2008 cold browsing must stay below 1 MB of archive transfers')
assert.ok(coldFiles.filter(p=>p.includes('/catalog/')).length<10,'load only current page metadata')
console.log(JSON.stringify({cold2008:{bytes:coldBytes,metadataBytes,requests:coldFiles.length}}))
for(const q of ['', '使命', '炒鸡飞侠', '" OR 1=1 --']){
  const t=performance.now()
  const result=await search({q,page:1,page_size:30})
  const expected=await expectedSearch(q)
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
    const expected=await expectedSearch(q,scope,'2008')
    assert.equal(actual.total,expected.length,`${scope}: ${q}`)
    assert.deepEqual(actual.items.map(r=>r.id),expected.slice(0,30))
    if(scope!=='body') {
      const fetched=requested.slice(fetchCount)
      assert.ok(fetched.some(path=>path.includes(`/search-${scope}/`)), 'must use dedicated field index')
      assert.ok(fetched.every(path=>!path.includes('/texts/') && !path.includes('/search/')), 'field search must not load body or general index shards')
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
for(const params of [
  {q:'6988年终总结',scope:'title'},
  {q:'6988年终总结',scope:'title',year:'2008'},
  {q:'是512MB',scope:'body',year:'2007'},
  {q:'卡住555',scope:'author'},
]) {
  const actual=await search({...params,page:1,page_size:30})
  const expected=await expectedSearch(params.q,params.scope,params.year || '')
  assert.equal(actual.total,expected.length)
  assert.deepEqual(actual.items.map(r=>r.id),expected.slice(0,30))
  assert.ok(actual.items.every(r=>!threads.aliases[r.id]))
  if(params.q==='6988年终总结')assert.equal(actual.total,params.year ? 0 : 1)
  if(params.q==='是512MB')assert.ok(actual.items.some(r=>r.id===63090))
}
const digestMap=JSON.parse(gzip.gunzipSync(await readFile(`${archive}/digest.json.gz`)))
const collection=JSON.parse(await readFile('digest-collection.json','utf8'))
assert.equal(Object.keys(collection).length,47)
for(const [topic,evidence] of Object.entries(collection)) {
  assert.ok(digestMap[topic], `Missing collected digest ${topic}`)
  assert.equal(evidence.collection_id,176886)
  assert.equal(evidence.floor,1)
}
assert.deepEqual(coldStart.items.map(r=>r.id),cat.filter(r=>r.publish_time.startsWith('2008')).slice(0,30).map(r=>r.id))
for(const params of [{year:'2008'}, {board:cat[0].board}, {year:'2008',board:cat.find(r=>r.publish_time.startsWith('2008')).board}, {year:'1900'}]) {
  const expected=cat.filter(r=>(!params.year || r.publish_time.startsWith(params.year)) && (!params.board || r.board===params.board))
  for(const page of [1,2,Math.max(1,Math.ceil(expected.length/30))]) {
    const actual=await search({...params,page,page_size:30})
    assert.equal(actual.total,expected.length)
    assert.deepEqual(actual.items.map(r=>r.id),expected.slice((page-1)*30,page*30).map(r=>r.id))
  }
}
const rawRatings=JSON.parse(gzip.gunzipSync(await readFile(`${archive}/ratings.json.gz`)))
const ratings={}
for(const [id,logs] of Object.entries(rawRatings)) (ratings[threads.aliases[id] || id] ||= []).push(...logs)
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
  assert.ok(requested.slice(before).every(path=>path.includes('/catalog/')), 'browsing pagination may load only metadata shards')
}
for(const year of ['', '2008']) {
  const expected=cat.filter(r=>digestMap[r.post_id] && (!year || r.publish_time.startsWith(year)))
  const actual=await search({digest:'1',year,page:1,page_size:30})
  assert.equal(actual.total,expected.length)
  assert.deepEqual(actual.items.map(r=>r.id),expected.slice(0,30).map(r=>r.id))
  assert.ok(actual.items.every(r=>r.digest?.snapshot || ['candidate_review','screenshot_confirmed','collection'].includes(r.digest?.source)))
  const next=await search({digest:'1',year,page:2,page_size:30})
  assert.deepEqual(next.items.map(r=>r.id),expected.slice(30,60).map(r=>r.id))
}
const detail=JSON.parse(gzip.gunzipSync(await readFile(`${archive}/posts/314.json.gz`)))[157323]
assert.ok(requested.every(path=>!path.endsWith('/catalog.json.gz')), 'never download the monolithic catalog')
assert.equal(detail.replies_list[0].message_html.match(/<img /g).length,2)
assert.ok(!JSON.stringify(detail).includes('local_html_path'))
async function bytes(dir){let n=0;for(const entry of await readdir(dir,{withFileTypes:true})){const path=dir+'/'+entry.name;n+=entry.isDirectory()?await bytes(path):(await stat(path)).size}return n}
const size=await bytes('dist')
assert.ok(size<1_000_000_000,'Pages output exceeds 1 GB')
console.log(JSON.stringify({status:'PASS',bytes:size,posts:manifest.total_posts,failed_details:manifest.failed_details}))
globalThis.fetch=originalFetch
