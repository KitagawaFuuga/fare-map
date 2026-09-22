# えちごトキめき鉄道の公式「普通旅客運賃表」PDF（2025年10月1日改定）の1ページ目から
# 自社線内22駅の三角表を取り出す。大人と小児の行が交互に並ぶので、大人の行だけを使う。
# 駅名は文字化けするが、行・列の並びは営業キロ順なので Wikipedia の駅一覧と対応づけられる。
import pymupdf, re, json
import sys, os
# PDFの置き場所。第1引数か環境変数 FARE_PDF_DIR で指定する（既定はカレントディレクトリ）。
# 対象のPDFはリポジトリに入れていないので、source.url から取得して置くこと。
D = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
p=pymupdf.open(D+"/tok.pdf")[0]
cs=[((b+d)/2,(a+c)/2,t) for a,b,c,d,t,*_ in p.get_text("words") if re.fullmatch(r"[\d,]{3,5}", t)]
rows={}
for y,x,t in cs: rows.setdefault(round(y,0),[]).append((x,t))
ys=sorted(rows)
# 個数が 1,1,2,2,3,3,… と2行ずつ増える。奇数番目（大人）だけ取る
adult=[y for k,y in enumerate(ys) if k%2==0]
assert len(adult)==21, len(adult)
for i,y in enumerate(adult, start=1):
    assert len(rows[y])==i, (i, len(rows[y]))

# 妙高高原起点の営業キロ（Wikipedia「妙高はねうまライン」「日本海ひすいライン」の駅一覧。
# ひすいラインは直江津からの値に 37.7 を足したもの）
ST=[("妙高高原",0.0),("関山",6.4),("二本木",14.7),("新井",21.0),("北新井",23.9),
    ("上越妙高",27.3),("南高田",29.0),("高田",31.0),("春日山",34.5),("直江津",37.7),
    ("谷浜",44.3),("有間川",47.7),("名立",51.9),("筒石",56.1),("能生",63.6),
    ("浦本",68.7),("梶屋敷",72.2),("えちご押上ひすい海岸",74.9),("糸魚川",77.0),
    ("青海",83.6),("親不知",88.9),("市振",97.0)]
assert len(ST)==22

pairs=[]
for i,y in enumerate(adult, start=1):      # 行i = 駅(i+1)
    for j,(x,t) in enumerate(sorted(rows[y])):   # 列j = 駅(j+1)
        a,b = ST[i], ST[j]
        pairs.append({"from":a[0],"to":b[0],"km":round(a[1]-b[1],1),
                      "fare":int(t.replace(",",""))})
print("ペア", len(pairs), "期待", 22*21//2)
json.dump(pairs, open(D+"/tok_pairs.json","w",encoding="utf-8"), ensure_ascii=False)
