"""天竜浜名湖鉄道の普通旅客運賃表（三角表）から全ペアの大人運賃を取り出す。

PDF: https://www.tenhama.co.jp/about/timetable-2/ の「全体の運賃表(普通&定期運賃)」
     （wp-content/uploads/078e045baf8688aca2ed7b1d2e5893ce.pdf、2024年10月1日運賃改定。
     ファイル名 tenhama.pdf で置く）

表の形: 行頭に駅番号 k（1=掛川 〜 39=新所原）があり、その駅より掛川寄りの駅への運賃が
遠い順（駅1が左端）に k-1 個並ぶ。テキスト層では「220 220」のように2つの数字が1語に
くっついていることがあるので、空白で切り分けてから数える。
検算: 行の値の数、線路に沿って運賃が下がらないこと（遠い駅ほど高いか同じ）。
"""

import json
import os
import re
import sys

import pymupdf

STATIONS = [
    "掛川", "掛川市役所前", "西掛川", "桜木", "いこいの広場", "細谷", "原谷", "原田", "戸綿",
    "遠州森", "森町病院前", "円田", "遠江一宮", "敷地", "豊岡", "上野部", "天竜二俣",
    "二俣本町", "西鹿島", "岩水寺", "宮口", "フルーツパーク", "都田", "常葉大学前", "金指",
    "岡地", "気賀", "西気賀", "寸座", "浜名湖佐久米", "東都筑", "都筑", "三ヶ日", "奥浜名湖",
    "尾奈", "知波田", "大森", "アスモ前", "新所原",
]

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
page = pymupdf.open(os.path.join(pdf_dir, "tenhama.pdf"))[0]
rows: dict[int, list] = {}
for w in page.get_text("words"):
    y = round((w[1] + w[3]) / 2 / 3) * 3
    rows.setdefault(y, []).append(w)

by_index: dict[int, list[int]] = {}
for y in sorted(rows):
    words = sorted(rows[y], key=lambda w: w[0])
    # 三角表の値は約31pt間隔で連続して並ぶ。上のほうの行では、同じ高さの右側に定期運賃の
    # 表があるので、大きな隙間（80pt超）が空いたところで打ち切る
    tokens = []
    last_x = None
    for w in words:
        if not re.fullmatch(r"[\d, ]+", w[4]):
            continue
        if last_x is not None and w[0] - last_x > 80:
            break
        tokens += w[4].split()
        last_x = w[2]
    # 同じページに定期運賃の表もある。行頭が駅番号（カンマなしの小さい数）の行だけを読む
    if not tokens or not re.fullmatch(r"\d{1,2}", tokens[0]):
        continue
    k = int(tokens[0])
    values = [int(t.replace(",", "")) for t in tokens[1:]]
    if 1 <= k <= len(STATIONS) and len(values) == k - 1 and k not in by_index:
        by_index[k] = values

missing = [k for k in range(2, len(STATIONS) + 1) if k not in by_index]
if missing:
    raise SystemExit(f"行が見つからない駅番号: {missing}")

pairs = []
for k in range(2, len(STATIONS) + 1):
    values = by_index[k]  # 駅1（最も遠い）から駅 k-1 まで
    if any(b > a for a, b in zip(values, values[1:])):
        raise SystemExit(f"{STATIONS[k - 1]}: 近い駅のほうが高い {values}")
    for j, fare in enumerate(values):
        pairs.append({"from": STATIONS[j], "to": STATIONS[k - 1], "km": None, "fare": fare})

out = os.path.join(pdf_dir, "tenhama-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} ペア -> {out}")
