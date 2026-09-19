export const ratingReason = log => String(log.reason ?? '').trim()
export function ratingCategories(ratings) {
  const counts=new Map()
  for(const logs of Object.values(ratings)) {
    for(const reason of new Set(logs.map(ratingReason))) counts.set(reason,(counts.get(reason)||0)+1)
  }
  return [...counts].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],'zh-CN')).map(([reason,count])=>({value:`reason:${reason}`,label:reason || '理由未收录',count}))
}
export function matchesRating(logs, filter) {
  if(!filter)return true
  if(filter==='1')return !!logs?.length
  return filter.startsWith('reason:') && !!logs?.some(log=>ratingReason(log)===filter.slice(7))
}
