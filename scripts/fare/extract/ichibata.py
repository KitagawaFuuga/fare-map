"""一畑電車の普通旅客運賃表（全駅、1ページ）から全ペアの大人運賃を取り出す。

PDF: https://railway.ichibata.co.jp/fare/futsu/ の「全駅普通旅客運賃表（PDF）」
     （wp-content/media/fare20250301.pdf、令和7年3月1日改定。ファイル名 ichibata.pdf で置く）

表の形: 26駅の正方行列。行と列はどちらも北松江線22駅（電鉄出雲市→松江しんじ湖温泉）の
あとに大社線の4駅（高浜→出雲大社前）が続く。対角に駅名があり、右上が大人運賃、
左下が小人運賃。駅名の直後の値はくっついて1語になる（「出雲市190」）ので末尾の数字を取る。
数字の語は y で行、x で列に割り当てる（列は約28.9pt間隔）。
検算: 各行の大人・小人の値の数、小人運賃＝対称の位置の大人運賃の半額（10円未満切り上げ）、
線路に沿って運賃が下がらないこと（北松江線どうし・大社線どうし）。
"""

import json
import math
import os
import re
import sys

import pymupdf

KITA = [
    "電鉄出雲市", "出雲科学館パークタウン前", "大津町", "武志", "川跡", "大寺", "美談",
    "旅伏", "雲州平田", "布崎", "湖遊館新駅", "園", "一畑口", "伊野灘", "津ノ森", "高ノ宮",
    "松江フォーゲルパーク", "秋鹿町", "長江", "朝日ヶ丘", "松江イングリッシュガーデン前",
    "松江しんじ湖温泉",
]
TAISHA = ["高浜", "遙堪", "浜山公園北口", "出雲大社前"]  # 川跡から分かれる
STATIONS = KITA + TAISHA
N = len(STATIONS)

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = pymupdf.open(os.path.join(pdf_dir, "ichibata.pdf"))[0]

cells = []  # (y中心, x中心, 値)
for x0, y0, x1, y1, text, *_ in page.get_text("words"):
    m = re.search(r"(\d{3})$", text)
    if not m or y0 < 110:  # 見出し（改定日など）より上は除く
        continue
    if re.fullmatch(r"\d{3}", text):
        cx = (x0 + x1) / 2
    else:
        # 駅名にくっついた値。数字は語の右端にあるので、右端から1列分を数字の位置とみなす
        cx = x1 - 9.5
    cells.append(((y0 + y1) / 2, cx, int(m.group(1))))

# 行: y の近い値をまとめる
cells.sort()
rows: list[list[tuple[float, int]]] = []
last_y = None
for y, x, v in cells:
    if last_y is None or y - last_y > 6:
        rows.append([])
    rows[-1].append((x, v))
    last_y = y
if len(rows) != N:
    raise SystemExit(f"行の数 {len(rows)}（期待 {N}）")

# 列: 1行目（電鉄出雲市）は全25列が大人運賃なので、その x を列の位置にする
first = sorted(x for x, _ in rows[0])
col_x = [first[0] - 28.9] + first  # 列0（電鉄出雲市自身）は値が無いので1列分左に置く
if len(col_x) != N:
    raise SystemExit(f"1行目の値の数 {len(first)}（期待 {N - 1}）")

table: dict[tuple[int, int], int] = {}
for r, row in enumerate(rows):
    for x, v in row:
        c = min(range(N), key=lambda k: abs(col_x[k] - x))
        if abs(col_x[c] - x) > 10 or c == r or (r, c) in table:
            raise SystemExit(f"{STATIONS[r]}: x={x:.1f} の値 {v} の列が決まらない")
        table[(r, c)] = v

for r in range(N):
    adult = [c for c in range(N) if c > r and (r, c) in table]
    child = [c for c in range(N) if c < r and (r, c) in table]
    if len(adult) != N - 1 - r or len(child) != r:
        raise SystemExit(f"{STATIONS[r]}: 大人 {len(adult)}・小人 {len(child)}")

pairs = []
for r in range(N):
    for c in range(r + 1, N):
        fare = table[(r, c)]
        half = math.ceil(fare / 2 / 10) * 10
        if table[(c, r)] != half:
            raise SystemExit(f"{STATIONS[r]}→{STATIONS[c]}: 小人 {table[(c, r)]} が大人 {fare} の半額 {half} と違う")
        pairs.append({"from": STATIONS[r], "to": STATIONS[c], "km": None, "fare": fare})

# 線路に沿って下がらない（同じ路線の中で、発駅から遠い駅ほど高いか同じ）
for line in (KITA, ["川跡"] + TAISHA):
    idx = [STATIONS.index(s) for s in line]
    for a in range(len(idx)):
        for b in range(a + 2, len(idx)):
            i, j, k = idx[a], idx[b - 1], idx[b]
            f1 = table[(min(i, j), max(i, j))]
            f2 = table[(min(i, k), max(i, k))]
            if f2 < f1:
                raise SystemExit(f"{STATIONS[i]}から {STATIONS[k]} が {STATIONS[j]} より安い")

out = os.path.join(pdf_dir, "ichibata-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} ペア -> {out}")
