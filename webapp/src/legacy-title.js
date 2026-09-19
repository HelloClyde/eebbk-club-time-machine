// Recover only recognized outer font wrappers; never render title HTML.
export function legacyTitle(value) {
  let text = String(value || '')
  let color
  for (let depth=0;depth<8;depth++) {
    const match = text.match(/^\s*(?:<font\s+color\s*=\s*["']?(#[\da-f]{6}|#[\da-f]{3}|[a-z]{3,20})["']?\s*>([\s\S]*?)<\/font\s*>?|font\s+color\s*=\s*["']?(#[\da-f]{6}|#[\da-f]{3})["']?([\s\S]*?)(?:\/font|font))\s*$/i)
    if (!match) break
    color = match[1] || match[3]
    text = match[2] ?? match[4]
  }
  return { text, color }
}
