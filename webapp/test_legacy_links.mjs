import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { mapLegacyLink } from './src/legacy-links.js'
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
