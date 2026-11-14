import os
import subprocess
from PIL import Image

edge = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

# Create a small HTML file to render icon.svg on transparent background at 512x512
html = '''<!DOCTYPE html>
<html>
<head>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: transparent; width: 512px; height: 512px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
img { width: 480px; height: 480px; }
</style>
</head>
<body>
<img src="icon.svg" />
</body>
</html>'''

with open('nexus/public/render_icon_512.html', 'w', encoding='utf-8') as f:
    f.write(html)

html_abs = os.path.abspath('nexus/public/render_icon_512.html').replace('\\', '/')
out_png = os.path.abspath('nexus/public/icon.png').replace('\\', '/')

cmd = [
    edge,
    '--headless=new',
    '--disable-gpu',
    '--default-background-color=00000000',
    f'--screenshot={out_png}',
    '--window-size=512,512',
    f'file:///{html_abs}'
]
subprocess.run(cmd, capture_output=True)

# Also copy to build/icon.png
if os.path.exists('nexus/public/icon.png'):
    im = Image.open('nexus/public/icon.png')
    im.save('nexus/build/icon.png')
    print('Generated 512x512 icon.png for public/ and build/!')

if os.path.exists('nexus/public/render_icon_512.html'):
    os.remove('nexus/public/render_icon_512.html')
