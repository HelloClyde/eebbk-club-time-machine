import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
import {resolveThreadPage} from './src/thread-pages.js'
const read=name=>JSON.parse(gunzipSync(readFileSync(`public/archive/${name}`)))
const index=read('thread-pages.json.gz')
assert.equal(Object.keys(index.threads).length,291)
assert.equal(Object.keys(index.aliases).length,1305)
const route=resolveThreadPage(index,63093)
assert.equal(route.canonical,63090)
assert.equal(route.source,63090)
assert.equal(route.pages.length,13)
assert.equal(resolveThreadPage(index,63093,12).source,63093)
assert.equal(resolveThreadPage(index,63093,1000).page,13)
for(const [canonical,pages] of Object.entries(index.threads)) {
  assert.equal(pages[0][0],1)
  assert.equal(pages[0][1],Number(canonical))
  assert.deepEqual(pages.map(r=>r[0]),pages.map(r=>r[0]).sort((a,b)=>a-b))
  for(const [,id] of pages)assert.equal(resolveThreadPage(index,id).canonical,Number(canonical))
}
// Exercise the real archive detail loader, replacing only DOM rendering.
let source=readFileSync('src/archive.js','utf8').replace('import.meta.env.BASE_URL',JSON.stringify('/forum/'))
source=source.replace("import { renderLegacyContent, collectLegacyTopicIds } from './legacy-content'",'const renderLegacyContent=html=>html; const collectLegacyTopicIds=()=>[]')
for(const name of ['link-map-loader','thread-pages','rating-filters'])source=source.replace(`'./${name}'`,JSON.stringify(pathToFileURL(resolve(`src/${name}.js`)).href))
const requests=[]
globalThis.fetch=async input=>{
  const path=String(input)
  assert.ok(path.startsWith('/forum/'))
  requests.push(path)
  return new Response(readFileSync('public/'+path.slice('/forum/'.length)))
}
const {archiveRequest}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
const first=await archiveRequest(new URL('https://example.test/api/posts/63093'))
assert.equal(first.id,63090)
assert.equal(first.author,'zhangkan001')
assert.ok(first.replies_list[0].message.includes('性价比最高'))
assert.equal(first.thread_page,1)
assert.equal(first.thread_pages.length,13)
let floors=0
for(let page=1;page<=13;page++) {
  const detail=await archiveRequest(new URL(`https://example.test/api/posts/63090?page=${page}`))
  assert.equal(detail.id,63090)
  assert.equal(detail.author,'zhangkan001')
  assert.equal(detail.floor_offset,floors)
  const [,rid,count]=route.pages[page-1]
  const original=read(`posts/${Math.floor(rid/500)}.json.gz`)[rid]
  assert.deepEqual(detail.replies_list.map(r=>r.pid),original.replies_list.map(r=>r.pid))
  assert.equal(detail.replies_list.length,count)
  const signatures=read(`signatures/${Math.floor(rid/500)}.json.gz`)[rid]
  assert.equal(detail.replies_list[0].signature_html,signatures?.[0] || '')
  assert.deepEqual(detail.ratings,read('ratings.json.gz')[rid] || [])
  floors+=count
}
assert.equal(first.total_floors,floors)
assert.ok(!requests.some(p=>p.includes('/link-map')))
assert.equal(read('link-map.json.gz')['118020'],63090)
console.log(JSON.stringify({status:'PASS',canonical:63090,pages:13,floors,mergedTopics:291}))
