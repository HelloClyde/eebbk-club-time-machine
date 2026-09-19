export function legacyTopicId(href) {
  try {
    const url = new URL(href, 'https://club.eebbk.com/bbkbbs/')
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'club.eebbk.com') return null
    let topic
    if (/^\/bbkbbs\/dispbbs\.asp$/i.test(url.pathname)) {
      for (const [key, value] of url.searchParams) if (key.toLowerCase() === 'id') { topic = value; break }
    } else {
      topic = url.pathname.match(/^\/article\/(\d+)\/?$/i)?.[1]
    }
    if (!topic || !/^\d+$/.test(topic)) return null
    const id = Number(topic)
    return Number.isSafeInteger(id) && id > 0 ? String(id) : null
  } catch { return null }
}

export function mapLegacyLink(href, mapping) {
  const topic = legacyTopicId(href)
  const record = topic && mapping[topic]
  return Number.isSafeInteger(record) && record > 0 ? `#post-${record}` : null
}
