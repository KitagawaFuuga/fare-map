# しなの鉄道の公式「旅客運賃表」PDF（2026年3月14日改定）の2ページ目上部から、
# しなの鉄道線の三角表（長野〜軽井沢 23駅）を取り出す。1ページに小海線連絡運賃の
# 表も同居しているので、行・列のグリッド位置で上部の表だけを拾う。
# 駅名は文字化けするが、ページを画像にして目視で並びを確認した。
import pymupdf, re, json
import sys, os
# PDFの置き場所。第1引数か環境変数 FARE_PDF_DIR で指定する（既定はカレントディレクトリ）。
# 対象のPDFはリポジトリに入れていないので、source.url から取得して置くこと。
D = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
p=pymupdf.open(D+"/sr.pdf")[1]
# 左端のセルは縦書きの線名ラベルと結合して "???1680" のような単語になるので、
# 末尾の数値を取り出す。セルの位置は右端で揃っているので x は単語の右端を使う。
cs=[]
for a,b,c,d,t,*_ in p.get_text("words"):
    m=re.search(r"([\d,]{3,5})$", t)
    if m: cs.append(((b+d)/2, c, m.group(1)))

# 行: y=100 から約16.8刻みで22行（行i = 駅i、駅0=長野には行が無い）
ys=sorted({round(y,0) for y,_,_ in cs})
rowys=[y for y in ys if 95 <= y <= 460]
assert len(rowys)==22, (len(rowys), rowys)
# 列: 最終行（軽井沢、22個）の実測位置。列jは駅j
last=sorted(x for y,x,t in cs if abs(y-rowys[-1])<3)
assert len(last)==22, len(last)
dx=(last[-1]-last[0])/21
xs=last

# 長野を0とした営業キロ。篠ノ井〜軽井沢はしなの鉄道線（Wikipedia 駅一覧、軽井沢起点
# 65.1km を長野起点に読み替え）、長野〜篠ノ井はJR信越本線 9.3km。
ST=[("長野",0.0),("安茂里",2.5),("川中島",5.0),("今井",7.0),("篠ノ井",9.3),
    ("屋代高校前",12.6),("屋代",14.5),("千曲",17.3),("戸倉",19.5),("坂城",24.0),
    ("テクノさかき",26.5),("西上田",30.0),("上田",34.4),("信濃国分寺",37.3),
    ("大屋",39.7),("田中",43.1),("滋野",46.5),("小諸",52.4),("平原",56.1),
    ("御代田",61.2),("信濃追分",67.2),("中軽井沢",70.4),("軽井沢",74.4)]
assert len(ST)==23

pairs=[]; miss=0
for i,y in enumerate(rowys, start=1):         # 行i = 駅i
    row=sorted((x,t) for cy,x,t in cs if abs(cy-y)<3)
    used={}
    for x,t in row:
        j=min(range(i), key=lambda k: abs(xs[k]-x))
        if abs(xs[j]-x) > dx*0.5 or j in used: continue
        used[j]=t
    miss += i-len(used)
    for j,t in used.items():
        pairs.append({"from":ST[i][0],"to":ST[j][0],
                      "km":round(ST[i][1]-ST[j][1],1),"fare":int(t.replace(",",""))})
print("ペア", len(pairs), "期待", 23*22//2, "欠損", miss)
json.dump(pairs, open(D+"/sr_pairs.json","w",encoding="utf-8"), ensure_ascii=False)
