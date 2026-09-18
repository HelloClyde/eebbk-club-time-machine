export function mapLegacyLink(href, mapping) {
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
    const record = mapping[String(Number(topic))]
    return Number.isSafeInteger(record) && record > 0 ? `#post-${record}` : null
  } catch { return null }
}
