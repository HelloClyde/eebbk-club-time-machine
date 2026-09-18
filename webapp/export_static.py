"""Generate self-contained, compressed GitHub Pages data. Originals stay read-only."""
import gzip
import json
import sqlite3
import time
from array import array
from pathlib import Path
from build_field_indexes import build_field_indexes
from server import DB_PATH, APP_DIR, parse_archive, historical_profiles

OUT = APP_DIR / 'public' / 'archive'
CHUNK = 500

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
    path.write_bytes(gzip.compress(payload, compresslevel=6, mtime=0))

def add_initial_page():
    path = OUT / 'manifest.json'
    manifest = json.loads(path.read_text(encoding='utf-8'))
    catalog = json.loads(gzip.decompress((OUT / 'catalog.json.gz').read_bytes()))
    manifest['initial_items'] = catalog[:30]
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')

def main():
    started = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    catalog = []
    postings = {}
    boards = {}
    failures = []
    historical_profiles()
    rows = db.execute('SELECT * FROM posts ORDER BY id')
    chunks = {}; texts = {}; current = None
    for row in rows:
        rid = row['id']; chunk = rid // CHUNK
        if current is not None and chunk != current:
            save(OUT / 'posts' / f'{current}.json.gz', chunks)
            save(OUT / 'texts' / f'{current}.json.gz', texts)
            chunks = {}; texts = {}
        current = chunk
        meta = {k: row[k] for k in ('id','post_id','title','author','publish_time','board')}
        catalog.append(meta)
        boards[row['board']] = boards.get(row['board'], 0) + 1
        try:
            parsed = parse_archive(row['local_html_path'])
        except (OSError, ValueError, KeyError, OverflowError) as exc:
            parsed = {'replies': [], 'body': row['body']}
            failures.append({'id': rid, 'error': type(exc).__name__})
        for reply in parsed['replies']:
            reply['message_html'] = reply['message_html'].replace('src="/rar.png"', 'src="./rar.png"')
        chunks[str(rid)] = {**meta, 'replies_list': parsed['replies'], 'body': parsed['body']}
        fields = [row[k].lower() for k in ('title','author','board','body')]
        texts[str(rid)] = fields
        terms = set()
        for field in fields:
            terms.update(field)
            terms.update(field[i:i+2] for i in range(len(field)-1))
        for term in terms:
            if term.strip():
                if term not in postings: postings[term] = array('I')
                postings[term].append(rid)
        if rid % 5000 == 0:
            print(f'{rid:,} posts; {time.time()-started:.0f}s', flush=True)
    if current is not None:
        save(OUT / 'posts' / f'{current}.json.gz', chunks)
        save(OUT / 'texts' / f'{current}.json.gz', texts)
    catalog.sort(key=lambda r: (r['publish_time'], r['id']), reverse=True)
    save(OUT / 'catalog.json.gz', catalog)
    build_field_indexes(catalog)
    buckets = [{} for _ in range(256)]
    for term, ids in postings.items():
        buckets[sum(map(ord, term)) % 256][term] = list(ids)
    for number, bucket in enumerate(buckets): save(OUT / 'search' / f'{number}.json.gz', bucket)
    years = [r['publish_time'][:4] for r in catalog if r['publish_time'] >= '2000']
    manifest = {'version': 1, 'chunk_size': CHUNK, 'total_posts': len(catalog), 'body_indexed': len(catalog), 'year_min': min(years), 'year_max': max(years), 'boards': [{'board': k, 'count': v} for k,v in sorted(boards.items(), key=lambda x:-x[1])], 'failed_details': len(failures)}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
    add_initial_page()
    from restore_legacy_assets import signatures
    signatures()
    (APP_DIR / 'data' / 'static-export-report.json').write_text(json.dumps(failures), encoding='utf-8')
    print(json.dumps({'posts': len(catalog), 'failed_details': len(failures), 'bytes': sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file()), 'seconds': round(time.time()-started)}, ensure_ascii=False), flush=True)

if __name__ == '__main__': main()
