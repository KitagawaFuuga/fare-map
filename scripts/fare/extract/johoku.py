"""東海交通事業 城北線の運賃表を書き起こした値から全ペアを作る。

画像: https://tkj-i.co.jp/johoku-line/timetable/ の「運賃表」（/assets/images/johoku-line/timetable/fare.png）
画像なのでテキスト層が無く、目視で書き起こした。ROWS[i] は i 番目の駅から
勝川側の駅への大人運賃で、近い順に並ぶ。小児はどのセルも大人の半額（10円未満切り上げ）。
検算: 各行の値の数、行・列の単調性。
"""


import json
import os
import sys

STATIONS = ["枇杷島", "尾張星の宮", "小田井", "比良", "味美", "勝川"]
ROWS = [
    [230, 320, 390, 450, 450],
    [230, 320, 390, 450],
    [230, 320, 390],
    [230, 320],
    [230],
]

n = len(STATIONS)
fare = {}
for i, row in enumerate(ROWS):
    if len(row) != n - 1 - i:
        raise SystemExit(f"{STATIONS[i]}: 値が {len(row)} 個（期待 {n - 1 - i}）")
    for k, v in enumerate(row):
        fare[(i, i + 1 + k)] = v

pairs = []
for i in range(n):
    for j in range(i + 1, n):
        if j > i + 1 and fare[(i, j)] < fare[(i, j - 1)]:
            raise SystemExit(f"{STATIONS[i]}→{STATIONS[j]}: 手前の駅より安い")
        if j > i + 1 and fare[(i, j)] < fare[(i + 1, j)]:
            raise SystemExit(f"{STATIONS[i]}→{STATIONS[j]}: 発駅が遠いほうが安い")
        pairs.append({"from": STATIONS[i], "to": STATIONS[j], "km": None, "fare": fare[(i, j)]})

out_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
out = os.path.join(out_dir, "johoku-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
