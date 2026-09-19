"""Recover positive historical digest evidence, never infer a negative status."""
import concurrent.futures,gzip,json,re
from pathlib import Path
from html.parser import HTMLParser
ROOT=Path(__file__).resolve().parent
class Evidence(HTMLParser):
    def __init__(self):
        super().__init__();self.found=False
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='img' and a.get('title')=='本帖被加为精华' and a.get('src','').lower().endswith('/jing.gif'):
            self.found=True

def build_digest():
    files=list((ROOT.parent/'eebbk_archive_threads/html').glob('*.html'))
    if not files: raise RuntimeError('Historical HTML snapshots missing')
    def inspect(p):
        s=p.read_text('gb18030',errors='replace')
        if '本帖被加为精华' not in s:return None
        parser=Evidence();parser.feed(s)
        match=re.search(r'[&?]id=(\d+)',p.name,re.I)
        if parser.found and match:return match[1],p.name[:8]
    result={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for found in pool.map(inspect,files):
            if found:
                topic,date=found
                if topic not in result or result[topic]['snapshot']<date:result[topic]={'snapshot':date}
    path=ROOT/'public/archive/digest.json.gz'
    reviewed=ROOT/'digest-reviewed.json'
    if reviewed.exists():
        for topic,evidence in json.loads(reviewed.read_text('utf-8')).items():
            result.setdefault(topic,evidence)
    confirmed=ROOT/'digest-screenshot-confirmed.json'
    if confirmed.exists():
        for topic,evidence in json.loads(confirmed.read_text('utf-8')).items():
            if topic not in result or not result[topic].get('snapshot'): result[topic]=evidence
    path.write_bytes(gzip.compress(json.dumps(result,separators=(',',':')).encode(),mtime=0))
    catalog=json.loads(gzip.decompress((path.parent/'catalog.json.gz').read_bytes()))
    print(json.dumps({'snapshots':len(files),'confirmed_topics':len(result),'matched_records':sum(str(r['post_id']) in result for r in catalog)}),flush=True)
if __name__=='__main__':build_digest()
