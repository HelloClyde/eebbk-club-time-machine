const base = new URL(/* @vite-ignore */ '../', import.meta.url)
import { matchesRating } from './rating-filters.js'
const cache = new Map()
async function read(path) {
  if (!cache.has(path)) {
    const promise = fetch(new URL(`archive/${path}`, base)).then(async r => {
      if (!r.ok) throw new Error('静态归档读取失败，请稍后重试')
      return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json()
    }).catch(e => { cache.delete(path); throw e })
    cache.set(path, promise)
    if (cache.size > 48) cache.delete(cache.keys().next().value)
  }
  return cache.get(path)
}
let catalogManifest
async function browseRows(params) {
  catalogManifest ||= await read('catalog-manifest.json.gz')
  const groups=catalogManifest.filter(g=>(!params.board || g.board===params.board) && (!params.year || g.year===params.year))
  const rows=[]
  for(let i=0;i<groups.length;i+=6) {
    await Promise.all(groups.slice(i,i+6).map(async g=>rows.push(...await read(g.path))))
  }
  return rows
}
async function metadata(ids) {
  const chunks=[...new Set(ids.map(id=>Math.floor(id/500)))]
  const rows=new Map()
  for(let i=0;i<chunks.length;i+=6) {
    await Promise.all(chunks.slice(i,i+6).map(async chunk=>{
      const data=await read(`catalog/${chunk}.json.gz`)
      for(const row of Object.values(data)) rows.set(row.id,row)
    }))
  }
  return ids.map(id=>rows.get(id)).filter(Boolean).map(row=>({...row,rating_count:ratings[row.id]?.length || 0,digest:digest[row.post_id] || null}))
}
let digest
let ratings
const searches = new Map()
self.onmessage = async ({data: {id, params}}) => {
  try {
    ratings ||= await read('ratings.json.gz')
    digest ||= await read('digest.json.gz')
    const q = (params.q || '').toLowerCase().trim()
    const scope = ['title', 'author', 'body'].includes(params.scope) ? params.scope : 'all'
    const metadataOnly = scope === 'title' || scope === 'author'
    const searchKey=JSON.stringify([q,scope,params.board,params.year,params.digest,params.rated])
    const size=Number(params.page_size || 30), page=Number(params.page || 1)
    if(searches.has(searchKey)) {
      const matches=searches.get(searchKey)
      const slice=matches.slice((page-1)*size,page*size)
      self.postMessage({id,result:{items:q ? slice : await metadata(slice),total:matches.length,page,page_size:size}})
      return
    }
    if(!q) {
      const rows=await browseRows(params)
      const matches=rows.filter(([rid,,original])=>(params.digest!=='1' || digest[original]) && (!params.rated || matchesRating(ratings[rid],params.rated))).sort((a,b)=>a[1]-b[1]).map(r=>r[0])
      searches.set(searchKey,matches)
      if(searches.size>10)searches.delete(searches.keys().next().value)
      self.postMessage({id,result:{items:await metadata(matches.slice((page-1)*size,page*size)),total:matches.length,page,page_size:size}})
      return
    }
    let allowed = null
    if (q) {
      const chars = Array.from(q)
      const terms = [...new Set(chars.length === 1 ? chars : chars.slice(0,-1).map((c,i)=>c+chars[i+1]))].filter(t=>t.trim())
      const lists = []
      for (const term of terms) {
        const bucket = Array.from(term).reduce((n,c)=>n+c.codePointAt(0),0)%256
        const directory = metadataOnly ? `search-${scope}` : 'search'
        lists.push((await read(`${directory}/${bucket}.json.gz`))[term] || [])
      }
      lists.sort((a,b)=>a.length-b.length)
      allowed = new Set(lists.shift() || [])
      for (const list of lists) { const next=new Set(list); allowed=new Set([...allowed].filter(x=>next.has(x))) }
    }
    if(params.board || params.year || params.digest==='1' || params.rated) {
      const rows=await browseRows(params)
      allowed=new Set(rows.filter(([rid,,original])=>allowed.has(rid) && (params.digest!=='1' || digest[original]) && (!params.rated || matchesRating(ratings[rid],params.rated))).map(r=>r[0]))
    }
    let matches = (await metadata([...allowed])).filter(r => (!params.board || r.board === params.board) && (!params.year || r.publish_time.startsWith(params.year)))
    matches.sort((a,b)=>a.publish_time===b.publish_time ? b.id-a.id : a.publish_time>b.publish_time ? -1 : 1)
    if(params.digest==='1') matches=matches.filter(r=>r.digest)
    if(params.rated) matches=matches.filter(r=>matchesRating(ratings[r.id],params.rated))
    if (q && metadataOnly) matches = matches.filter(r => (r[scope] || '').toLowerCase().includes(q))
    if (q && (scope === 'body' || (!metadataOnly && Array.from(q).length > 2))) {
      const verified=[]
      const groups=new Map()
      for(const row of matches) {const chunk=Math.floor(row.id/500);if(!groups.has(chunk))groups.set(chunk,[]);groups.get(chunk).push(row)}
      const tasks=[...groups.entries()]
      for(let i=0;i<tasks.length;i+=6) {
        await Promise.all(tasks.slice(i,i+6).map(async ([chunk,rows])=>{
          const texts=await read(`texts/${chunk}.json.gz`)
          for(const row of rows) {
            const fields = texts[row.id]
            if(scope === 'body' ? (fields[3] || '').includes(q) : fields.some(field=>field.includes(q))) verified.push(row)
          }
        }))
      }
      const ids=new Set(verified.map(r=>r.id));matches=matches.filter(r=>ids.has(r.id))
    }
    searches.set(searchKey,matches)
    if(searches.size>10)searches.delete(searches.keys().next().value)
    self.postMessage({id, result:{items:matches.slice((page-1)*size,page*size),total:matches.length,page,page_size:size}})
  } catch(e) { self.postMessage({id,error:e.message}) }
}
