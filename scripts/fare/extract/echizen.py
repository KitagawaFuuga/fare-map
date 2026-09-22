# えちぜん鉄道の公式PDF（旅客運賃表・営業キロ表）から駅ペアの運賃と営業キロを取り出す。
# どちらも同じ様式の三角表だが、キロ表は45駅・運賃表は44駅で1駅ぶんずれている
# （キロ表にだけ中角〜鷲塚針原の間に駅があり、運賃表にも graph.json にも無い）。
# 駅名はフォント内蔵エンコードで化けて読めないので、行・列の並びとWikipediaの営業キロを
# 突き合わせて駅を特定した。列の間隔は罫線の都合で一定でないため、三角表の最終行
# （全列が埋まる行）から列位置を実測してグリッドにする。
import pymupdf, re, json
import sys, os
# PDFの置き場所。第1引数か環境変数 FARE_PDF_DIR で指定する（既定はカレントディレクトリ）。
# 対象のPDFはリポジトリに入れていないので、source.url から取得して置くこと。
D = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
GHOST=32   # キロ表にだけある駅のindex（1始まり）

def load(fname, valre):
    p=pymupdf.open(f"{D}/{fname}.pdf")[0]; m=p.rotation_matrix
    out=[]
    for a,b,c,d,t,*_ in p.get_text("words"):
        if not re.fullmatch(valre, t): continue
        r=pymupdf.Rect(a,b,c,d)*m
        out.append(((r.y0+r.y1)/2,(r.x0+r.x1)/2,t))
    return out

def table(cs, ns, ylast, ytop, ybot):
    """最終行(ylast付近)から列位置を実測し、行は等間隔で割り当てる。"""
    xs=sorted({round(x,1) for y,x,t in cs if abs(y-ylast)<7}, reverse=True)
    assert len(xs)==ns-1, (len(xs), ns-1)
    dy=(ybot-ytop)/(ns-2)
    out={}
    for i in range(1, ns):
        y=ytop+dy*(i-1)
        for j in range(i):
            hit=[(abs(cy-y)/dy, t) for cy,cx,t in cs
                 if abs(cy-y)<dy*0.9 and abs(cx-xs[j])<6]
            if hit: out[(i,j)]=min(hit)[1]
    return out

fare = table(load("ez_fare", r"[\d,]{3,5}"), 44, 896.0, 311.0, 896.0)
kilo = table(load("ez_kilo", r"\d+\.\d"),    45, 754.0, 134.0, 754.0)
print("運賃セル", len(fare), "/", 44*43//2, " キロセル", len(kilo), "/", 45*44//2)

def k2f(k):
    if k == GHOST: return None
    return k if k < GHOST else k-1

pairs=[]
for (i,j),kv in kilo.items():
    a,b = i+1, j+1
    fa,fb = k2f(a), k2f(b)
    if fa is None or fb is None: continue
    fv = fare.get((fa-1, fb-1))
    if fv is None: continue
    pairs.append({"fi":fa,"fj":fb,"km":float(kv),"fare":int(fv.replace(",",""))})
print("キロと運賃が揃ったペア", len(pairs), "/", 44*43//2)
json.dump({"fare":{f"{i},{j}":v for (i,j),v in fare.items()}, "pairs":pairs},
          open(D+"/ez_pairs.json","w",encoding="utf-8"), ensure_ascii=False)
