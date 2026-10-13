"""由利高原鉄道 鳥海山ろく線の運賃表（三角表）から全ペアの大人運賃を取り出す。

PDF: https://www.obako5.com/チケット/線内の運賃/ の「普通運賃表」
     （wp-content/uploads/2019/09/0e470b007849bb4e8cf46ad62ab865b8.pdf、令和元年10月1日改正）
テキスト層は小児の値だけ順に並び、大人の値は順序が崩れているので、ページを画像にして
書き写した。ADULT[k] / CHILD[k] は (k+2) 番目の駅から番号の若い駅への運賃で、
羽後本荘側から順に並ぶ。
検算: 各行の値の数、小児が大人の半額（10円未満切り上げ）であること、行・列の単調性。
"""

import json
import math
import os
import sys

STATIONS = [
    "羽後本荘", "薬師堂", "子吉", "鮎川", "黒沢", "曲沢", "前郷", "久保田", "西滝沢", "吉沢", "川辺", "矢島",
]
ADULT = [
    [180],
    [250, 180],
    [330, 250, 180],
    [400, 330, 250, 180],
    [400, 330, 250, 180, 180],
    [400, 400, 330, 250, 180, 180],
    [460, 400, 400, 330, 250, 250, 180],
    [510, 460, 400, 330, 330, 250, 250, 180],
    [510, 460, 460, 400, 330, 330, 250, 250, 180],
    [560, 510, 510, 460, 400, 400, 330, 330, 250, 180],
    [610, 560, 560, 510, 460, 460, 400, 400, 330, 250, 180],
]
CHILD = [
    [90],
    [130, 90],
    [170, 130, 90],
    [200, 170, 130, 90],
    [200, 170, 130, 90, 90],
    [200, 200, 170, 130, 90, 90],
    [230, 200, 200, 170, 130, 130, 90],
    [260, 230, 200, 170, 170, 130, 130, 90],
    [260, 230, 230, 200, 170, 170, 130, 130, 90],
    [280, 260, 260, 230, 200, 200, 170, 170, 130, 90],
    [310, 280, 280, 260, 230, 230, 200, 200, 170, 130, 90],
]

fare = {}
for k, (row, kids) in enumerate(zip(ADULT, CHILD)):
    to = k + 1
    if len(row) != to or len(kids) != to:
        raise SystemExit(f"{STATIONS[to]}: 値の数が {to} でない")
    for frm, (v, c) in enumerate(zip(row, kids)):
        if c != math.ceil(v / 2 / 10) * 10:
            raise SystemExit(f"{STATIONS[frm]}→{STATIONS[to]}: 小児 {c} が大人 {v} の半額と違う")
        fare[(frm, to)] = v

n = len(STATIONS)
pairs = []
for i in range(n):
    for j in range(i + 1, n):
        if j > i + 1 and fare[(i, j)] < fare[(i, j - 1)]:
            raise SystemExit(f"{STATIONS[i]}→{STATIONS[j]}: 手前の駅より安い")
        if j > i + 1 and fare[(i, j)] < fare[(i + 1, j)]:
            raise SystemExit(f"{STATIONS[i]}→{STATIONS[j]}: 発駅が遠いほうが安い")
        pairs.append({"from": STATIONS[i], "to": STATIONS[j], "km": None, "fare": fare[(i, j)]})

out_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
out = os.path.join(out_dir, "yuri-kogen-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
