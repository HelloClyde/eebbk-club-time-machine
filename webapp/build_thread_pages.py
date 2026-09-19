"""Identify saved pagination from source filenames, keeping every old record URL."""
import gzip,json,sqlite3,re
from collections import defaultdict
from pathlib import Path
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'public/archive'
def canonical_catalog(catalog):
    path=OUT/'thread-pages.json.gz'
    if not path.exists():return catalog
    aliases=json.loads(gzip.decompress(path.read_bytes()))['aliases']
    return [row for row in catalog if str(row['id']) not in aliases]
def build_thread_pages():
    groups=defaultdict(list)
    with sqlite3.connect(ROOT/'data/forum.db') as db:
        for rid,topic,path in db.execute('select id,post_id,local_html_path from posts'):
            name=Path(path).name
            match=re.fullmatch(re.escape(str(topic))+r'(?:_(\d+))?\.html',name)
            if not match:raise ValueError(f'Unknown archive filename: {name}')
            groups[str(topic)].append((int(match[1] or 1),rid))
    aliases={};threads={};chunks={}
    for topic,pages in groups.items():
        if len(pages)<2:continue
        pages.sort()
        if pages[0][0]!=1 or len({p for p,_ in pages})!=len(pages):raise ValueError(f'Ambiguous pages: {topic}')
        canonical=pages[0][1];entries=[]
        for number,rid in pages:
            shard=rid//500
            if shard not in chunks:chunks[shard]=json.loads(gzip.decompress((OUT/'posts'/f'{shard}.json.gz').read_bytes()))
            count=len(chunks[shard][str(rid)]['replies_list'])
            entries.append([number,rid,count])
            if rid!=canonical:aliases[str(rid)]=canonical
        threads[str(canonical)]=entries
    (OUT/'thread-pages.json.gz').write_bytes(gzip.compress(json.dumps(dict(aliases=aliases,threads=threads),separators=(',',':')).encode(),mtime=0))
    print(f'Merged {len(threads)} paginated topics; {len(aliases)} old page URLs preserved')
def update_manifest():
    path=OUT/'manifest.json'
    manifest=json.loads(path.read_text('utf-8'))
    raw=json.loads(gzip.decompress((OUT/'catalog.json.gz').read_bytes()))
    catalog=canonical_catalog(raw)
    counts=defaultdict(int)
    for row in catalog:counts[row['board']]+=1
    manifest.update(total_posts=len(catalog),body_indexed=len(catalog),archived_pages=len(raw),initial_items=catalog[:30],boards=[dict(board=k,count=v) for k,v in sorted(counts.items(),key=lambda p:-p[1])])
    path.write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf-8')
if __name__=='__main__':
    build_thread_pages()
    update_manifest()
