// Only transform text nodes of already-sanitized archive HTML, never attributes.
import { mapLegacyLink } from './legacy-links'
export function renderLegacyContent(html, names, links = {}) {
  const template = document.createElement('template')
  template.innerHTML = html || ''
  // Migrated Dvbbs quotes used three nested divs and a back.gif marker.
  // Their background styles were stripped by the sanitizer; source indentation
  // must not be rendered as preformatted whitespace inside the quote.
  for (const marker of template.content.querySelectorAll('img[src]')) {
    let source
    try { source = new URL(marker.getAttribute('src')) } catch { continue }
    if (source.hostname !== 'static.eebbk.com' || source.pathname !== '/img/club/bbkbbs/back.gif') continue
    let quote = marker.parentElement
    if (quote?.tagName !== 'DIV' || !/引用[\s\S]*的发言/.test(quote.textContent)) continue
    for (let level=0;level<2;level++) {
      const parent=quote.parentElement
      if (parent?.tagName !== 'DIV' || parent.children.length !== 1 || [...parent.childNodes].some(n=>n.nodeType===3 && n.textContent.trim())) break
      quote=parent
    }
    quote.classList.add('legacy-quote')
    quote.setAttribute('role', 'blockquote')
    marker.remove()
  }
  for (const anchor of template.content.querySelectorAll('a[href]')) {
    const mapped = mapLegacyLink(anchor.getAttribute('href'), links)
    if (mapped) {
      anchor.setAttribute('href', mapped)
      anchor.removeAttribute('target')
      anchor.title = '打开本站存档'
    }
  }
  const urlFor = name => `${import.meta.env.BASE_URL}emot/${name}.gif`
  for (const img of template.content.querySelectorAll('img')) {
    const match = (img.getAttribute('src') || '').match(/\/emot\/(em\d+)\.gif(?:[?#].*)?$/i)
    if (match && names.has(match[1].toLowerCase())) {
      img.src = urlFor(match[1].toLowerCase())
      img.classList.add('legacy-emoticon')
    }
  }
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  const nodes=[]
  while(walker.nextNode()) nodes.push(walker.currentNode)
  for(const node of nodes) {
    const fragment=document.createDocumentFragment();let offset=0
    for(const match of node.data.matchAll(/\[(em\d+)\]/gi)) {
      const name=match[1].toLowerCase()
      if(!names.has(name)) continue
      fragment.append(node.data.slice(offset,match.index))
      const img=document.createElement('img')
      img.src=urlFor(name);img.alt=match[0];img.className='legacy-emoticon';img.loading='lazy'
      fragment.append(img);offset=match.index+match[0].length
    }
    if(offset) {fragment.append(node.data.slice(offset));node.replaceWith(fragment)}
  }
  return template.innerHTML
}
