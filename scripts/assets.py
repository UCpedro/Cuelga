"""Genera assets del dibujo vectorial C de Cuelga. Pillow, sólo herramienta local."""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parents[1]
icon = Image.new('RGB', (1024, 1024), '#182C47')
d = ImageDraw.Draw(icon)
d.arc((194,194,830,830), 45,315,fill='#F4F1EA',width=82)
d.line((687,334,777,244),fill='#CE5925',width=82)
d.line((680,690,770,780),fill='#CE5925',width=82)
icon.save(root/'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')
for name in ['splash-2732x2732.png','splash-2732x2732-1.png','splash-2732x2732-2.png']:
    splash = Image.new('RGB',(2732,2732),'#F4F1EA')
    small=icon.resize((380,380))
    splash.paste(small,(1176,1176))
    splash.save(root/'ios/App/App/Assets.xcassets/Splash.imageset'/name)
print('Icono RGB 1024x1024 y tres splash 2732x2732; no aprobación de identidad comercial.')
