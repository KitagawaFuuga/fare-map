"""阿武隈急行の運賃表（三角表）から全ペアの大人運賃を取り出す。

PDF: https://www.abukyu.co.jp/faretable/ の「運賃表（PDF）」
     （wp-content/themes/abu/dist/img/webp/pdf/unchin_201910.pdf、令和元年10月1日改正。
     ファイル名 abukyu.pdf で置く）

表の形: 駅名の直後に、その駅より槻木寄りの全駅への運賃が近い順に並ぶ（福島は23個、
東船岡は1個）。注記の行（「※　学院前＝福島学院前」など）が途中に挟まる。
検算: 行の値の数が駅の順番に一致すること、各行が遠い駅ほど高いか同じこと、
同じ着駅への運賃が近い発駅ほど安いか同じこと。
"""

import json
import os
import re
import sys

import pymupdf

STATIONS = [
    "福島", "卸町", "福島学院前", "瀬上", "向瀬上", "高子", "上保原", "保原", "大泉",
    "二井田", "新田", "梁川", "やながわ希望の森公園前", "富野", "兜", "あぶくま", "丸森",
    "北丸森", "南角田", "角田", "横倉", "岡", "東船岡", "槻木",
]
# 表の中の略称（表の注記による）
ALIASES = {"学院前": "福島学院前", "公園前": "やながわ希望の森公園前"}

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = pymupdf.open(os.path.join(pdf_dir, "abukyu.pdf"))[0]
rows: dict[str, list[int]] = {}
current = None
for line in (l.strip() for l in page.get_text().split("\n")):
    if not line:
        continue
    if re.fullmatch(r"\d+", line):
        if current is not None:
            rows[current].append(int(line))
        continue
    name = ALIASES.get(line, line)
    current = name if name in STATIONS else None
    if current is not None:
        rows[current] = []

pairs = []
for i, origin in enumerate(STATIONS):
    values = rows.get(origin)
    expected = len(STATIONS) - 1 - i
    if values is None or len(values) != expected:
        raise SystemExit(f"{origin}: 値の数 {None if values is None else len(values)}（期待 {expected}）")
    if any(b < a for a, b in zip(values, values[1:])):
        raise SystemExit(f"{origin}: 遠い駅のほうが安い {values}")
    for k, fare in enumerate(values):
        pairs.append({"from": origin, "to": STATIONS[i + 1 + k], "km": None, "fare": fare})

fare = {(p["from"], p["to"]): p["fare"] for p in pairs}
for j, dest in enumerate(STATIONS[1:], start=1):
    col = [fare[(STATIONS[i], dest)] for i in range(j)]
    if any(b > a for a, b in zip(col, col[1:])):
        raise SystemExit(f"{dest} への運賃が近い発駅ほど高い {col}")

out = os.path.join(pdf_dir, "abukuma-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} ペア -> {out}")
