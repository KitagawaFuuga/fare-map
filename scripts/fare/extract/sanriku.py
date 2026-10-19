"""三陸鉄道の普通運賃表（三角表）から全ペアの大人運賃を取り出す。

PDF: https://www.sanrikutetsudou.com/wp-content/uploads/2026/03/20260314futuunchinhyou.pdf
     （2026年3月14日改正。ファイル名 sanriku.pdf で置く）

表の形: 駅 i の行に、その駅より北（久慈寄り）の駅への運賃が、遠い順（久慈が左端）に並び、
行の右端に駅名がある。駅名より右にある数字は凡例（特定運賃区間 190円）なので読まない。
駅名が値の行と別の高さに置かれている行（綾里・田老）があるので、駅の並びは固定で持つ。
検算: 行 i の値の数が「北にある駅の数」と一致すること、線路に沿って運賃が下がらないこと。
"""

import json
import os
import re
import sys

import pymupdf

STATIONS = [
    "盛", "陸前赤崎", "綾里", "恋し浜", "甫嶺", "三陸", "吉浜", "唐丹", "平田", "釜石",
    "両石", "鵜住居", "大槌", "吉里吉里", "浪板海岸", "岩手船越", "織笠", "陸中山田",
    "豊間根", "払川", "津軽石", "八木沢・宮古短大", "磯鶏", "宮古", "山口団地", "一の渡",
    "佐羽根", "田老", "新田老", "摂待", "岩泉小本", "島越", "田野畑", "普代", "白井海岸",
    "堀内", "野田玉川", "十府ヶ浦海岸", "陸中野田", "陸中宇部", "久慈",
]

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = pymupdf.open(os.path.join(pdf_dir, "sanriku.pdf"))[0]
rows: dict[int, list] = {}
for w in page.get_text("words"):
    y = round((w[1] + w[3]) / 2 / 3) * 3
    rows.setdefault(y, []).append(w)

value_rows = []
for y in sorted(rows):
    words = sorted(rows[y], key=lambda w: w[0])
    labels = [w for w in words if not re.fullmatch(r"[\d,]+", w[4])]
    # 駅名（最初の文字の語）より左の数字だけが運賃。右は凡例
    limit = labels[0][0] if labels else float("inf")
    nums = [int(w[4].replace(",", "")) for w in words if re.fullmatch(r"[\d,]+", w[4]) and w[0] < limit]
    if nums:
        value_rows.append(nums)

n = len(STATIONS)
if len(value_rows) != n - 1:
    raise SystemExit(f"値の行が {len(value_rows)} 行（想定 {n - 1}）")
pairs = []
for i, nums in enumerate(value_rows):
    if len(nums) != n - 1 - i:
        raise SystemExit(f"{STATIONS[i]} の値が {len(nums)} 個（想定 {n - 1 - i}）")
    # 左端が久慈（最も遠い駅）。近い順に並べ直す
    nearest_first = list(reversed(nums))
    for k, fare in enumerate(nearest_first):
        pairs.append({"from": STATIONS[i], "to": STATIONS[i + 1 + k], "km": None, "fare": fare})
    if any(b < a for a, b in zip(nearest_first, nearest_first[1:])):
        raise SystemExit(f"{STATIONS[i]} から北へ運賃が下がる: {nearest_first}")

out = os.path.join(pdf_dir, "sanriku-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} ペア -> {out}")
