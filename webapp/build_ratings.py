"""Extract actual scoring logs from saved pages, not hasRate alone."""
import concurrent.futures,gzip,json,re,sqlite3
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def extract(data):
    records=[]
    for index,post in enumerate(data.get('postsVOList') or []):
        for log in post.get('rateLogVOList') or []:
            if not isinstance(log,dict):continue
            records.append({**{k:log.get(k) for k in ('rateLogId','posterName','reason','score','beanUnit','createTime')},'floor':index+1,'pid':post.get('pid')})
    return records
def build_ratings():
    db=sqlite3.connect(ROOT/'data/forum.db')
    rows=db.execute('select id,local_html_path from posts order by id').fetchall()
    def read(row):
        rid,path=row
        source=Path(path).read_text('utf-8',errors='ignore')
        match=re.search(r'window\.__NUXT__=(.*?);</script>',source,re.S)
        return rid,extract(json.loads(match[1])['data'][0]) if match else []
    result={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for i,(rid,records) in enumerate(pool.map(read,rows),1):
            if records:result[str(rid)]=records
            if i%25000==0:print(f'Checked {i}; rated topics {len(result)}',flush=True)
    (ROOT/'public/archive/ratings.json.gz').write_bytes(gzip.compress(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
    print(f'Complete: {len(result)} topics with scoring logs',flush=True)
if __name__=='__main__':build_ratings()
