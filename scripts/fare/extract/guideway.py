"""名古屋ガイドウェイバス（ゆとりーとライン）高架区間の運賃表を書き起こした値から全ペアを作る。

画像: https://www.guideway.co.jp/fare/index.html の「[高架区間]」（fare/img/fare01.png）
画像なのでテキスト層が無く、目視で書き起こした。ROWS[i] は i 番目の停留所から
小幡緑地側の停留所への大人運賃で、近い順に並ぶ。区制（1区200円・2区230円・3区250円）。
検算: 各行の値の数、運賃が3つの区の額のどれかであること、行・列の単調性。
"""

import json
import os
import sys

STATIONS = [
    "大曽根", "ナゴヤドーム前矢田", "砂田橋", "守山", "金屋", "川宮", "川村", "白沢渓谷", "小幡緑地",
]
ROWS = [
    [200, 200, 230, 230, 250, 250, 250, 250],
    [200, 200, 230, 230, 250, 250, 250],
    [200, 200, 230, 230, 250, 250],
    [200, 200, 230, 230, 230],
    [200, 200, 230, 230],
    [200, 200, 230],
    [200, 200],
    [200],
]
ZONE_FARES = {200, 230, 250}

n = len(STATIONS)
fare = {}
for i, row in enumerate(ROWS):
    if len(row) != n - 1 - i:
        raise SystemExit(f"{STATIONS[i]}: 値が {len(row)} 個（期待 {n - 1 - i}）")
    for k, v in enumerate(row):
        if v not in ZONE_FARES:
            raise SystemExit(f"{STATIONS[i]}: 区の額でない {v}")
        fare[(i, i + 1 + k)] = v

pairs = []
for i in range(n):
    for j in range(i + 1, n):
        if j > i + 1 and fare[(i, j)] < fare[(i, j - 1)]:
            raise SystemExit(f"{STATIONS[i]}→{STATIONS[j]}: 手前の停留所より安い")
        if j > i + 1 and fare[(i, j)] < fare[(i + 1, j)]:
            raise SystemExit(f"{STATIONS[i]}→{STATIONS[j]}: 発停留所が遠いほうが安い")
        pairs.append({"from": STATIONS[i], "to": STATIONS[j], "km": None, "fare": fare[(i, j)]})

out_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
out = os.path.join(out_dir, "guideway-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
