# -*- coding: utf-8 -*-
"""人物抠图描边修复：去白边、去孤立杂点、边缘重新羽化。
原理：实心区向内收缩 2px（把白边和毛刺连根切掉），再把内部颜色
向外渗到边缘带，最后给 alpha 做一次轻微高斯羽化，边缘就顺了。
用法: python fix_matte.py B          （处理 B_calm/smile/... 共5张）
      python fix_matte.py B_calm.png （只处理单张）
"""
import sys
from pathlib import Path

from PIL import Image, ImageFilter

EXPR = ["calm", "smile", "thinking", "awkward", "displeased"]
ASSETS = Path(__file__).parent


def fill_rgb(rgb, solid):
    """把实心区的颜色逐轮向外渗，填满边缘带（MaxFilter 3x3 扩张）。"""
    cur = rgb.copy()
    known = solid
    for _ in range(40):
        dil = cur.filter(ImageFilter.MaxFilter(3))
        grow_mask = known.point(lambda v: 0 if v else 255)
        cur = Image.composite(dil, cur, grow_mask)
        new_known = known.filter(ImageFilter.MaxFilter(3))
        if new_known.getbbox() == known.getbbox() and list(new_known.getdata()) == list(known.getdata()):
            break
        known = new_known
    return cur


def clean(path):
    im = Image.open(path).convert("RGBA")
    alpha = im.getchannel("A")
    solid = alpha.point(lambda v: 255 if v > 200 else 0)
    # 向内收缩 2px：白边、红点等毛刺都在最外 1~2px，连根切掉
    er = solid.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MinFilter(3))
    rgb_filled = fill_rgb(im.convert("RGB"), er)
    # 边缘重新羽化 1px，平滑锯齿
    new_alpha = er.filter(ImageFilter.GaussianBlur(1.0))
    out = Image.merge("RGBA", (*rgb_filled.split(), new_alpha))
    out.save(path)
    print("fixed", path.name)


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else "B"
    if arg.endswith(".png"):
        clean(ASSETS / arg)
    else:
        for e in EXPR:
            p = ASSETS / f"{arg}_{e}.png"
            if p.exists():
                clean(p)


if __name__ == "__main__":
    main()
