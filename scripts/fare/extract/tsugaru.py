"""津軽鉄道の普通旅客運賃表（三角表）から全ペアの大人運賃を取り出す。

PDF: https://tsutetsu.com/price の「普通旅客運賃表、片道通学定期旅客運賃表」
     （wp-content/uploads/2019/09/bd33ac23bf812b51340f61666c16239c.pdf、令和元年10月1日改正）
テキスト層は読めるが、駅名が縦書きで1文字ずつ割れるので、値は PDF のテキストから
書き写した。ADULT[k] / CHILD[k] は (k+2) 番目の駅から番号の若い駅への運賃で、
津軽五所川原側から順に並ぶ。2024年12月の「運賃割引・料金のご案内」でも最低運賃は180円で、
この表から変わっていない。
検算: 各行の値の数、小児が大人の半額（10円未満切り上げ）であること、行・列の単調性。
"""

import json
import math
import os
import sys

STATIONS = [
    "津軽五所川原", "十川", "五農校前", "津軽飯詰", "毘沙門", "嘉瀬", "金木", "芦野公園", "川倉",
    "大沢内", "深郷田", "津軽中里",
]
ADULT = [
    [180],
    [210, 180],
    [260, 180, 180],
    [400, 360, 260, 210],
    [490, 430, 360, 310, 180],
    [560, 520, 460, 430, 310, 180],
    [650, 560, 520, 490, 360, 260, 180],
    [690, 650, 560, 520, 430, 310, 210, 180],
    [770, 730, 650, 610, 490, 400, 260, 210, 180],
    [800, 770, 690, 650, 520, 430, 360, 260, 180, 180],
    [870, 840, 770, 730, 610, 490, 400, 360, 260, 180, 180],
]
CHILD = [
    [90],
    [110, 90],
    [130, 90, 90],
    [200, 180, 130, 110],
    [250, 220, 180, 160, 90],
    [280, 260, 230, 220, 160, 90],
    [330, 280, 260, 250, 180, 130, 90],
    [350, 330, 280, 260, 220, 160, 110, 90],
    [390, 370, 330, 310, 250, 200, 130, 110, 90],
    [400, 390, 350, 330, 260, 220, 180, 130, 90, 90],
    [440, 420, 390, 370, 310, 250, 200, 180, 130, 90, 90],
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
out = os.path.join(out_dir, "tsugaru-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
