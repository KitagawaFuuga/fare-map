"""北越急行ほくほく線の運賃表（三角表）から線内（六日町〜犀潟）の全ペアの大人運賃を取り出す。

PDF: https://hokuhoku.co.jp/unchin.html の「ほくほく線運賃表」（pdf/unchin2026/unchin.pdf。
     2026年3月のJR運賃改定に合わせた版で、ほくほく線区間の運賃は変わっていない。unchin.pdf で置く）

表の形: 越後湯沢〜新井の三角表で、JR線・えちごトキめき鉄道との通し運賃も入っている。
テキスト層は行の順に「その駅の行の値（越後湯沢側から）… 駅名」と並ぶ（犀潟は全角空白入りの「犀　潟」）。
線内だけの区間（表の水色）は六日町〜犀潟の12駅どうしなので、その範囲だけを取る。
検算: 各行の値の数、行・列の単調性。
"""

import json
import os
import re
import sys

import pymupdf

TABLE_STATIONS = [
    "越後湯沢", "塩沢", "六日町", "魚沼丘陵", "美佐島", "しんざ", "十日町", "まつだい", "ほくほく大島",
    "虫川大杉", "うらがわら", "大池いこいの森", "くびき", "犀潟",
]
LINE_FROM = TABLE_STATIONS.index("六日町")

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
text = pymupdf.open(os.path.join(pdf_dir, "unchin.pdf"))[0].get_text()
tokens = re.findall(r"[\d,]+|[^\d\s,]+", text.replace("犀　潟", "犀潟"))

rows: dict[str, list[int]] = {}
pending: list[int] = []
for t in tokens:
    if re.fullmatch(r"[\d,]+", t):
        pending.append(int(t.replace(",", "")))
    elif t in TABLE_STATIONS:
        rows[t] = pending
        pending = []
        if t == TABLE_STATIONS[-1]:
            break

fare = {}
for k, name in enumerate(TABLE_STATIONS):
    row = rows.get(name)
    if row is None or len(row) != k:
        raise SystemExit(f"{name}: 値の数が {k} でない: {row}")
    for frm, v in enumerate(row):
        fare[(frm, k)] = v

stations = TABLE_STATIONS[LINE_FROM:]
n = len(TABLE_STATIONS)
pairs = []
for i in range(LINE_FROM, n):
    for j in range(i + 1, n):
        if j > i + 1 and fare[(i, j)] < fare[(i, j - 1)]:
            raise SystemExit(f"{TABLE_STATIONS[i]}→{TABLE_STATIONS[j]}: 手前の駅より安い")
        if j > i + 1 and fare[(i, j)] < fare[(i + 1, j)]:
            raise SystemExit(f"{TABLE_STATIONS[i]}→{TABLE_STATIONS[j]}: 発駅が遠いほうが安い")
        pairs.append({"from": TABLE_STATIONS[i], "to": TABLE_STATIONS[j], "km": None, "fare": fare[(i, j)]})

out = os.path.join(pdf_dir, "hokuetsu-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(stations)} stations, {len(pairs)} pairs")
