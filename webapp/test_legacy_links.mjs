import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { mapLegacyLink } from './src/legacy-links.js'
import { legacyTopicId } from './src/legacy-links.js'
import { createLinkMapLoader } from './src/link-map-loader.js'
const mapping=JSON.parse(gunzipSync(readFileSync('public/archive/link-map.json.gz')))
for (const url of [
  'http://club.eebbk.com/bbkbbs/dispbbs.asp?boardid=4&Id=233951',
  'https://club.eebbk.com/bbkbbs/DISPBBS.ASP?ID=233951&page=2',
  'dispbbs.asp?id=233951',
  '/bbkbbs/dispbbs.asp?id=233951',
  '//club.eebbk.com/article/233951',
]) assert.equal(mapLegacyLink(url,mapping),'#post-171544')
for (const url of [
  'https://example.com/bbkbbs/dispbbs.asp?id=233951',
  'https://club.eebbk.com.evil.test/bbkbbs/dispbbs.asp?id=233951',
  'javascript:alert(1)',
  'https://club.eebbk.com/bbkbbs/dispbbs.asp?id=9999999999',
  'https://club.eebbk.com/bbkbbs/dispbbs.asp?id=abc',
  'https://club.eebbk.com/bbkbbs/upload/a.rar',
]) assert.equal(mapLegacyLink(url,mapping),null)
const catalog=JSON.parse(gunzipSync(readFileSync('public/archive/catalog.json.gz')))
const rows=new Map(catalog.map(row=>[row.id,row]))
for(const [topic,id] of Object.entries(mapping)) assert.equal(String(Number(rows.get(id).post_id)),topic)
console.log(`PASS: ${Object.keys(mapping).length} mappings; relative, case-insensitive, external and missing links`)
const reconstructed={}
let minBytes=Infinity,maxBytes=0,totalBytes=0
for(let bucket=0;bucket<256;bucket++) {
  const buffer=readFileSync(`public/archive/link-map/${bucket}.json.gz`)
  const shard=JSON.parse(gunzipSync(buffer))
  for(const topic of Object.keys(shard))assert.equal(Number(topic)%256,bucket)
  Object.assign(reconstructed,shard)
  minBytes=Math.min(minBytes,buffer.length);maxBytes=Math.max(maxBytes,buffer.length);totalBytes+=buffer.length
}
assert.deepEqual(reconstructed,mapping,'all shards preserve mapping and duplicate-record selection')
const requested=[]
const loader=createLinkMapLoader('/forum/',async path=>{
  assert.match(path,/^\/forum\/archive\/link-map\/\d+\.json\.gz$/)
  requested.push(path)
  return new Response(readFileSync('public/'+path.slice('/forum/'.length)))
})
assert.deepEqual(await loader([]),{})
assert.equal(requested.length,0,'no old links: no network requests')
assert.deepEqual(await loader([legacyTopicId('https://example.com/article/233951')]),{})
assert.equal(requested.length,0,'external links need no mapping')
const ids=['233951','233951','234207','9999999999']
const [first,concurrent]=await Promise.all([loader(ids),loader(ids)])
assert.equal(requested.length,2,'same bucket and concurrent requests must deduplicate')
assert.deepEqual(first,concurrent)
assert.equal(mapLegacyLink('dispbbs.asp?Id=233951',first),'#post-171544')
assert.equal(mapLegacyLink('dispbbs.asp?Id=9999999999',first),null)
await loader(ids)
assert.equal(requested.length,2,'reuse cached shards')
let attempts=0
const retry=createLinkMapLoader('/forum/',async path=>{
  if(++attempts===1)return new Response('',{status:503})
  return new Response(readFileSync('public/'+path.slice('/forum/'.length)))
})
await assert.rejects(retry(['233951']),/映射加载失败/)
assert.equal((await retry(['233951']))['233951'],171544)
assert.equal(attempts,2)
assert.ok(!readFileSync('src/archive.js','utf8').includes('archive/link-map.json.gz'),'detail must not load monolithic map')
console.log(JSON.stringify({shards:256,minBytes,maxBytes,averageBytes:Math.round(totalBytes/256),status:'PASS'}))
