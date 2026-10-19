"""野岩鉄道 会津鬼怒川線の片道普通運賃表（公式サイトの三角表）から全ペアの大人運賃を取り出す。

ページ: https://www.yagan.co.jp/fare/ （「野岩鉄道･会津鬼怒川線 片道普通運賃表」。HTML を yagan.html で置く）

表の形: 1行目が着駅、2行目以降は「新藤原からの運賃…| 発駅 |（空）…」の下三角。
セルは「大人 小児」。駅名はセル内で改行されている（「川治 温泉」）ので空白を詰める。
検算: 9駅がそろうこと、小児が大人の半額（10円未満切り上げ）であること、行・列の単調性。
"""

import html
import json
import math
import os
import re
import sys

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = open(os.path.join(pdf_dir, "yagan.html"), encoding="utf-8").read()


def text_of(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<.*?>", " ", fragment))).strip()


table = re.search(r"<table.*?</table>", page, re.S).group(0)
rows = [
    [text_of(c) for c in re.findall(r"<t[hd].*?</t[hd]>", r, re.S)]
    for r in re.findall(r"<tr.*?</tr>", table, re.S)
]
stations = [s.replace(" ", "") for s in rows[0][1:]]
n = len(stations)
if n != 9:
    raise SystemExit(f"駅数が9でない: {stations}")

fare = {}
for k, row in enumerate(rows[1:]):
    if row[k].replace(" ", "") != stations[k]:
        raise SystemExit(f"{k}行目の駅名が違う: {row[k]}")
    for frm, cell in enumerate(row[:k]):
        m = re.fullmatch(r"(\d+) (\d+)", cell)
        if not m:
            raise SystemExit(f"{stations[frm]}→{stations[k]}: 読めないセル {cell!r}")
        adult, kid = int(m.group(1)), int(m.group(2))
        if kid != math.ceil(adult / 2 / 10) * 10:
            raise SystemExit(f"{stations[frm]}→{stations[k]}: 小児 {kid} が大人 {adult} の半額と違う")
        fare[(frm, k)] = adult

pairs = []
for i in range(n):
    for j in range(i + 1, n):
        if j > i + 1 and fare[(i, j)] < fare[(i, j - 1)]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 手前の駅より安い")
        if j > i + 1 and fare[(i, j)] < fare[(i + 1, j)]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 発駅が遠いほうが安い")
        pairs.append({"from": stations[i], "to": stations[j], "km": None, "fare": fare[(i, j)]})

out = os.path.join(pdf_dir, "yagan-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
