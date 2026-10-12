"""松浦鉄道の駅間普通旅客運賃表（3ページ）から全ペアの大人運賃を取り出す。

PDF: https://matutetu.com/pages/787/ の「普通旅客運賃表【令和6年10月1日改定】」
     （files/libs/4890/202408251723586779.pdf。ファイル名 matsuura.pdf で置く）

表の形（57駅を3つの表に分けている）:
  1ページ目  有田〜たびら平戸口の30駅どうしの三角表。駅 k の行に駅 0..k-1 への運賃
  2ページ目  西田平〜佐世保の27駅（行）× 有田〜たびら平戸口の30駅（列）の長方形
  3ページ目  西田平〜佐世保の27駅どうしの三角表
どの表も行の左端が有田側（遠い駅）。
テキスト層では駅名と数字がくっついた語（「鷹島口1,060」）や特定区間の印付きの数字
（「★1,460」）があり、数字の高さが駅名と少しずれる行もある。語の中の数字をすべて拾い、
高さの近い語を1行にまとめる。
検算: 行ごとの値の数、線路に沿って運賃が下がらないこと（左＝遠い駅ほど高いか同じ）。
"""

import json
import os
import re
import sys

import pymupdf

WEST = [
    "有田", "三代橋", "黒川", "蔵宿", "西有田", "大木", "山谷", "夫婦石", "金武", "川東",
    "伊万里", "東山代", "里", "楠久", "鳴石", "久原", "波瀬", "浦ノ崎", "福島口", "今福",
    "鷹島口", "前浜", "調川", "松浦", "松浦発電所前", "御厨", "西木場", "東田平", "中田平",
    "たびら平戸口",
]
EAST = [
    "西田平", "すえたちばな", "江迎鹿町", "高岩", "いのつき", "潜竜ヶ滝", "吉井", "神田",
    "清峰高校前", "佐々", "小浦", "真申", "棚方", "相浦", "大学", "上相浦", "本山", "中里",
    "皆瀬", "野中", "左石", "泉福寺", "山の田", "北佐世保", "中佐世保", "佐世保中央", "佐世保",
]
NUM = re.compile(r"\d{1,3}(?:,\d{3})+|\d{3,4}")


def value_rows(page) -> list[list[int]]:
    """数字を含む語を高さで行にまとめ、行ごとに左から並べた運賃を返す"""
    items = []
    for w in page.get_text("words"):
        for m in NUM.finditer(w[4]):
            # 年月日（令和6年10月1日）の数字は拾わない
            if "年" in w[4] or "月" in w[4]:
                continue
            items.append(((w[1] + w[3]) / 2, w[0], int(m.group().replace(",", ""))))
    items.sort()
    rows: list[list[tuple[float, int]]] = []
    last_y = None
    for y, x, v in items:
        if last_y is None or y - last_y > 8:
            rows.append([])
        rows[-1].append((x, v))
        last_y = y
    return [[v for _, v in sorted(r)] for r in rows]


def check_row(name: str, values: list[int]) -> None:
    if any(b > a for a, b in zip(values, values[1:])):
        raise SystemExit(f"{name}: 近い駅のほうが高い {values}")


pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
doc = pymupdf.open(os.path.join(pdf_dir, "matsuura.pdf"))
pairs = []

# 1ページ目: 西側30駅の三角表
rows = value_rows(doc[0])
if [len(r) for r in rows] != list(range(1, len(WEST))):
    raise SystemExit(f"1ページ目の行の長さが想定と違う: {[len(r) for r in rows]}")
for k, values in enumerate(rows, start=1):
    check_row(WEST[k], values)
    pairs += [{"from": WEST[j], "to": WEST[k], "km": None, "fare": v} for j, v in enumerate(values)]

# 2ページ目: 東側27駅 × 西側30駅
rows = value_rows(doc[1])
if [len(r) for r in rows] != [len(WEST)] * len(EAST):
    raise SystemExit(f"2ページ目の行の長さが想定と違う: {[len(r) for r in rows]}")
for i, values in enumerate(rows):
    check_row(EAST[i], values)
    pairs += [{"from": WEST[j], "to": EAST[i], "km": None, "fare": v} for j, v in enumerate(values)]

# 3ページ目: 東側27駅の三角表
rows = value_rows(doc[2])
if [len(r) for r in rows] != list(range(1, len(EAST))):
    raise SystemExit(f"3ページ目の行の長さが想定と違う: {[len(r) for r in rows]}")
for k, values in enumerate(rows, start=1):
    check_row(EAST[k], values)
    pairs += [{"from": EAST[j], "to": EAST[k], "km": None, "fare": v} for j, v in enumerate(values)]

# 東西をまたぐ組も、西側の駅から見て東へ行くほど高いか同じ（列方向の単調性）
fare = {(p["from"], p["to"]): p["fare"] for p in pairs}
for w in WEST:
    col = [fare[(w, e)] for e in EAST]
    if any(b < a for a, b in zip(col, col[1:])):
        raise SystemExit(f"{w} から東へ運賃が下がる: {col}")

out = os.path.join(pdf_dir, "matsuura-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} ペア -> {out}")
