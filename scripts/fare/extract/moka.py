"""真岡鐵道の運賃表（公式サイトの行列）から全ペアの大人運賃を取り出す。

ページ: https://www.moka-railway.co.jp/fare/ （「運賃表」、2019年10月1日改定。HTML を moka.html で置く）
同じ内容の三角表PDF（pdf/hutsuunchin_20191001.pdf）もある。

表の形: 1行目が駅名、2行目以降は「発駅 | 着駅ごとの『大人 小児』…」の全行列（対角は「– –」）。
検算: 17駅の行がそろうこと、往復で同額になること、小児が大人の半額（10円未満切り上げ）
であること、各行が遠い駅ほど高いか同じこと。
"""

import html
import json
import math
import os
import re
import sys

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = open(os.path.join(pdf_dir, "moka.html"), encoding="utf-8").read()


def text_of(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<.*?>", " ", fragment))).strip()


table = re.search(r"<table.*?</table>", page, re.S).group(0)
rows = [
    [text_of(c) for c in re.findall(r"<t[hd].*?</t[hd]>", r, re.S)]
    for r in re.findall(r"<tr.*?</tr>", table, re.S)
]
# 表の「二高前」は略称。駅名は下館二高前
NAME_MAP = {"二高前": "下館二高前"}
stations = [NAME_MAP.get(s, s) for s in rows[0][1:]]
n = len(stations)
if n != 17 or len(rows) != n + 1:
    raise SystemExit(f"駅数が17でない: {stations}")

adult: dict[tuple[int, int], int] = {}
for i, row in enumerate(rows[1:]):
    if NAME_MAP.get(row[0], row[0]) != stations[i] or len(row) != n + 1:
        raise SystemExit(f"{i}行目の形が違う: {row[:2]}")
    for j, cell in enumerate(row[1:]):
        if i == j:
            continue
        m = re.fullmatch(r"([\d,]+) ([\d,]+)", cell)
        if not m:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 読めないセル {cell!r}")
        fare, kid = (int(g.replace(",", "")) for g in m.groups())
        if kid != math.ceil(fare / 2 / 10) * 10:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 小児 {kid} が大人 {fare} の半額と違う")
        adult[(i, j)] = fare

pairs = []
for i in range(n):
    for j in range(i + 1, n):
        if adult[(i, j)] != adult[(j, i)]:
            raise SystemExit(f"{stations[i]}〜{stations[j]}: 往復で額が違う")
        if j > i + 1 and adult[(i, j)] < adult[(i, j - 1)]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 手前の駅より安い")
        if j > i + 1 and adult[(i, j)] < adult[(i + 1, j)]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 発駅が遠いほうが安い")
        pairs.append({"from": stations[i], "to": stations[j], "km": None, "fare": adult[(i, j)]})

out = os.path.join(pdf_dir, "moka-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
