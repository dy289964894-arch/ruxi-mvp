# -*- coding: utf-8 -*-
"""黑底人物图转透明抠图：从边缘泛洪找出真正的黑背景（保住黑发），
再收缩 2px 去白边、颜色外渗、羽化边缘。
用法: python key_black.py B   （处理 B_calm/smile/... 共5张）
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from collections import deque

from fix_matte import fill_rgb, EXPR

ASSETS = Path(__file__).parent


def largest_component(mask):
    """只保留最大的连通实心块（人物本体），碎屑全扔掉。"""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    cur, best, best_n = 0, 0, 0
    for sy in range(h):
        for sx in range(w):
            if mask[sy, sx] and not lab[sy, sx]:
                cur += 1
                n = 0
                dq = deque([(sy, sx)])
                lab[sy, sx] = cur
                while dq:
                    y, x = dq.popleft()
                    n += 1
                    for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = cur
                            dq.append((ny, nx))
                if n > best_n:
                    best_n, best = n, cur
    return lab == best


def adaptive_bg(rgb_arr, delta=14):
    """自适应泛洪：只比较相邻像素差，背景有渐变/光晕也能走完，
    遇到人物边缘（色差突变）自然停下。"""
    h, w, _ = rgb_arr.shape
    a = rgb_arr.astype(np.int16)
    bg = np.zeros((h, w), bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        cur = a[y, x]
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx]:
                if np.abs(a[ny, nx] - cur).max() <= delta:
                    bg[ny, nx] = True
                    dq.append((ny, nx))
    return bg


def keyout(path, thr=40, adaptive=False):
    im = Image.open(path).convert("RGBA")
    arr = np.asarray(im).copy()
    rgb = im.convert("RGB")
    w, h = rgb.size
    if adaptive:
        bg = adaptive_bg(np.asarray(rgb), delta=thr)
    else:
        # 从四角和四边中点泛洪：只有与边缘相连的纯色才算背景
        seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
                 (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
        mark = (255, 0, 255)
        for s in seeds:
            ImageDraw.floodfill(rgb, s, mark, thresh=thr)
        m = np.asarray(rgb)
        bg = (m[..., 0] == 255) & (m[..., 1] == 0) & (m[..., 2] == 255)
    # 渐进式开运算：逐轮收缩→只留最大块→长回来，掐断细脖子连接的残留团块
    solid = (~bg).astype(np.uint8) * 255
    for k in (2, 4, 6):
        im_s = Image.fromarray(solid)
        for _ in range(k):
            im_s = im_s.filter(ImageFilter.MinFilter(3))
        lc = largest_component(np.asarray(im_s) > 0)
        im_l = Image.fromarray(lc.astype(np.uint8) * 255)
        for _ in range(k):
            im_l = im_l.filter(ImageFilter.MaxFilter(3))
        solid = ((np.asarray(im_l) > 0) & (solid > 0)).astype(np.uint8) * 255
    arr[..., 3] = solid

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
    thr = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    adaptive = len(sys.argv) > 3 and sys.argv[3] == "adaptive"
    for e in EXPR:
        p = ASSETS / f"{arg}_{e}.png"
        if p.exists():
            keyout(p, thr, adaptive)


if __name__ == "__main__":
    main()
