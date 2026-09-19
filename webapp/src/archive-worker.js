const base = new URL(/* @vite-ignore */ '../', import.meta.url)
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
let catalog
let digest
const searches = new Map()
self.onmessage = async ({data: {id, params}}) => {
  try {
    catalog ||= await read('catalog.json.gz')
    if(!digest) {
      digest=await read('digest.json.gz')
      catalog=catalog.map(row=>({...row,digest:digest[row.post_id] || null}))
    }
    const q = (params.q || '').toLowerCase().trim()
    const scope = ['title', 'author', 'body'].includes(params.scope) ? params.scope : 'all'
    const metadataOnly = scope === 'title' || scope === 'author'
    const searchKey=JSON.stringify([q,scope,params.board,params.year,params.digest])
    const size=Number(params.page_size || 30), page=Number(params.page || 1)
    if(searches.has(searchKey)) {
      const matches=searches.get(searchKey)
      self.postMessage({id,result:{items:matches.slice((page-1)*size,page*size),total:matches.length,page,page_size:size}})
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
    let matches = catalog.filter(r => (!allowed || allowed.has(r.id)) && (!params.board || r.board === params.board) && (!params.year || r.publish_time.startsWith(params.year)))
    if(params.digest==='1') matches=matches.filter(r=>r.digest)
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
