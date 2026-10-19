# JR西日本「京阪神都市圏における運賃体系の見直しについて」(2024-05-15) の
# 別紙4「大阪附近の特定区間における普通旅客運賃…の特定」から、特定区間の普通運賃を取り出す。
#
#   python scripts/fare/extract/jr-west-special.py <PDFを置いたディレクトリ>
#
# 必要なPDF: jrw.pdf（https://www.westjr.co.jp/press/article/items/240515_00_press_keihanshin_unchin.pdf）
# 出力: 同じディレクトリの jr-west-special.json（[{from, to, fare}]、駅名はPDFの表記のまま）
#
# 表は15〜23ページ。区間名は縦書きで1文字ずつ改行され（「大/阪/・/京/都」）、長い駅名だけ
# 1行にまとまる（「摂津富田」）。区間名のあとに 普通運賃・通勤定期3種・通学定期3種 の
# 7つの数値が続くので、数値が7つ揃うたびに1区間として切る。使うのは先頭の普通運賃だけ。
#
# 区切りの「・」がテキスト層に無い行が1つある（「ＪＲ総持寺神戸」）。他の行に出てくる
# 駅名で2つに割れる位置を探して救う。割れなければ捨てて件数を表示する。
import pymupdf, re, json, sys, os

D = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
doc = pymupdf.open(os.path.join(D, "jrw.pdf"))

NUM = re.compile(r"^[0-9,]+$")
HEAD = {"区", "間", "区  間", "普通", "運賃", "通勤定期運賃", "通学定期運賃（大学生）",
        "１箇月", "３箇月", "６箇月", "（単位：円）"}

rows = []        # (区間文字列, 普通運賃)
for page in range(14, 23):
    name, nums = [], []
    for line in (l.strip() for l in doc[page].get_text().split("\n")):
        if line == "" or line.startswith("【別紙") or line in HEAD:
            continue
        if NUM.match(line):
            nums.append(int(line.replace(",", "")))
            if len(nums) == 7:
                rows.append(("".join(name), nums[0]))
                name, nums = [], []
        else:
            # 数値の途中に文字が来たら、その行の読みが崩れている
            assert not nums, (page + 1, line)
            name.append(line)

# 「・」で割れる行から駅名の集合を作り、割れない行はそれで割る
known = set()
for sec, _ in rows:
    if sec.count("・") == 1:
        known.update(sec.split("・"))

pairs, dropped = [], []
for sec, fare in rows:
    if sec.count("・") == 1:
        a, b = sec.split("・")
    else:
        cut = [i for i in range(1, len(sec)) if sec[:i] in known and sec[i:] in known]
        if len(cut) != 1:
            dropped.append(sec)
            continue
        a, b = sec[:cut[0]], sec[cut[0]:]
    pairs.append({"from": a, "to": b, "fare": fare})

out = os.path.join(D, "jr-west-special.json")
json.dump(pairs, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{len(pairs)}区間を書き出した: {out}")
if dropped:
    print(f"区切れず捨てた {len(dropped)}: {dropped}")
