"""ひたちなか海浜鉄道 湊線の普通旅客運賃表（三角表）から全ペアの大人運賃を取り出す。

PDF: http://www.hitachinaka-rail.co.jp/timetable/ の「運賃表ダウンロード」（fare_2021.pdf）。
     同じページに HTML の運賃表もあり、値は同じ（2026-10 時点）。
ページを画像にして書き写した。ADULT[k] / CHILD[k] は (k+2) 番目の駅から番号の若い駅への
運賃で、勝田側から順に並ぶ。表の「工機前」は現在の日工前（駅データ.jp は旧名のままなので
data/station-corrections.json で直している）。
検算: 各行の値の数、小児が大人の半額（10円未満切り上げ）であること、行・列の単調性。
"""

import json
import math
import os
import sys

STATIONS = [
    "勝田", "日工前", "金上", "中根", "高田の鉄橋", "那珂湊", "殿山", "平磯", "美乃浜学園", "磯崎", "阿字ヶ浦",
]
ADULT = [
    [150],
    [150, 150],
    [190, 190, 150],
    [310, 260, 230, 150],
    [350, 310, 260, 150, 150],
    [380, 350, 310, 190, 150, 150],
    [420, 420, 350, 230, 150, 150, 150],
    [490, 460, 420, 310, 230, 190, 150, 150],
    [530, 490, 460, 350, 260, 230, 150, 150, 150],
    [570, 530, 490, 380, 310, 260, 190, 150, 150, 150],
]
CHILD = [
    [80],
    [80, 80],
    [100, 100, 80],
    [160, 130, 120, 80],
    [180, 160, 130, 80, 80],
    [190, 180, 160, 100, 80, 80],
    [210, 210, 180, 120, 80, 80, 80],
    [250, 230, 210, 160, 120, 100, 80, 80],
    [270, 250, 230, 180, 130, 120, 80, 80, 80],
    [290, 270, 250, 190, 160, 130, 100, 80, 80, 80],
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
out = os.path.join(out_dir, "hitachinaka-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
