// Keep only recently used shards; failed downloads may be retried.
export function createLinkMapLoader(root, fetcher = (...args) => fetch(...args)) {
  const cache = new Map()
  function read(bucket) {
    if (!cache.has(bucket)) {
      const promise = fetcher(`${root}archive/link-map/${bucket}.json.gz`).then(async response => {
        if (!response.ok) throw new Error('帖子链接映射加载失败，请刷新重试')
        return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json()
      }).catch(error => { cache.delete(bucket); throw error })
      cache.set(bucket, promise)
      if (cache.size > 32) cache.delete(cache.keys().next().value)
    }
    return cache.get(bucket)
  }
  return async function load(ids) {
    const topics = [...new Set(ids)].filter(id => /^\d+$/.test(String(id)) && Number.isSafeInteger(Number(id)) && Number(id) > 0)
    const buckets = [...new Set(topics.map(id => Number(id) % 256))]
    const shards = new Map()
    for (let i = 0; i < buckets.length; i += 6) {
      await Promise.all(buckets.slice(i, i + 6).map(async bucket => shards.set(bucket, await read(bucket))))
    }
    const mapping = {}
    for (const topic of topics) {
      const key = String(Number(topic))
      const record = shards.get(Number(topic) % 256)[key]
      if (Number.isSafeInteger(record) && record > 0) mapping[key] = record
    }
    return mapping
  }
}
