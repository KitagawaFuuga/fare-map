# しなの鉄道の公式運賃表PDFの6ページ目から、北しなの線（妙高高原〜長野）を列にした表を
# 取り出す。行は北しなの線の各駅・篠ノ井〜長野のJR信越本線区間・しなの鉄道線の各駅。
# 北しなの線はしなの鉄道線と賃率が違う（例: 長野→牟礼 19.1kmは430円で、しなの鉄道線の
# 距離表なら460円）ため、この表のペアはすべて override に入れる必要がある。
import pymupdf, re, json
import sys, os
# PDFの置き場所。第1引数か環境変数 FARE_PDF_DIR で指定する（既定はカレントディレクトリ）。
# 対象のPDFはリポジトリに入れていないので、source.url から取得して置くこと。
D = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
p=pymupdf.open(D+"/sr.pdf")[5]
cs=[]
for a,b,c,d,t,*_ in p.get_text("words"):
    m=re.search(r"([\d,]{3,5})$", t)
    if m: cs.append(((b+d)/2, c, m.group(1)))

COL=["妙高高原","黒姫","古間","牟礼","豊野","三才","北長野","長野"]
ROW=["黒姫","古間","牟礼","豊野","三才","北長野","長野","安茂里","川中島","今井","篠ノ井",
     "屋代高校前","屋代","千曲","戸倉","坂城","テクノさかき","西上田","上田","信濃国分寺",
     "大屋","田中","滋野","小諸","平原","御代田","信濃追分","中軽井沢","軽井沢"]
ROWY=[103,114,125,136,147,158,169,180,190.5,201.5,212,223,234,245,256,267,278,289,299,310,
      321,332,343,354,365,376,387,398,408]
XS=[196.0,231.7,267.4,303.1,338.8,374.5,410.2,443.0]
assert len(ROW)==len(ROWY)

pairs=[]; miss=0
for i,(name,y) in enumerate(zip(ROW,ROWY)):
    ncol = i+1 if i < 7 else 8      # 最初の7行は三角表
    row=sorted((x,t) for cy,x,t in cs if abs(cy-y)<3)
    used={}
    for x,t in row:
        j=min(range(ncol), key=lambda k: abs(XS[k]-x))
        if abs(XS[j]-x) > 18 or j in used: continue
        used[j]=t
    miss += ncol-len(used)
    for j,t in used.items():
        pairs.append({"from":name,"to":COL[j],"fare":int(t.replace(",",""))})
print("ペア", len(pairs), "欠損", miss)
json.dump(pairs, open(D+"/sr_kita.json","w",encoding="utf-8"), ensure_ascii=False)
