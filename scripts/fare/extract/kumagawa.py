"""くま川鉄道 湯前線の運賃表（公式サイトの時刻表画像の三角表）を書き起こした値から全ペアを作る。

画像: https://kumagawa-rail.com/time-fare/ の「くま川鉄道 湯前線 時刻表」
     （wp-content/uploads/2026/09/unchin_jikoku_260920_page-0001-edited.jpg、2026年9月20日改正）
画像なのでテキスト層が無く、拡大して目視で書き起こした。ROWS[k] は (k+2) 番目の駅から
番号の若い駅への運賃で、人吉温泉側から順に並ぶ。
検算: 各行の値の数、着駅を固定して発駅を遠ざけたとき・発駅を固定して着駅を遠ざけたときに
運賃が下がらないこと。
"""

import json
import os
import sys

STATIONS = [
    "人吉温泉", "相良藩願成寺", "相良十島", "肥後西村", "一武", "木上", "おかどめ幸福", "あさぎり",
    "東免田", "公立病院前", "多良木", "多良木青蓮寺", "新鶴羽", "湯前",
]
ROWS = [
    [190],
    [220, 190],
    [250, 220, 190],
    [340, 290, 250, 220],
    [380, 340, 290, 250, 190],
    [380, 380, 340, 290, 220, 190],
    [430, 430, 380, 340, 250, 220, 190],
    [530, 480, 430, 380, 290, 250, 220, 190],
    [530, 480, 430, 380, 340, 290, 250, 220, 190],
    [590, 530, 480, 430, 340, 290, 250, 220, 190, 190],
    [650, 590, 530, 480, 380, 340, 290, 250, 220, 220, 190],
    [700, 650, 590, 530, 430, 380, 340, 290, 250, 220, 220, 190],
    [700, 700, 650, 530, 480, 430, 380, 340, 290, 250, 220, 220, 190],
]

fare = {}
for k, row in enumerate(ROWS):
    to = k + 1
    if len(row) != to:
        raise SystemExit(f"{STATIONS[to]}: 値が {len(row)} 個（期待 {to}）")
    for frm, v in enumerate(row):
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
out = os.path.join(out_dir, "kumagawa-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
