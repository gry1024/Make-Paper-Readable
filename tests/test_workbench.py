import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.request
import urllib.error
import threading
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class WorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        server.WORKSPACE = self.root
        server.DATA = self.root / 'data'
        server.STATE_FILE = server.DATA / 'review.json'
        server.NOTES_MD = self.root / 'REVIEW_NOTES.md'
        server.CHAT_MD = self.root / 'CHAT_LOG.md'
        server.CFG = {'paper':'paper.md','paragraph_aliases':{},'context_files':{},'port':8765}
        server._paper_cache = {'mtime':None,'data':None}
        (self.root / 'paper.md').write_text('# Test\n\n## 1 Intro / 引言\n\n**[p1]** English.\n\n**[p1]** 中文内容。', encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def test_nonadjacent_pair_and_reverse_order(self):
        blocks = ['**[a]** 中文版本。','**[b]** Another paragraph.', '**[a]** English version.', '**[b]** 另一段。']
        units = server.build_units('intro',blocks)
        self.assertEqual(len(units),2)
        self.assertTrue(all('en' in u and 'zh' in u for u in units))

    def test_explicit_alias_preserves_old_anchor(self):
        server.CFG['paragraph_aliases']={'4.1c':'5.1c'}
        units=server.build_units('5.1',['**[5.1c] Baselines. / 基线。** Compare methods.', '**[4.1c]** 比较各类方法。'])
        self.assertEqual(len(units),1)
        self.assertEqual(units[0]['aliases'],['4.1c'])
        self.assertIn('**基线。**',units[0]['zh'])

    def test_mismatched_ids_are_not_guessed(self):
        units=server.build_units('s',['**[a]** English.', '**[b]** 中文。'])
        self.assertEqual(len(units),2)

    def test_duplicate_same_language_is_not_lost(self):
        units=server.build_units('s',['**[a]** One.', '**[a]** Two.'])
        self.assertEqual([u['id'] for u in units],['a','a~2'])

    def test_http_originals_notes_and_origin(self):
        raw=b'%PDF-1.4\noriginal bytes for transport test'
        (self.root/'chart.pdf').write_bytes(raw)
        (self.root/'secret.png').write_bytes(b'private')
        with (self.root/'paper.md').open('a') as f:
            f.write('\n\n![Table](chart.pdf)\n\n![Escape](../secret.png)')
        http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        thread=threading.Thread(target=http.serve_forever,daemon=True); thread.start()
        base=f'http://127.0.0.1:{http.server_port}'
        try:
            self.assertEqual(urllib.request.urlopen(base+'/fig/chart.pdf').read(),raw)
            for path in ['/fig/secret.png','/fig/..%2Fsecret.png','/static/..%2Fserver.py']:
                with self.assertRaises(urllib.error.HTTPError): urllib.request.urlopen(base+path)
            def post(path,body,origin=None):
                headers={'Content-Type':'application/json'}
                if origin: headers['Origin']=origin
                return urllib.request.urlopen(urllib.request.Request(base+path,data=json.dumps(body).encode(),headers=headers))
            note=json.load(post('/api/notes',{'section':'1','anchor':'p1','text':'Revise this.'}))
            self.assertEqual(note['id'],'N1')
            json.load(post('/api/notes/N1',{'status':'done','resolution':'Revised.'}))
            self.assertEqual(server.read_state()['notes'][0]['status'],'done')
            self.assertIn('Revised.',server.NOTES_MD.read_text())
            with self.assertRaises(urllib.error.HTTPError) as error:
                post('/api/notes',{'section':'1','text':'bad'},'https://unrelated.example')
            self.assertEqual(error.exception.code,403)
        finally:
            http.shutdown(); http.server_close(); thread.join()


if __name__=='__main__': unittest.main()
