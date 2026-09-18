"""Restore archived signatures and vendor the matching Dvbbs emoticon set."""
import concurrent.futures, gzip, json, pathlib, re, sqlite3, subprocess, urllib.request
from server import render_signature, NUXT_RE
ROOT=pathlib.Path(__file__).resolve().parent
REV='855ed2e108787dac54ca36ff3775bb244277ab0b'
def emoticons():
    tree=json.loads(subprocess.check_output(['gh','api',f'repos/SoraKasvgano/dvbbs/git/trees/{REV}?recursive=1']))
    paths=[r['path'] for r in tree['tree'] if re.fullmatch(r'DVBBS8.3_AC/程序源文件/images/emot/em\d+\.gif',r['path'])]
    target=ROOT/'public/emot';target.mkdir(parents=True,exist_ok=True)
    def download(path):
        from urllib.parse import quote
        data=urllib.request.urlopen(f'https://raw.githubusercontent.com/SoraKasvgano/dvbbs/{REV}/'+quote(path),timeout=30).read()
        if not data.startswith((b'GIF87a',b'GIF89a')): raise ValueError(path)
        (target/pathlib.Path(path).name).write_bytes(data)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: list(pool.map(download,paths))
    (target/'manifest.json').write_text(json.dumps([pathlib.Path(p).stem for p in paths]),encoding='utf-8')
    print(f'Emoticons: {len(paths)}',flush=True)

def signatures():
    db=sqlite3.connect(ROOT/'data/forum.db')
    rows=db.execute('select id,local_html_path from posts order by id').fetchall()
    def read(row):
        rid,path=row
        source=pathlib.Path(path).read_text('utf-8',errors='ignore')
        match=NUXT_RE.search(source)
        if not match: return rid,[]
        posts=json.loads(match[1])['data'][0].get('postsVOList') or []
        return rid,[render_signature((p.get('postLeftUserInfo') or {}).get('privateSign') or '') for p in posts]
    target=ROOT/'public/archive/signatures';target.mkdir(parents=True,exist_ok=True)
    chunk=None; data={}
    def save():
        (target/f'{chunk}.json.gz').write_bytes(gzip.compress(json.dumps(data,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for count,(rid,values) in enumerate(pool.map(read,rows),1):
            if chunk is not None and rid//500!=chunk: save();data={}
            chunk=rid//500
            data[str(rid)]=values
            if count%25000==0: print(f'Signatures: {count}',flush=True)
    if chunk is not None: save()

if __name__=='__main__':
    import sys
    emoticons() if '--emoticons' in sys.argv else signatures()
