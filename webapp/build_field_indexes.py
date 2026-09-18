"""Build field-specific indexes from the exported catalog, without source HTML."""
import gzip
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent / 'public' / 'archive'

def build_field_indexes(catalog=None):
    if catalog is None:
        catalog = json.loads(gzip.decompress((OUT / 'catalog.json.gz').read_bytes()))
    for field in ('title', 'author'):
        buckets = [{} for _ in range(256)]
        for row in sorted(catalog, key=lambda r: r['id']):
            value = (row.get(field) or '').lower()
            terms = set(value) | {value[i:i+2] for i in range(len(value)-1)}
            for term in terms:
                if term.strip():
                    buckets[sum(map(ord, term)) % 256].setdefault(term, []).append(row['id'])
        target = OUT / f'search-{field}'
        target.mkdir(parents=True, exist_ok=True)
        for number, bucket in enumerate(buckets):
            payload = json.dumps(bucket, ensure_ascii=False, separators=(',', ':')).encode()
            (target / f'{number}.json.gz').write_bytes(gzip.compress(payload, compresslevel=6, mtime=0))
        print(f'{field}: {len(catalog)} posts indexed', flush=True)

if __name__ == '__main__':
    build_field_indexes()
