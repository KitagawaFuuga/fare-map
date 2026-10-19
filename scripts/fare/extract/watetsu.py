"""わたらせ渓谷鐵道の普通旅客運賃表（公式サイトの行列）から全ペアの大人運賃を取り出す。

ページ: https://www.watetsu.com/rail-info/fare.php （「普通旅客運賃表」、2019年10月1日改定。
EUC-JP の HTML を watetsu.html で置く）

表の形: 1行目が見出し、2行目以降は駅ごとに「小児運賃…| 駅名 | 普通運賃…」。
対角の駅名より右上が大人、左下が小児。数値は「1,010」のようにカンマ入り。
検算: 17駅の行がそろうこと、小児が大人の半額（10円未満切り上げ）であること、
各行・各列が遠い駅ほど高いか同じこと。
"""

import html
import json
import math
import os
import re
import sys

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = open(os.path.join(pdf_dir, "watetsu.html"), "rb").read().decode("euc-jp")


def text_of(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<.*?>", " ", fragment))).strip()


table = next(t for t in re.findall(r"<table.*?</table>", page, re.S) if "下新田" in t and "小児運賃" in t)
rows = [
    [text_of(c) for c in re.findall(r"<t[hd].*?</t[hd]>", r, re.S)]
    for r in re.findall(r"<tr.*?</tr>", table, re.S)
][1:]
if len(rows) != 17:
    raise SystemExit(f"行数が17でない: {len(rows)}")

stations = [r[i] for i, r in enumerate(rows)]
n = len(stations)
adult = [[int(c.replace(",", "")) if c and i != j else 0 for j, c in enumerate(r)] for i, r in enumerate(rows)]
for i in range(n):
    if len(rows[i]) != n:
        raise SystemExit(f"{stations[i]}: 列数 {len(rows[i])}")

pairs = []
for i in range(n):
    for j in range(i + 1, n):
        fare, kid = adult[i][j], adult[j][i]
        if kid != math.ceil(fare / 2 / 10) * 10:
            raise SystemExit(f"{stations[i]}〜{stations[j]}: 小児 {kid} が大人 {fare} の半額と違う")
        if j > i + 1 and fare < adult[i][j - 1]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 手前の駅より安い")
        if i + 1 < j and fare < adult[i + 1][j]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 発駅が遠いほうが安い")
        pairs.append({"from": stations[i], "to": stations[j], "km": None, "fare": fare})

out = os.path.join(pdf_dir, "watetsu-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
