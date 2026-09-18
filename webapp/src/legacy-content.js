// Only transform text nodes of already-sanitized archive HTML, never attributes.
export function renderLegacyContent(html, names) {
  const template = document.createElement('template')
  template.innerHTML = html || ''
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
