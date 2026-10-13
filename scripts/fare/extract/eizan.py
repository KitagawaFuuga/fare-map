"""叡山電鉄の各駅間の普通運賃（公式サイトの画像の表）を書き起こした値から全ペアを作る。

画像: https://eizandensha.co.jp/guide/fare/ の「各駅間の普通運賃」
     （wp-content/uploads/2023/04/futsuu2023.04.01.jpg、2023年4月1日改定）
区制（1区220円〜5区470円）だが、表は駅番号 E01〜E17 の全組を並べているので、区の境界を
推測せず駅ペアの額として持つ。画像を拡大して目視で書き起こした。ROWS[k] は E(k+1) から
番号の大きい駅への運賃で、番号順に並ぶ。叡山本線（E01〜E08）と鞍馬線（宝ヶ池 E06 で分岐、
E09〜E17）が1つの表に入っている。
検算: 各行の値の数、区の額のどれかであること、出町柳〜八瀬比叡山口・出町柳〜鞍馬の
それぞれの経路の上で行・列が単調であること。
"""

import json
import os
import sys

# 駅データの表記（宝ヶ池）に合わせる。画像は「宝ケ池」
STATIONS = [
    "出町柳", "元田中", "茶山・京都芸術大学", "一乗寺", "修学院", "宝ヶ池", "三宅八幡", "八瀬比叡山口",
    "八幡前", "岩倉", "木野", "京都精華大前", "二軒茶屋", "市原", "二ノ瀬", "貴船口", "鞍馬",
]
ROWS = [
    [220, 220, 220, 220, 280, 280, 280, 280, 280, 350, 350, 350, 410, 410, 470, 470],
    [220, 220, 220, 280, 280, 280, 280, 280, 350, 350, 350, 410, 410, 470, 470],
    [220, 220, 280, 280, 280, 280, 280, 350, 350, 350, 410, 410, 470, 470],
    [220, 280, 280, 280, 280, 280, 350, 350, 350, 410, 410, 470, 470],
    [220, 220, 220, 220, 220, 280, 280, 280, 350, 350, 410, 410],
    [220, 220, 220, 220, 280, 280, 280, 350, 350, 410, 410],
    [220, 280, 280, 350, 350, 350, 410, 410, 470, 470],
    [280, 280, 350, 350, 350, 410, 410, 470, 470],
    [220, 280, 280, 280, 350, 350, 410, 410],
    [220, 220, 220, 280, 280, 350, 350],
    [220, 220, 280, 280, 350, 350],
    [220, 280, 280, 350, 350],
    [220, 220, 280, 280],
    [220, 280, 280],
    [220, 220],
    [220],
]
ZONE_FARES = {220, 280, 350, 410, 470}
PATHS = [list(range(0, 8)), list(range(0, 6)) + list(range(8, 17))]

n = len(STATIONS)
fare = {}
for i, row in enumerate(ROWS):
    if len(row) != n - 1 - i:
        raise SystemExit(f"{STATIONS[i]}: 値が {len(row)} 個（期待 {n - 1 - i}）")
    for k, v in enumerate(row):
        if v not in ZONE_FARES:
            raise SystemExit(f"{STATIONS[i]}: 区の額でない {v}")
        fare[(i, i + 1 + k)] = fare[(i + 1 + k, i)] = v

for path in PATHS:
    for a in range(len(path)):
        for b in range(a + 2, len(path)):
            i, j = path[a], path[b]
            if fare[(i, j)] < fare[(i, path[b - 1])]:
                raise SystemExit(f"{STATIONS[i]}→{STATIONS[j]}: 手前の駅より安い")
            if fare[(i, j)] < fare[(path[a + 1], j)]:
                raise SystemExit(f"{STATIONS[i]}→{STATIONS[j]}: 発駅が遠いほうが安い")

pairs = [
    {"from": STATIONS[i], "to": STATIONS[j], "km": None, "fare": fare[(i, j)]}
    for i in range(n)
    for j in range(i + 1, n)
]
out_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
out = os.path.join(out_dir, "eizan-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
