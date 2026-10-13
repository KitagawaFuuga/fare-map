"""北条鉄道の運賃表（公式サイトの表）から全ペアの大人運賃を取り出す。

ページ: http://www.hojorailway.jp/afare （「運賃」。HTML を hojo.html で置く）

表の形: 1つの表の左上が営業キロ、右下が運賃。各行は「キロ…| 駅名 | 運賃…」で、
運賃は「大人円 小児円」。運賃は近い駅から順に並び、最後が粟生から（粟生の行は運賃が無い）。
検算: 8駅がそろうこと、各行の値の数、小児が大人の半額（10円未満切り上げ）であること、
行・列の単調性。
"""

import html
import json
import math
import os
import re
import sys

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = open(os.path.join(pdf_dir, "hojo.html"), encoding="utf-8").read()


def text_of(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<.*?>", " ", fragment))).strip()


table = re.search(r"<table.*?</table>", page, re.S).group(0)
stations: list[str] = []
fare = {}
for r in re.findall(r"<tr.*?</tr>", table, re.S):
    cells = [text_of(c) for c in re.findall(r"<t[hd].*?</t[hd]>", r, re.S)]
    name_at = next(i for i, c in enumerate(cells) if not c.endswith("km"))
    stations.append(cells[name_at])
    k = len(stations) - 1
    values = cells[name_at + 1 :]
    if len(values) != k:
        raise SystemExit(f"{cells[name_at]}: 運賃が {len(values)} 個（期待 {k}）")
    for d, cell in enumerate(values):
        m = re.fullmatch(r"(\d+)円 (\d+)円", cell)
        if not m:
            raise SystemExit(f"{cells[name_at]}: 読めないセル {cell!r}")
        adult, kid = int(m.group(1)), int(m.group(2))
        if kid != math.ceil(adult / 2 / 10) * 10:
            raise SystemExit(f"{cells[name_at]}: 小児 {kid} が大人 {adult} の半額と違う")
        # 近い駅から順に並ぶ
        fare[(k - 1 - d, k)] = adult

n = len(stations)
if n != 8:
    raise SystemExit(f"駅数が8でない: {stations}")
pairs = []
for i in range(n):
    for j in range(i + 1, n):
        if j > i + 1 and fare[(i, j)] < fare[(i, j - 1)]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 手前の駅より安い")
        if j > i + 1 and fare[(i, j)] < fare[(i + 1, j)]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 発駅が遠いほうが安い")
        pairs.append({"from": stations[i], "to": stations[j], "km": None, "fare": fare[(i, j)]})

out = os.path.join(pdf_dir, "hojo-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
