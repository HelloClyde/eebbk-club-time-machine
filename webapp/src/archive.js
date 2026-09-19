const root = import.meta.env.BASE_URL
import { renderLegacyContent } from './legacy-content'
let emoticons
let linkMap
let digestMap
let ratingsMap
function getRatings() {
  ratingsMap ||= fetch(`${root}archive/ratings.json.gz`).then(async r=>{
    if(!r.ok) throw new Error('评分记录加载失败')
    return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json()
  }).catch(e=>{ratingsMap=null;throw e})
  return ratingsMap
}
function getDigest() {
  digestMap ||= fetch(`${root}archive/digest.json.gz`).then(async r=>{
    if(!r.ok) throw new Error('精华状态加载失败')
    return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json()
  }).catch(e=>{digestMap=null;throw e})
  return digestMap
}
let manifest
let worker
let sequence=0
const pending=new Map()
async function getManifest() {
  manifest ||= fetch(`${root}archive/manifest.json`).then(r=>{if(!r.ok)throw new Error('归档数据尚未生成');return r.json()}).catch(e=>{manifest=null;throw e})
  return manifest
}
export async function archiveRequest(url) {
  const path=url.pathname.replace(/^.*\/api/, '')
  if (path === '/stats' || path === '/boards') {
    const data=await getManifest()
    return path==='/stats' ? data : {items:data.boards}
  }
  if (path === '/posts') {
    if(!url.searchParams.get('q') && !url.searchParams.get('board') && !url.searchParams.get('year') && Number(url.searchParams.get('page') || 1)===1) {
      const data=await getManifest()
      if(data.initial_items && url.searchParams.get('digest')!=='1' && url.searchParams.get('rated')!=='1') {
        const [digest,ratings]=await Promise.all([getDigest(),getRatings()])
        return {items:data.initial_items.map(r=>({...r,digest:digest[r.post_id] || null,rating_count:ratings[r.id]?.length || 0})),total:data.total_posts,page:1,page_size:30}
      }
    }
    if (!worker) {
      worker=new Worker(new URL('./archive-worker.js',import.meta.url),{type:'module'})
      worker.onmessage=({data})=>{const p=pending.get(data.id);if(p){pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.result)}}
      worker.onerror=()=>{for(const p of pending.values())p.reject(new Error('搜索加载失败，请刷新重试'));pending.clear()}
    }
    return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,params:Object.fromEntries(url.searchParams)})})
  }
  const id=Number(path.split('/').pop())
  const response=await fetch(`${root}archive/posts/${Math.floor(id/500)}.json.gz`)
  if(!response.ok) throw new Error('帖子数据加载失败')
  const data=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json()
  if(!data[id]) throw new Error('帖子不存在')
  data[id].digest=(await getDigest())[data[id].post_id] || null
  data[id].ratings=(await getRatings())[id] || []
  emoticons ||= fetch(`${root}emot/manifest.json`).then(r=>{if(!r.ok)throw new Error('表情资源加载失败');return r.json()}).then(names=>new Set(names)).catch(e=>{emoticons=null;throw e})
  linkMap ||= fetch(`${root}archive/link-map.json.gz`).then(async r=>{
    if(!r.ok) throw new Error('帖子链接映射加载失败，请刷新重试')
    return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json()
  }).catch(e=>{linkMap=null;throw e})
  const [names, signatures, links] = await Promise.all([
    emoticons,
    fetch(`${root}archive/signatures/${Math.floor(id/500)}.json.gz`).then(async r=>{
      if(!r.ok) throw new Error('签名数据加载失败，请刷新重试')
      return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json()
    }),
    linkMap,
  ])
  for(const [index,reply] of (data[id].replies_list || []).entries()) {
    reply.message_html=renderLegacyContent(reply.message_html,names,links)
    reply.signature_html=renderLegacyContent(signatures[id]?.[index] || '',names,links)
  }
  return data[id]
}
