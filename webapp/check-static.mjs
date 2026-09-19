import { access, readFile, readdir, stat } from 'node:fs/promises'
const root='public/archive'
try {
  const manifest=JSON.parse(await readFile(`${root}/manifest.json`,'utf8'))
  if(!manifest.total_posts)throw new Error('empty archive')
  await access(`${root}/catalog.json.gz`)
  await access(`${root}/digest.json.gz`)
  await access(`${root}/ratings.json.gz`)
  await access(`${root}/link-map.json.gz`)
  await access('public/emot/manifest.json')
  for(const directory of ['search','search-title','search-author'])
    for(let i=0;i<256;i++)await access(`${root}/${directory}/${i}.json.gz`)
  const posts=await readdir(`${root}/posts`)
  for(const name of posts) {
    await access(`${root}/texts/${name}`)
    await access(`${root}/signatures/${name}`)
  }
  if(posts.length<Math.ceil(manifest.total_posts/manifest.chunk_size))throw new Error('missing post shards')
  async function total(dir){let n=0;for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;n+=e.isDirectory()?await total(p):(await stat(p)).size}return n}
  const bytes=await total('public')
  if(bytes>=990_000_000)throw new Error('Archive exceeds the GitHub Pages size budget')
  console.log(`Static archive: ${manifest.total_posts} posts, ${(bytes/1e6).toFixed(1)} MB`)
}catch(e){console.error('Static data is missing or incomplete. Run python export_static.py first.',e.message);process.exit(1)}
