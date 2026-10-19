"""肥薩おれんじ鉄道の普通運賃表（三角表）から全ペアの大人運賃を取り出す。

PDF: https://www.hs-orange.com/page973.html の「普通運賃（大人・小児）三角運賃表」
     （UploadFileOutput.ashx?c_id=3&id=973&sub_id=1&flid=3069、2024年10月1日改定。
     ファイル名 orange.pdf で置く）

表の形: 駅 i ごとに2行（上段が大人、下段が小児）。その駅より川内寄りの駅への運賃が
近い順に並ぶ。大人の行の先頭の文字の語が駅名（凡例の文が同じ行に入ることがあるので、
数字の直前の語を採る）。
検算: 行の値の数、小児運賃が全組で大人運賃の半額（10円未満切り上げ）になること。
"""

import json
import os
import re
import sys

import pymupdf

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = pymupdf.open(os.path.join(pdf_dir, "orange.pdf"))[0]
rows: dict[int, list] = {}
for w in page.get_text("words"):
    y = round((w[1] + w[3]) / 2 / 3) * 3
    rows.setdefault(y, []).append(w)

is_num = lambda s: re.fullmatch(r"[\d,]+", s) is not None
# 凡例（「上段：大人普通運賃」「※小児の…」）と全角空白だけの語は駅名ではない
is_legend = lambda s: s.strip() == "" or any(c in s for c in "：※") or "端数" in s

value_lines = []  # (数字の直前の語, 値)
last_name = None
for y in sorted(rows):
    words = sorted(rows[y], key=lambda w: w[0])
    nums = [w for w in words if is_num(w[4])]
    labels = [w[4] for w in words if not is_num(w[4]) and not is_legend(w[4])]
    if not nums:
        if len(labels) == 1:
            last_name = labels[0]  # 値の無い最後の駅（川内）
        continue
    before = [w[4] for w in words if not is_num(w[4]) and not is_legend(w[4]) and w[0] < nums[0][0]]
    value_lines.append((before[-1] if before else None, [int(w[4].replace(",", "")) for w in nums]))

# 値のある行は、駅ごとに大人・小児の順で交互に並ぶ
if len(value_lines) % 2 != 0:
    raise SystemExit(f"値の行が奇数: {len(value_lines)}")
stations, adult, child = [], [], []
for k in range(0, len(value_lines), 2):
    (name, a), (other, c) = value_lines[k], value_lines[k + 1]
    if name is None or other is not None:
        raise SystemExit(f"大人と小児の行の並びが想定と違う: {name} / {other}")
    stations.append(name)
    adult.append(a)
    child.append(c)
if last_name is None:
    raise SystemExit("最後の駅の名前が無い")
stations.append(last_name)

n = len(stations)
pairs = []
for a in range(n - 1):
    if len(adult[a]) != n - 1 - a or len(child[a]) != n - 1 - a:
        raise SystemExit(f"{stations[a]} の値の数が合わない: {len(adult[a])}")
    for k, fare in enumerate(adult[a]):
        if child[a][k] != -(-fare // 20) * 10:
            raise SystemExit(f"{stations[a]}-{stations[a + 1 + k]}: 大人{fare} 小児{child[a][k]}")
        pairs.append({"from": stations[a], "to": stations[a + 1 + k], "km": None, "fare": fare})

out = os.path.join(pdf_dir, "orange-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{n} 駅 {len(pairs)} ペア -> {out}")
print("、".join(stations))
