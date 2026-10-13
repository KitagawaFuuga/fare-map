"""大井川鐵道 大井川本線の駅間運賃（公式サイトの発駅ごとの表）から全ペアの大人運賃を取り出す。

ページ: https://daitetsu.jp/ft_main2604 （「大井川本線 時刻表・運賃」。HTML を daitetsu.html で置く）

ページの形: 発駅ごとに「到着駅・子供料金・大人料金」の表があり、表の直前の文字列の末尾が
発駅名。2022年の台風で川根温泉笹間渡〜千頭が不通のため、表は金谷〜川根温泉笹間渡の12駅。
検算: 12の表がそろうこと、往復で同額になること、子供料金が大人料金の半額
（10円未満切り上げ）であること。大和田の表には川根温泉笹間渡の行が無い（2026-10時点）ので、
片方向にしか無いペアは MISSING に挙げたものだけ逆方向の値で埋める。
"""

import html
import json
import math
import os
import re
import sys

STATIONS = [
    "金谷", "新金谷", "代官町", "日切", "合格", "門出", "神尾", "福用", "大和田", "家山",
    "抜里", "川根温泉笹間渡",
]
MISSING = {("大和田", "川根温泉笹間渡")}

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = open(os.path.join(pdf_dir, "daitetsu.html"), encoding="utf-8").read()


def text_of(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<.*?>", " ", fragment))).strip()


adult: dict[tuple[str, str], int] = {}
child: dict[tuple[str, str], int] = {}
seen = set()
for m in re.finditer(r"<table.*?</table>", page, re.S):
    table = m.group(0)
    if "到着駅" not in table:
        continue
    heading = text_of(page[max(0, m.start() - 600) : m.start()])
    origin = next((s for s in sorted(STATIONS, key=len, reverse=True) if heading.endswith(s)), None)
    if origin is None:
        raise SystemExit(f"発駅が分からない表: …{heading[-40:]}")
    seen.add(origin)
    for row in re.findall(r"<tr.*?</tr>", table, re.S):
        cells = [text_of(c) for c in re.findall(r"<t[hd].*?</t[hd]>", row, re.S)]
        if not cells or cells[0] == "到着駅" or cells[0] == origin:
            continue
        dest, kid, grown = cells[0], cells[1], cells[2]
        if dest not in STATIONS:
            raise SystemExit(f"{origin}: 知らない着駅 {dest}")
        adult[(origin, dest)] = int(grown)
        child[(origin, dest)] = int(kid)

if seen != set(STATIONS):
    raise SystemExit(f"発駅の表が足りない: {sorted(set(STATIONS) - seen)}")

pairs = []
for i, a in enumerate(STATIONS):
    for b in STATIONS[i + 1 :]:
        keys = [k for k in ((a, b), (b, a)) if k in adult]
        if len(keys) < 2 and (a, b) not in MISSING:
            raise SystemExit(f"{a}〜{b}: 片方向の表にしか無い")
        fare = adult[keys[0]]
        if any(adult[k] != fare for k in keys):
            raise SystemExit(f"{a}〜{b}: 往復で額が違う {[adult[k] for k in keys]}")
        half = math.ceil(fare / 2 / 10) * 10
        if any(child[k] != half for k in keys):
            raise SystemExit(f"{a}〜{b}: 子供料金が大人 {fare} の半額 {half} と違う")
        pairs.append({"from": a, "to": b, "km": None, "fare": fare})

out = os.path.join(pdf_dir, "daitetsu-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} ペア -> {out}")
