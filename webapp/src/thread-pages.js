export function resolveThreadPage(index, id, page = 1) {
  const canonical = index.aliases[id] || id
  const pages = index.threads[canonical] || [[1, canonical, 0]]
  const current = Math.max(1, Math.min(pages.length, Math.floor(Number(page)) || 1))
  return { canonical, source: pages[current - 1][1], page: current, pages,
    offset: pages.slice(0, current - 1).reduce((sum, row) => sum + row[2], 0),
    total: pages.reduce((sum, row) => sum + row[2], 0) }
}
