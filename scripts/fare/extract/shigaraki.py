"""信楽高原鐵道の運賃表（公式サイトの表）から全ペアの大人運賃を取り出す。

ページ: https://koka-skr.co.jp/timetable.html （「営業キロ数／大人運賃」。HTML を shigaraki.html で置く）

表の形: 1つの表の左上が営業キロ、右下が運賃。各行は「キロ…| 駅名 | 運賃…」で、
運賃は「大人 小児」（大人は全角数字）。運賃は近い駅から順に並び、最後が貴生川から。
駅名はセル内で字間が空いている（「雲 井」）ので空白を詰める。
検算: 6駅がそろうこと、各行の値の数、小児が大人の半額（10円未満切り上げ）であること、
行・列の単調性。
"""

import html
import json
import math
import os
import re
import sys
import unicodedata

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = open(os.path.join(pdf_dir, "shigaraki.html"), encoding="utf-8").read()


def text_of(fragment: str) -> str:
    text = unicodedata.normalize("NFKC", html.unescape(re.sub(r"<.*?>", " ", fragment)))
    return re.sub(r"\s+", " ", text).strip()


table = re.search(r"<table.*?</table>", page, re.S).group(0)
stations: list[str] = []
fare = {}
for r in re.findall(r"<tr.*?</tr>", table, re.S):
    cells = [text_of(c) for c in re.findall(r"<t[hd].*?</t[hd]>", r, re.S)]
    name_at = next(i for i, c in enumerate(cells) if not re.fullmatch(r"[\d.]+", c))
    stations.append(cells[name_at].replace(" ", ""))
    k = len(stations) - 1
    values = cells[name_at + 1 :]
    if len(values) != k:
        raise SystemExit(f"{stations[k]}: 運賃が {len(values)} 個（期待 {k}）")
    for d, cell in enumerate(values):
        m = re.fullmatch(r"(\d+) (\d+)", cell)
        if not m:
            raise SystemExit(f"{stations[k]}: 読めないセル {cell!r}")
        adult, kid = int(m.group(1)), int(m.group(2))
        if kid != math.ceil(adult / 2 / 10) * 10:
            raise SystemExit(f"{stations[k]}: 小児 {kid} が大人 {adult} の半額と違う")
        # 近い駅から順に並ぶ
        fare[(k - 1 - d, k)] = adult

n = len(stations)
if n != 6:
    raise SystemExit(f"駅数が6でない: {stations}")
pairs = []
for i in range(n):
    for j in range(i + 1, n):
        if j > i + 1 and fare[(i, j)] < fare[(i, j - 1)]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 手前の駅より安い")
        if j > i + 1 and fare[(i, j)] < fare[(i + 1, j)]:
            raise SystemExit(f"{stations[i]}→{stations[j]}: 発駅が遠いほうが安い")
        pairs.append({"from": stations[i], "to": stations[j], "km": None, "fare": fare[(i, j)]})

out = os.path.join(pdf_dir, "shigaraki-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} pairs")
