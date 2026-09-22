# 富山地方鉄道の公式「旅客運賃表」PDFから鉄道線67駅・全2211ペアを抽出する。
# PDFは /Rotate 90 で駅名はフォント内蔵エンコードのため読めないが、数値は座標付きで取れる。
# 表は4ブロック: 本線前半26列(B1) / 本線後半14列(B2) / 立山線13列(B3) / 不二越上滝線13列(B4)。
# 行は本線41 + 立山線13 + 上滝線12。行・列の駅の並びはページ画像を目視で確認した。
import pymupdf, re, json
import sys, os
# PDFの置き場所。第1引数か環境変数 FARE_PDF_DIR で指定する（既定はカレントディレクトリ）。
# 対象のPDFはリポジトリに入れていないので、source.url から取得して置くこと。
D = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FARE_PDF_DIR", ".")
p=pymupdf.open(D+"/ct_57f926382b6e9c826ae79da324e7afe6.pdf")[0]
m=p.rotation_matrix
cells=[]
for a,b,c,d,t,*_ in p.get_text("words"):
    if not re.fullmatch(r"[\d,]{3,5}", t): continue
    r=pymupdf.Rect(a,b,c,d)*m
    cells.append(((r.y0+r.y1)/2,(r.x0+r.x1)/2,int(t.replace(",",""))))
Y0,DY=113.6,9.71
def rowcells(i):
    y=Y0+DY*i
    return sorted((x,v) for cy,x,v in cells if abs(cy-y)<4.5)

MAIN=["電鉄富山","稲荷町","新庄田中","東新庄","越中荏原","越中三郷","越中舟橋","寺田","越中泉",
 "相ノ木","新相ノ木","上市","新宮川","中加積","西加積","西滑川","中滑川","滑川","浜加積","早月加積",
 "越中中村","西魚津","電鉄魚津","新魚津","経田","電鉄石田","電鉄黒部","東三日市","荻生","長屋",
 "新黒部","舌山","若栗","栃屋","浦山","下立口","下立","愛本","内山","音沢","宇奈月温泉"]
TATE=["稚子塚","田添","五百石","榎町","下段","釜ヶ淵","沢中山","岩峅寺","横江","千垣","有峰口","本宮","立山"]
KAMI=["栄町","不二越","大泉","南富山","朝菜町","上堀","小杉","布市","開発","月岡","大庄","上滝","大川寺"]
assert (len(MAIN),len(TATE),len(KAMI))==(41,13,13)

# 列グリッドは電鉄富山行(i=0)の実測。B1+B2=本線40列、B3=立山線13列、B4=上滝線13列
r0=rowcells(0)
gMain=[x for x,_ in r0 if x<=710]
gTate=[x for x,_ in r0 if 720<=x<=920]
gKami=[x for x,_ in r0 if 935<=x<=1140]
assert (len(gMain),len(gTate),len(gKami))==(40,13,13), (len(gMain),len(gTate),len(gKami))

def assign(row, grid, lo, hi):
    """行のセルを列グリッドに最近傍で割り当てる"""
    out={}
    for x,v in row:
        if not (lo<=x<=hi): continue
        j=min(range(len(grid)), key=lambda k: abs(grid[k]-x))
        if abs(grid[j]-x)>6 or j in out: continue
        out[j]=v
    return out

pairs=[]
def add(a,b,v):
    if a!=b: pairs.append({"from":a,"to":b,"fare":v})

# 本線41行。理論行 i=27 は空で、東三日市以降が1つ後ろにずれている
for i in range(42):
    si = i if i<=26 else i-1
    if i==27 or si>=len(MAIN): continue
    row=rowcells(i)
    for j,v in assign(row,gMain,0,710).items():
        if j+1>si: add(MAIN[si],MAIN[j+1],v)
    for j,v in assign(row,gTate,720,920).items():
        add(MAIN[si],TATE[j],v)
    for j,v in assign(row,gKami,935,1140).items():
        add(MAIN[si],KAMI[j],v)

# 立山線13行 (i=43..55)。i=43 が稚子塚
for i in range(43,56):
    ti=i-43
    row=rowcells(i)
    for j,v in assign(row,gTate,720,920).items():
        if j>ti: add(TATE[ti],TATE[j],v)
    for j,v in assign(row,gKami,935,1140).items():
        add(TATE[ti],KAMI[j],v)

# 不二越上滝線12行 (i=57..68)。i=57 が栄町
for i in range(57,69):
    ki=i-57
    row=rowcells(i)
    for j,v in assign(row,gKami,935,1140).items():
        if j>ki: add(KAMI[ki],KAMI[j],v)

seen={}
dup=0
for p in pairs:
    k=tuple(sorted([p["from"],p["to"]]))
    if k in seen:
        dup+=1
        if seen[k]!=p["fare"]: print("値が食い違う重複",k,seen[k],p["fare"])
    seen[k]=p["fare"]
print("抽出",len(pairs),"重複",dup,"ユニーク",len(seen))
print("期待", 67*66//2)

# 列ヘッダと重なってテキスト層から拾えなかったセル。運賃表の画像を直接読んで補う。
manual = [
    # 東三日市列（本線後半の先頭列。列ヘッダと重なる）
    ("稲荷町","東三日市",1120), ("東新庄","東三日市",1120), ("越中泉","東三日市",1120),
    ("相ノ木","東三日市",1120), ("新相ノ木","東三日市",1120), ("新宮川","東三日市",1080),
    # 稚子塚列（立山線の先頭列）
    ("新魚津","稚子塚",1080), ("新黒部","稚子塚",1420), ("下立口","稚子塚",1620),
    # 栄町列（不二越上滝線の先頭列）
    ("浜加積","栄町",1000), ("西魚津","栄町",1080), ("新魚津","栄町",1120),
    ("新黒部","栄町",1560), ("下立口","栄町",1820), ("有峰口","栄町",1080),
]
for a,b,v in manual:
    key=tuple(sorted([a,b]))
    assert key not in seen, key
    seen[key]=v
print("補完後", len(seen), "期待", 67*66//2)
json.dump([{"from":k[0],"to":k[1],"fare":v} for k,v in seen.items()],
          open(D+"/ct2_pairs.json","w",encoding="utf-8"), ensure_ascii=False)
