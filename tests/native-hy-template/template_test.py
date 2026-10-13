#!/usr/bin/env python3
"""Real MiniJinja evaluation of template bytes extracted from pinned HY artifact.
This is a template regression, not Android/JNI/model inference verification.
Install minijinja==2.12.0 from PyPI; run with it importable.
"""
from pathlib import Path
import hashlib
import minijinja
p=Path(__file__).with_name('pinned-hy-template.jinja')
s=p.read_text()
assert hashlib.sha256(p.read_bytes()).hexdigest() == 'b7491ec0e9c869dfce20f2176758099bf248d979dd05530ede99deb21698acee'
env=minijinja.Environment(templates={'hy':s})
try:
 env.render_template('hy', messages=[], add_generation_prompt=False)
except minijinja.TemplateError as e:
 assert 'undefined' in str(e).lower(), str(e)
 print('CONFIRMED original empty-preface template failure:',str(e).splitlines()[0])
else:
 raise AssertionError('Pinned template unexpectedly accepts empty messages')
for text in ['Hello.', '你好 👋', 'é', '<|im_start|> literal']:
 actual=env.render_template('hy',messages=[{'role':'user','content':text}],add_generation_prompt=True)
 expected='<｜hy_begin▁of▁sentence｜><｜hy_User｜>'+text+'<｜hy_Assistant｜>'
 assert actual==expected, (actual,expected)
 assert len(actual.encode())==len(expected.encode())
print('PASS pinned template: complete first-user rendering includes BOS, user and assistant wrappers; UTF-8 byte count preserved.')
