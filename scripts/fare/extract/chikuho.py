"""筑豊電気鉄道の営業粁程及び運賃表（三角表）から全ペアの大人運賃を取り出す。

PDF: https://www.chikutetsu.co.jp/ の「2026年7月18日（土）運賃改定を実施いたします。」
     （data/topics/410_20260528unchinkaitei.pdf の4ページ目。kaitei.pdf で置く）
区制（1区230円〜7区480円）だが、表は全駅の組を並べているので駅ペアの額として持つ。
西黒崎は2026年7月31日に廃止され、表に無い。

表の形: 右上が営業キロ、左下が運賃。テキスト層は上の行（筑豊直方）から順に
「番号 駅名 キロ… 運賃…」と並ぶが、駅のキロの後ろに出る運賃は1つ下の行のもの
（筑豊直方側の駅から順）。つまり運賃の並びは長さ 1, 2, …, 19 の列になる。
検算: 運賃の列の長さ、区の額のどれかであること、行・列の単調性。
表紙の主な区間の運賃（黒崎駅前〜熊西230円、〜森下270円、〜三ヶ森340円、〜筑豊中間380円、
〜筑豊香月420円、〜木屋瀬450円、〜筑豊直方480円）とも突き合わせる。
"""

import json
import os
import re
import sys

import pymupdf

# 表の上（筑豊直方）から下（黒崎駅前）への並び
TOP_DOWN = [
    "筑豊直方", "感田", "遠賀野", "木屋瀬", "新木屋瀬", "楠橋", "筑豊香月", "希望が丘高校前", "筑豊中間",
    "東中間", "通谷", "西山", "三ヶ森", "永犬丸", "今池", "森下", "穴生", "萩原", "熊西", "黒崎駅前",
]
ZONE_FARES = {230, 270, 340, 380, 420, 450, 480}
HEADLINE = {"熊西": 230, "森下": 270, "三ヶ森": 340, "筑豊中間": 380, "筑豊香月": 420, "木屋瀬": 450, "筑豊直方": 480}

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
text = pymupdf.open(os.path.join(pdf_dir, "kaitei.pdf"))[3].get_text()
body = text.split("▼営業キロ程", 1)[1].split("▲普通旅客運賃", 1)[0]

runs: list[list[int]] = []
current: list[int] = []
for line in body.splitlines():
    line = line.strip()
    if re.fullmatch(r"\d{3}", line):
        current.append(int(line))
    elif current:
        runs.append(current)
        current = []
if current:
    runs.append(current)

n = len(TOP_DOWN)
if [len(r) for r in runs] != list(range(1, n)):
    raise SystemExit(f"運賃の列の長さが 1..{n - 1} でない: {[len(r) for r in runs]}")

fare = {}
for k, run in enumerate(runs):
    row = k + 1  # TOP_DOWN の位置
    for col, v in enumerate(run):
        if v not in ZONE_FARES:
            raise SystemExit(f"{TOP_DOWN[row]}: 区の額でない {v}")
        fare[(col, row)] = fare[(row, col)] = v

for name, v in HEADLINE.items():
    if fare[(TOP_DOWN.index("黒崎駅前"), TOP_DOWN.index(name))] != v:
        raise SystemExit(f"黒崎駅前〜{name}: 表紙の {v} 円と違う")

for i in range(n):
    for j in range(i + 2, n):
        if fare[(i, j)] < fare[(i, j - 1)] or fare[(i, j)] < fare[(i + 1, j)]:
            raise SystemExit(f"{TOP_DOWN[i]}〜{TOP_DOWN[j]}: 近い組より安い")

pairs = [
    {"from": TOP_DOWN[j], "to": TOP_DOWN[i], "km": None, "fare": fare[(i, j)]}
    for j in range(n - 1, -1, -1)
    for i in range(j - 1, -1, -1)
]
out = os.path.join(pdf_dir, "chikuho-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
