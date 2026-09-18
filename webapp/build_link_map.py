"""Map original forum topic IDs to local archive record IDs."""
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent / 'public/archive'

def build_link_map(catalog=None):
    if catalog is None:
        catalog = json.loads(gzip.decompress((ROOT / 'catalog.json.gz').read_bytes()))
    mapping = {}
    # Same order as the list: choose the latest record if an ID has duplicates.
    for row in catalog:
        key = str(row['post_id'])
        if key.isdecimal():
            mapping.setdefault(str(int(key)), row['id'])
    (ROOT / 'link-map.json.gz').write_bytes(gzip.compress(json.dumps(mapping,separators=(',', ':')).encode(),mtime=0))
    print(f'Legacy link mappings: {len(mapping)}')

if __name__ == '__main__':
    build_link_map()
