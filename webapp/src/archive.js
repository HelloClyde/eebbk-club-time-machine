const root = import.meta.env.BASE_URL
import { renderLegacyContent, collectLegacyTopicIds } from './legacy-content'
import { createLinkMapLoader } from './link-map-loader'
import { resolveThreadPage } from './thread-pages'
import { ratingCategories } from './rating-filters'
let emoticons
const loadLinkMap = createLinkMapLoader(root)
let digestMap
let ratingsMap
let threadPages
function getThreadPages() {
  threadPages ||= fetch(`${root}archive/thread-pages.json.gz`).then(async r=>{
    if(!r.ok)throw new Error('主题分页索引加载失败')
    return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json()
  }).catch(e=>{threadPages=null;throw e})
  return threadPages
}
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
  if(path==='/rating-categories') return {items:ratingCategories(await getRatings())}
  if (path === '/stats' || path === '/boards') {
    const data=await getManifest()
    return path==='/stats' ? data : {items:data.boards}
  }
  if (path === '/posts') {
    if(!url.searchParams.get('q') && !url.searchParams.get('board') && !url.searchParams.get('year') && Number(url.searchParams.get('page') || 1)===1) {
      const data=await getManifest()
      if(data.initial_items && url.searchParams.get('digest')!=='1' && !url.searchParams.get('rated')) {
        const [digest,ratings,threads]=await Promise.all([getDigest(),getRatings(),getThreadPages()])
        return {items:data.initial_items.map(r=>({...r,digest:digest[r.post_id] || null,rating_count:(threads.threads[r.id] || [[1,r.id]]).reduce((sum,[,rid])=>sum+(ratings[rid]?.length || 0),0)})),total:data.total_posts,page:1,page_size:30}
      }
    }
    if (!worker) {
      worker=new Worker(new URL('./archive-worker.js',import.meta.url),{type:'module'})
      worker.onmessage=({data})=>{const p=pending.get(data.id);if(p){pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve(data.result)}}
      worker.onerror=()=>{for(const p of pending.values())p.reject(new Error('搜索加载失败，请刷新重试'));pending.clear()}
    }
    return new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,params:Object.fromEntries(url.searchParams)})})
  }
  const route=resolveThreadPage(await getThreadPages(),Number(path.split('/').pop()),url.searchParams.get('page'))
  const id=route.source
  const response=await fetch(`${root}archive/posts/${Math.floor(id/500)}.json.gz`)
  if(!response.ok) throw new Error('帖子数据加载失败')
  const data=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json()
  if(!data[id]) throw new Error('帖子不存在')
  let main=data[route.canonical]
  if(!main) {
    const r=await fetch(`${root}archive/catalog/${Math.floor(route.canonical/500)}.json.gz`)
    if(!r.ok)throw new Error('主题信息加载失败')
    main=(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json())[route.canonical]
  }
  for(const key of ['id','post_id','title','author','publish_time','board'])data[id][key]=main[key]
  Object.assign(data[id],{thread_page:route.page,thread_pages:route.pages.map(([number])=>number),floor_offset:route.offset,total_floors:route.total || data[id].replies_list.length})
  data[id].digest=(await getDigest())[data[id].post_id] || null
  data[id].ratings=(await getRatings())[id] || []
  emoticons ||= fetch(`${root}emot/manifest.json`).then(r=>{if(!r.ok)throw new Error('表情资源加载失败');return r.json()}).then(names=>new Set(names)).catch(e=>{emoticons=null;throw e})
  const [names, signatures] = await Promise.all([
    emoticons,
    fetch(`${root}archive/signatures/${Math.floor(id/500)}.json.gz`).then(async r=>{
      if(!r.ok) throw new Error('签名数据加载失败，请刷新重试')
      return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json()
    }),
  ])
  const contents=(data[id].replies_list || []).flatMap((reply,index)=>[reply.message_html, signatures[id]?.[index]])
  const links=await loadLinkMap(collectLegacyTopicIds(contents))
  for(const [index,reply] of (data[id].replies_list || []).entries()) {
    reply.message_html=renderLegacyContent(reply.message_html,names,links)
    reply.signature_html=renderLegacyContent(signatures[id]?.[index] || '',names,links)
  }
  return data[id]
}
