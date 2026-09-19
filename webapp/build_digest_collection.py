"""Extract the explicitly labelled digest collection in post 176886, floor 1."""
import gzip,json,html,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def main():
    archive=ROOT/'public/archive'
    post=json.loads(gzip.decompress((archive/'posts/353.json.gz').read_bytes()))['176886']
    body=html.unescape(post['replies_list'][0]['message_html'])
    assert '精华帖：' in body and '最后：不支持翻老帖' in body
    ids=set(re.findall(r'https?://club\.eebbk\.com/bbkbbs/dispbbs\.asp\?[^\s<>]*?[&?]id=(\d+)',body,re.I))
    assert ids
    result={topic:{'source':'collection','collection_id':176886,'collection_title':post['title'],'floor':1} for topic in sorted(ids,key=int)}
    (ROOT/'digest-collection.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    cat=json.loads(gzip.decompress((archive/'catalog.json.gz').read_bytes()))
    matched={r['post_id'] for r in cat if r['post_id'] in ids}
    previous=json.loads(gzip.decompress((archive/'digest.json.gz').read_bytes()))
    print(json.dumps({'listed':len(ids),'matched_topics':len(matched),'new_topics':len(matched-set(previous)),'unmatched':sorted(ids-matched)}))
if __name__=='__main__':main()
