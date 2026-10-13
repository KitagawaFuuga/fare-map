"""岳南鉄道（岳南電車）の運賃表（公式サイトの三角表）から全ペアの大人運賃を取り出す。

ページ: https://www.gakutetsu.jp/fare/fare.html （「運賃表（通常）」、2023年10月1日から。
HTML を gakunan.html で置く）

表の形: 各行は「（空）| 発駅 | 番号の大きい駅への運賃…」で、吉原の行だけ先頭の空セルが無い。
駅名はセル内で改行されている（「ジヤ トコ前」）ので空白を詰める。
検算: 各行の値の数、行・列の単調性。
"""

import html
import json
import os
import re
import sys

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = open(os.path.join(pdf_dir, "gakunan.html"), encoding="utf-8").read()


def text_of(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<.*?>", " ", fragment))).strip()


table = re.search(r"<table.*?</table>", page, re.S).group(0)
rows = []
for r in re.findall(r"<tr.*?</tr>", table, re.S):
    cells = [text_of(c) for c in re.findall(r"<t[hd].*?</t[hd]>", r, re.S)]
    cells = [c for c in cells if c]
    if cells:
        rows.append((cells[0].replace(" ", ""), [int(v) for v in cells[1:]]))

# 駅データでは副名称つきの正式名
GRAPH_NAMES = {"ジヤトコ前": "ジヤトコ前（ジヤトコ１地区前）"}
stations = [GRAPH_NAMES.get(name, name) for name, _ in rows]
n = len(stations)
if n != 10:
    raise SystemExit(f"駅数が10でない: {stations}")
fare = {}
for i, (name, values) in enumerate(rows):
    if len(values) != n - 1 - i:
        raise SystemExit(f"{name}: 値が {len(values)} 個（期待 {n - 1 - i}）")
    for k, v in enumerate(values):
        fare[(i, i + 1 + k)] = v

pairs = []
for i in range(n):
    for j in range(i + 1, n):
        if j > i + 1 and fare[(i, j)] < fare[(i, j - 1)]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 手前の駅より安い")
        if j > i + 1 and fare[(i, j)] < fare[(i + 1, j)]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 発駅が遠いほうが安い")
        pairs.append({"from": stations[i], "to": stations[j], "km": None, "fare": fare[(i, j)]})

out = os.path.join(pdf_dir, "gakunan-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
