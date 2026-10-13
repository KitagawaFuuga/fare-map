"""山形鉄道 フラワー長井線の駅間運賃（公式サイトの三角表）から全ペアの大人運賃を取り出す。

ページ: https://flower-liner.jp/fare/ （「運賃表」。HTML を flower-nagai.html で置く）

表の形: 1行目が南陽市役所〜荒砥の駅名、2行目以降は「（空）| 発駅 | 番号の大きい駅への運賃…| 発駅」。
セルは「大人 (小児)」。発駅より前のセルは読み飛ばす。
検算: 17駅の行がそろうこと、各行の値の数、各行・各列が遠い駅ほど高いか同じこと、
小児が大人の半額（10円未満切り上げ）であること。小児の誤記が分かっているセルは
CHILD_TYPOS に挙げ、大人の額を採る。
"""

import html
import json
import math
import os
import re
import sys

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = open(os.path.join(pdf_dir, "flower-nagai.html"), encoding="utf-8").read()


def text_of(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<.*?>", " ", fragment))).strip()


table = re.search(r"<table.*?</table>", page, re.S).group(0)
rows = [
    [text_of(c) for c in re.findall(r"<t[hd].*?</t[hd]>", r, re.S)]
    for r in re.findall(r"<tr.*?</tr>", table, re.S)
]
# 見出し行は2駅目（南陽市役所）から並ぶ
stations = ["赤湯"] + rows[0][1:-1]
if len(stations) != 17:
    raise SystemExit(f"駅数が17でない: {stations}")

# 公式表の小児の誤記（大人額からの半額と合わない）。2026-10 時点
CHILD_TYPOS = {("時庭", "白兎"), ("時庭", "蚕桑")}

pairs = []
matrix: dict[tuple[int, int], int] = {}
problems = []
for row in rows[1:]:
    cells = [c for c in row if c]
    # あやめ公園の行は先頭に凡例（「（大人）…」）のセルが入っている
    while cells and cells[0] not in stations:
        cells = cells[1:]
    if not cells:
        continue
    i = stations.index(cells[0])
    values = [c for c in cells[1:] if c != cells[0] and re.match(r"\d", c)]
    if len(values) != len(stations) - 1 - i:
        raise SystemExit(f"{cells[0]}: 値が {len(values)} 個（期待 {len(stations) - 1 - i}）")
    for k, v in enumerate(values):
        m = re.fullmatch(r"(\d+)\s*\(?\s*(\d+)\s*\)", v)
        if not m:
            raise SystemExit(f"{cells[0]}: 読めないセル {v!r}")
        adult, kid = int(m.group(1)), int(m.group(2))
        j = i + 1 + k
        if kid != math.ceil(adult / 2 / 10) * 10:
            problems.append((stations[i], stations[j], adult, kid))
        matrix[(i, j)] = adult
        pairs.append({"from": stations[i], "to": stations[j], "km": None, "fare": adult})

unknown = [p for p in problems if (p[0], p[1]) not in CHILD_TYPOS]
if unknown:
    raise SystemExit(f"小児が大人の半額と合わない: {unknown}")
n = len(stations)
for i in range(n):
    for j in range(i + 2, n):
        if matrix[(i, j)] < matrix[(i, j - 1)]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 手前の駅より安い")
        if matrix[(i, j)] < matrix[(i + 1, j)]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 発駅が遠いほうが安い")

out = os.path.join(pdf_dir, "flower-nagai-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs, child typos {len(problems)}")
