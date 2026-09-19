"""Recover board 38 with explicit evidence; never infer from modern board names."""
import gzip,json,re,html
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
ROOT=Path(__file__).resolve().parent
OUT=ROOT/'public/archive'
def build_legacy_boards():
    result={}
    threads=json.loads(gzip.decompress((OUT/'thread-pages.json.gz').read_bytes()))
    page_routes={rid:(int(canonical),i+1) for canonical,pages in threads['threads'].items() for i,(_,rid,_) in enumerate(pages)}
    for p in sorted((ROOT.parent/'eebbk_archive_threads/html').glob('*.html')):
        board=re.search(r'boardid=(\d+)',p.name,re.I)
        topic=re.search(r'&id=(\d+)',p.name,re.I)
        if board and topic and board[1]=='38':
            result[topic[1]]={'source':'snapshot','snapshot':p.name[:14]}
    confirmed=len(result)
    for path in sorted((OUT/'posts').glob('*.json.gz')):
        raw=gzip.decompress(path.read_bytes())
        if b'boardid' not in raw.lower():continue
        for rid,post in json.loads(raw).items():
            for floor,reply in enumerate(post.get('replies_list',[]),1):
                text=html.unescape(reply.get('message_html') or reply.get('message') or '')
                for match in re.finditer(r'https?://club\.eebbk\.com(?::80)?/bbkbbs/dispbbs\.asp\?[^\s<>"\[\]]+',text,re.I):
                    url=match[0]
                    params={k.lower():v for k,v in parse_qs(urlsplit(url).query).items()}
                    topic=params.get('id',[''])[0]
                    if params.get('boardid')==['38'] and topic.isdecimal():
                        canonical,page=page_routes.get(int(rid),(int(rid),1))
                        result.setdefault(str(int(topic)),{'source':'link','record_id':canonical,'page':page,'floor':floor,'url':url})
    (OUT/'legacy-boards.json.gz').write_bytes(gzip.compress(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
    from build_thread_pages import canonical_catalog
    cat=canonical_catalog(json.loads(gzip.decompress((OUT/'catalog.json.gz').read_bytes())))
    print(json.dumps({'snapshot_topics':confirmed,'matched_snapshot':sum(result.get(r['post_id'],{}).get('source')=='snapshot' for r in cat),'matched_link':sum(result.get(r['post_id'],{}).get('source')=='link' for r in cat),'bytes':(OUT/'legacy-boards.json.gz').stat().st_size}))
if __name__=='__main__':build_legacy_boards()
