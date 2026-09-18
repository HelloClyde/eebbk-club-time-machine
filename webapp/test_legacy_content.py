import gzip, json, unittest
from pathlib import Path
from server import render_signature

class LegacyContentTests(unittest.TestCase):
    def test_image_only_signature(self):
        self.assertIn('<img ', render_signature('[img]https://example.com/sign.gif[/img]'))
        self.assertIn('<img ', render_signature('<img src="https://example.com/sign.gif">'))

    def test_formatting_and_links(self):
        result=render_signature('[align=right][color=#000066]签名[/color][/align]<br>[url=https://example.com]链接[/url]')
        self.assertIn('align="right"',result)
        self.assertIn('color="#000066"',result)
        self.assertIn('href="https://example.com"',result)
        self.assertIn('<br>',result)

    def test_safety(self):
        result=render_signature('<script>alert(1)</script><img src="https://example.com/x" onerror="alert(1)">[url=javascript:alert(1)]bad[/url]')
        self.assertNotIn('<script',result)
        self.assertNotIn('onerror',result)
        self.assertNotIn('javascript:',result)
        self.assertEqual(render_signature('a'*24),'')
        self.assertEqual(render_signature('0'),'0')

    def test_emoticons(self):
        root=Path('public/emot')
        names=json.loads((root/'manifest.json').read_text())
        self.assertIn('em64',names)
        for name in names:
            self.assertTrue((root/f'{name}.gif').read_bytes().startswith((b'GIF87a',b'GIF89a')))

    def test_signature_floor_mapping(self):
        root=Path('public/archive')
        total=0
        for path in (root/'signatures').glob('*.json.gz'):
            total+=len(json.loads(gzip.decompress(path.read_bytes())))
        self.assertEqual(total,json.loads((root/'manifest.json').read_text('utf-8'))['total_posts'])
        for chunk in (0,314,534):
            signatures=json.loads(gzip.decompress((root/f'signatures/{chunk}.json.gz').read_bytes()))
            posts=json.loads(gzip.decompress((root/f'posts/{chunk}.json.gz').read_bytes()))
            for rid,post in posts.items():
                self.assertEqual(len(signatures[rid]),len(post['replies_list']))

if __name__=='__main__': unittest.main()
