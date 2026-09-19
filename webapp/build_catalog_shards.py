"""Build small metadata shards and board/year browsing ID lists."""
import gzip,json
from build_thread_pages import canonical_catalog
from pathlib import Path
ROOT=Path(__file__).resolve().parent/'public/archive'
def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_bytes(gzip.compress(json.dumps(value,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
def build_catalog_shards():
    catalog=json.loads(gzip.decompress((ROOT/'catalog.json.gz').read_bytes()))
    chunks={};groups={}
    for rank,row in enumerate(catalog):
        chunks.setdefault(row['id']//500,{})[row['id']]=row
    for rank,row in enumerate(canonical_catalog(catalog)):
        groups.setdefault((row['board'],row['publish_time'][:4]),[]).append([row['id'],rank,row['post_id']])
    for chunk,rows in chunks.items():save(ROOT/'catalog'/f'{chunk}.json.gz',rows)
    manifest=[]
    for i,((board,year),rows) in enumerate(sorted(groups.items())):
        path=f'browse/{i}.json.gz'
        save(ROOT/path,rows)
        manifest.append(dict(board=board,year=year,count=len(rows),path=path))
    save(ROOT/'catalog-manifest.json.gz',manifest)
    print(f'Catalog: {len(chunks)} metadata shards, {len(groups)} browsing groups')
if __name__=='__main__':build_catalog_shards()
