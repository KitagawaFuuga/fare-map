"""福井鉄道（福武線）の普通旅客運賃表（三角表）から全ペアの大人運賃を取り出す。

PDF: https://fukutetsu.jp/train/faretable.php の「普通旅客運賃表」
     （train/pdf/unchin_futuu.pdf、2024年3月16日改定。ファイル名 fukutetsu.pdf で置く）

表の形: 駅の番号 k、その駅から番号の若い k 駅（たけふ新側）への運賃（遠い順）、駅名、の
繰り返し。駅名と次の駅の番号がくっつく（「鳥羽中10」）ので、数字と文字に分けて読む。
鉄道線（たけふ新〜赤十字前）と軌道線（商工会議所前〜田原町・福井駅）は運賃の決め方が違う
が、この表は全区間の駅ペアを1つにまとめているので、そのまま駅ペアの運賃として持てる。
検算: 各駅の値の数が番号に一致すること、各行が近い駅ほど安いか同じこと（福井駅と
仁愛女子高校・田原町は福井城址大名町からの分岐なので、行の末尾の分岐先どうしは除く）、
たけふ新からの運賃が遠い駅ほど高いか同じこと。
"""

import json
import os
import re
import sys

import pymupdf

STATIONS = [
    "たけふ新", "北府", "スポーツ公園", "家久", "サンドーム西", "西鯖江", "西山公園", "水落",
    "神明", "鳥羽中", "三十八社", "泰澄の里", "浅水", "ハーモニーホール", "清明", "江端",
    "ベル前", "花堂", "赤十字前", "商工会議所前", "足羽山公園口", "福井城址大名町", "福井駅",
    "仁愛女子高校", "田原町",
]
BRANCH = {"福井駅", "仁愛女子高校", "田原町"}  # 福井城址大名町から分かれる

pdf_dir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
text = pymupdf.open(os.path.join(pdf_dir, "fukutetsu.pdf"))[0].get_text()
# 見出し・注記より前（表の本体）だけを読む
text = text.split("こども運賃")[0]
tokens = re.findall(r"\d+|[^\d\s]+", text)

rows: list[list[int]] = []
i = 0
for k in range(len(STATIONS)):
    while i < len(tokens) and tokens[i] != str(k):
        i += 1
    if i == len(tokens):
        raise SystemExit(f"駅番号 {k} が見つからない")
    i += 1
    values = []
    while len(values) < k:
        t = tokens[i]
        if not t.isdigit():
            raise SystemExit(f"{STATIONS[k]}: 値が {len(values)} 個しかない（期待 {k}）")
        values.append(int(t))
        i += 1
    rows.append(values)

pairs = []
for k, values in enumerate(rows):
    for j, fare in enumerate(values):
        pairs.append({"from": STATIONS[j], "to": STATIONS[k], "km": None, "fare": fare})
    on_line = [v for j, v in enumerate(values) if not (STATIONS[j] in BRANCH and STATIONS[k] in BRANCH)]
    if any(b > a for a, b in zip(on_line, on_line[1:])):
        raise SystemExit(f"{STATIONS[k]}: 近い駅のほうが高い {values}")
col = [rows[k][0] for k in range(1, len(STATIONS))]
if any(b < a for a, b in zip(col, col[1:])):
    raise SystemExit(f"たけふ新から遠い駅ほど安い {col}")

out = os.path.join(pdf_dir, "fukutetsu-pairs.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump(pairs, f, ensure_ascii=False, indent=1)
print(f"{len(pairs)} ペア -> {out}")
