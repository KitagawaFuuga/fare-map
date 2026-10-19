"""千葉都市モノレールの普通旅客運賃表（全駅間の行列）から全ペアの大人運賃を取り出す。

PDF: https://chiba-monorail.co.jp/wp/wp-content/uploads/dad76e25ad9c360f9e5aba5cf6329eb8.pdf
     （2019年10月1日改定の普通旅客運賃表。ファイル名 chiba.pdf で置く）

表の形: 駅ごとに2行（上段 10円単位のきっぷ運賃、下段 1円単位のIC運賃）。
1行は自駅を除く17駅ぶんの値で、自駅より前の駅は小児運賃、後の駅は大人運賃。
したがって大人運賃は「行 i の、自駅より後ろの値」だけを使う。
駅名はテキスト層で読めるが、行と値の対応は並びで決まるので、駅の並びを固定で持つ。
"""

import json
import os
import re
import sys

import pymupdf

STATIONS = [
    "県庁前", "葭川公園", "栄町", "千葉みなと", "市役所前", "千葉",
    "千葉公園", "作草部", "天台", "穴川", "スポーツセンター", "動物公園",
    "みつわ台", "都賀", "桜木", "小倉台", "千城台北", "千城台",
]

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
doc = pymupdf.open(os.path.join(pdf_dir, "chiba.pdf"))
rows: dict[int, list] = {}
for w in doc[0].get_text("words"):
    y = round((w[1] + w[3]) / 2 / 4) * 4
    rows.setdefault(y, []).append(w)
lines = [[w[4] for w in sorted(rows[y], key=lambda w: w[0])] for y in sorted(rows)]
nums = [l for l in lines if l and all(re.fullmatch(r"\d+", x) for x in l)]
# 駅ごとに上段（10円単位）と下段（1円単位）の2行
if len(nums) != len(STATIONS) * 2 or any(len(l) != len(STATIONS) - 1 for l in nums):
    raise SystemExit(f"表の形が想定と違う: {len(nums)}行 {[len(l) for l in nums]}")
ticket = [list(map(int, nums[i])) for i in range(0, len(nums), 2)]

pairs = []
for i, a in enumerate(STATIONS):
    for j in range(i + 1, len(STATIONS)):
        pairs.append({"from": a, "to": STATIONS[j], "km": None, "fare": ticket[i][j - 1]})

# 検算: 同じ組を行 j の小児運賃（自駅より前）から見ると、大人運賃の半額（10円未満切り上げ）
for i in range(len(STATIONS)):
    for j in range(i + 1, len(STATIONS)):
        child = ticket[j][i]
        adult = ticket[i][j - 1]
        if child != -(-adult // 20) * 10:
            raise SystemExit(f"小児運賃と合わない: {STATIONS[i]}-{STATIONS[j]} 大人{adult} 小児{child}")

out = os.path.join(pdf_dir, "chiba-monorail-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} ペア -> {out}")
