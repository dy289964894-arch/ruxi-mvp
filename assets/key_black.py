# -*- coding: utf-8 -*-
"""黑底人物图转透明抠图：从边缘泛洪找出真正的黑背景（保住黑发），
再收缩 2px 去白边、颜色外渗、羽化边缘。
用法: python key_black.py B   （处理 B_calm/smile/... 共5张）
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from fix_matte import fill_rgb, EXPR

ASSETS = Path(__file__).parent


def keyout(path, thr=40):
    im = Image.open(path).convert("RGBA")
    arr = np.asarray(im).copy()
    rgb = im.convert("RGB")
    w, h = rgb.size
    # 从四角和四边中点泛洪：只有与边缘相连的纯黑才算背景
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
             (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    mark = (255, 0, 255)
    for s in seeds:
        ImageDraw.floodfill(rgb, s, mark, thresh=thr)
    m = np.asarray(rgb)
    bg = (m[..., 0] == 255) & (m[..., 1] == 0) & (m[..., 2] == 255)
    arr[..., 3] = np.where(bg, 0, 255).astype(np.uint8)

    keyed = Image.fromarray(arr, "RGBA")
    # 收缩 2px 去白边/杂点，颜色从内部外渗，再羽化
    solid = keyed.getchannel("A").point(lambda v: 255 if v > 200 else 0)
    er = solid.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MinFilter(3))
    rgb_filled = fill_rgb(keyed.convert("RGB"), er)
    new_alpha = er.filter(ImageFilter.GaussianBlur(1.0))
    out = Image.merge("RGBA", (*rgb_filled.split(), new_alpha))
    out.save(path)
    n_bg = int(bg.sum())
    print(f"fixed {path.name}: 背景像素 {n_bg} ({100 * n_bg / (w * h):.0f}%)")


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else "B"
    for e in EXPR:
        p = ASSETS / f"{arg}_{e}.png"
        if p.exists():
            keyout(p)


if __name__ == "__main__":
    main()
