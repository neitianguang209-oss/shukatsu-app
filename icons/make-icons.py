# アプリのアイコンを作る(スーツのかえる)。元の絵は source-kaeru.png(白背景)。
# 白い背景だけを、読書記録のアイコンと同じベージュに塗り替える。
# 使い方: C:\ProgramData\anaconda3\python.exe -I icons\make-icons.py
import os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
BEIGE = np.array([0xF5, 0xF1, 0xE4], float)

src = np.array(Image.open(os.path.join(HERE, 'source-kaeru.png')).convert('RGB'), float)
light = src.min(axis=2) > 232
labels, _ = ndimage.label(light)
edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
bg = np.isin(labels, np.unique(edge[edge > 0]))   # 外周とつながる白だけ(目やシャツは残す)
for x, y in [(1055, 985), (988, 1004)]:             # かばんの持ち手の内側のすき間
    if labels[y, x]:
        bg |= labels == labels[y, x]

# 輪郭の薄い白にじみは、白の混ざり具合に合わせてベージュへ寄せる
ring = ndimage.binary_dilation(bg, iterations=3) & ~bg
w = np.clip((src.min(axis=2) - 150) / 90, 0, 1) * ring
out = src + w[..., None] * (BEIGE - 255)
out[bg] = BEIGE
art = Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))

ys, xs = np.where(~bg)
box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
crop = art.crop(box)
cw, ch = crop.size

def icon(size, scale, name):
    side = int(round(scale))
    canvas = Image.new('RGB', (side, side), tuple(int(v) for v in BEIGE))
    canvas.paste(crop, ((side - cw) // 2, (side - ch) // 2))
    canvas.resize((size, size), Image.LANCZOS).save(os.path.join(HERE, name), optimize=True)

normal = ch / 0.80
maskable = ((cw / 2) ** 2 + (ch / 2) ** 2) ** 0.5 / 0.40   # 丸く切られても欠けない余白
icon(512, normal, 'icon-512.png')
icon(192, normal, 'icon-192.png')
icon(180, normal, 'icon-180.png')
icon(32, ch / 0.94, 'favicon-32.png')
icon(512, maskable, 'icon-maskable-512.png')
print('ok', box)
