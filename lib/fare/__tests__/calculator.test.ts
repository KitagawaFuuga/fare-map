import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import { fareOverrideSchema, fareRuleSchema } from "@/lib/fare/types";
import jrEast from "@/data/fare-rules/jr-east.json";
import jrCentral from "@/data/fare-rules/jr-central.json";
import jrWest from "@/data/fare-rules/jr-west.json";
import jrHonshuKasan from "@/data/fare-rules/jr-honshu-kasan.json";
import jrKyushu from "@/data/fare-rules/jr-kyushu.json";
import jrHokkaido from "@/data/fare-rules/jr-hokkaido.json";
import jrShikoku from "@/data/fare-rules/jr-shikoku.json";
import kintetsu from "@/data/fare-rules/kintetsu.json";
import meitetsu from "@/data/fare-rules/meitetsu.json";
import tobu from "@/data/fare-rules/tobu.json";
import generic from "@/data/fare-rules/generic-private.json";
import tokyoMetro from "@/data/fare-rules/tokyo-metro.json";
import toei from "@/data/fare-rules/toei.json";
import osakaMetro from "@/data/fare-rules/osaka-metro.json";
import nagoyaCity from "@/data/fare-rules/nagoya-city.json";
import nankai from "@/data/fare-rules/nankai.json";
import seibu from "@/data/fare-rules/seibu.json";
import hankyu from "@/data/fare-rules/hankyu.json";
import hiroshimaDentetsu from "@/data/fare-rules/hiroshima-dentetsu.json";
import keio from "@/data/fare-rules/keio.json";
import keikyu from "@/data/fare-rules/keikyu.json";
import keisei from "@/data/fare-rules/keisei.json";
import keihan from "@/data/fare-rules/keihan.json";
import tokyu from "@/data/fare-rules/tokyu.json";
import odakyu from "@/data/fare-rules/odakyu.json";
import hanshin from "@/data/fare-rules/hanshin.json";
import saitamaKosoku from "@/data/fare-rules/saitama-kosoku.json";
import nishitetsu from "@/data/fare-rules/nishitetsu.json";
import toyoKosoku from "@/data/fare-rules/toyo-kosoku.json";
import sotetsu from "@/data/fare-rules/sotetsu.json";
import hankai from "@/data/fare-rules/hankai.json";
import keifuku from "@/data/fare-rules/keifuku.json";
import nagasakiDentetsu from "@/data/fare-rules/nagasaki-dentetsu.json";
import kumamotoCity from "@/data/fare-rules/kumamoto-city.json";
import kagoshimaCity from "@/data/fare-rules/kagoshima-city.json";
import jrWestOverride from "@/data/fare-overrides/jr-west.json";
import jrEastOverride from "@/data/fare-overrides/jr-east.json";
import keikyuOverride from "@/data/fare-overrides/keikyu.json";
import tokyuOverride from "@/data/fare-overrides/tokyu.json";
import keihanOverride from "@/data/fare-overrides/keihan.json";

const rules = [
  jrEast,
  jrCentral,
  jrWest,
  jrHonshuKasan,
  jrKyushu,
  jrHokkaido,
  jrShikoku,
  kintetsu,
  meitetsu,
  tobu,
  generic,
  tokyoMetro,
  toei,
  osakaMetro,
  nagoyaCity,
  nankai,
  seibu,
  hankyu,
  hiroshimaDentetsu,
  keio,
  keikyu,
  keisei,
  keihan,
  tokyu,
  odakyu,
  hanshin,
  saitamaKosoku,
  nishitetsu,
  toyoKosoku,
  sotetsu,
  hankai,
  keifuku,
  nagasakiDentetsu,
  kumamotoCity,
  kagoshimaCity,
].map((r) => fareRuleSchema.parse(r));
const overrides = [
  jrWestOverride,
  jrEastOverride,
  keikyuOverride,
  tokyuOverride,
  keihanOverride,
].map((o) => fareOverrideSchema.parse(o));
const calc = createFareCalculator(rules, overrides);

// 本番(lib/server/graph-store.ts)は data/fare-rules/ をディレクトリごと読むが、この
// テストは import を1本ずつ並べている。運賃表を追加して import を足し忘れると、
// 本番だけ新しい表を使いテストは汎用フォールバックを引く、という食い違いが起きる。
// しかもテストは「落ちない」ので気づけない。ファイル一覧と突き合わせて検出する。
describe("運賃表の読み込み漏れ検出", () => {
  it("data/fare-rules/ の全ファイルがこのテストの rules に含まれている", () => {
    const onDisk = readdirSync("data/fare-rules")
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    const loaded = rules.map((r) => r.id).sort();
    expect(loaded).toEqual(onDisk);
  });
});

// 実区間照合テストは、加算運賃・特定運賃のかからない一般区間を選び実運賃と toBe で完全一致検証する
// （brief参照）。一致しない区間は「表で表現できない特殊運賃が乗っている」ことを意味するため、
// 一般区間に差し替える方針とし、許容誤差での妥協は行わない。

describe("FareCalculator", () => {
  it("km=0 は 0 円", () => {
    expect(calc.estimate("JR東日本", 0)).toBe(0);
  });

  it("表を超える距離は賃率で外挿し 10 円単位に丸める", () => {
    const fare = calc.estimate("JR東日本", 150);
    expect(fare).toBe(Math.ceil((1790 + 50 * 16.96) / 10) * 10);
  });

  it("未知の事業者はフォールバック表を使う", () => {
    expect(calc.estimate("謎電鉄", 5)).toBe(200);
  });

  describe("JR東日本（2026年3月14日改定後・幹線に統合）", () => {
    // 出典: https://jr-group.jp/higashinihon-fare/ (2026-08-24取得)
    // 実運賃はJR東日本公式改定告知・報道(travel.watch.impress.co.jp等)のきっぷ運賃で照合。
    // いずれも加算運賃・特定運賃のない幹線区間のため表と完全一致するはず
    it("新宿→東京 10.3km、実運賃260円（きっぷ。改定前210円）", () => {
      expect(calc.estimate("JR東日本", 10.3)).toBe(260);
    });

    it("東京→横浜 28.8km、実運賃530円（きっぷ。改定前490円）", () => {
      expect(calc.estimate("JR東日本", 28.8)).toBe(530);
    });

    it("東京→大宮 30.3km、実運賃620円（きっぷ。改定前580円）", () => {
      expect(calc.estimate("JR東日本", 30.3)).toBe(620);
    });
  });

  describe("JR東海（改定なし・据え置き）", () => {
    // 出典: https://jr-group.jp/tokai-fare/ (2026-08-24取得)。改定前と同一表であることを確認済み
    // 実運賃はekitan.com等の運賃検索で照合。特定運賃のない東海道本線区間のため表と完全一致するはず
    it("豊橋→浜松 36.5km、実運賃680円", () => {
      // 営業キロは豊橋(東京起点293.6km)・浜松(同257.1km)の差分で再検証した値。
      // 旧コメントの39.7kmは誤り（36-40km帯のため運賃自体への影響はない）
      expect(calc.estimate("JR東海", 36.5)).toBe(680);
    });

    it("浜松→静岡 76.9km、実運賃1,340円", () => {
      expect(calc.estimate("JR東海", 76.9)).toBe(1340);
    });

    it("東京～熱海間相当のような幹線100km超級: 表の外挿値が妥当な範囲であること", () => {
      const fare = calc.estimate("JR東海", 120);
      expect(fare).toBeGreaterThan(1690);
      expect(fare).toBeLessThan(2200);
    });
  });

  describe("100km超の基準額表（JR本州3社が使う階段テーブル、線形外挿ではなく完全一致）", () => {
    // 出典: http://web.archive.org/web/20260306174402/https://www.jreast.co.jp/2026unchin-kaitei/assets/pdf/kijun_kasan_futsuu.pdf
    // （Wayback Machine経由で全文取得、2026-08-29）。JR東海・JR西日本はこの基準額表と同一の運賃を使う。
    // 従来のbeyond線形式(baseFare+(km-100)*16.2)では250.8km=4,140円になり公式4,510円と-370円ズレていた。
    it("250.8km(281〜300km帯ではなく241〜260km帯)、基準額表どおり4,510円（JR東海）", () => {
      expect(calc.estimate("JR東海", 250.8)).toBe(4510);
    });

    it("293.6km(281〜300km帯)、基準額表どおり5,170円（JR東海）", () => {
      expect(calc.estimate("JR東海", 293.6)).toBe(5170);
    });

    it("303.9km(301〜320km帯)、基準額表どおり5,500円（JR東海）", () => {
      expect(calc.estimate("JR東海", 303.9)).toBe(5500);
    });

    it("250.8kmはJR西日本でも同じ基準額表で4,510円", () => {
      expect(calc.estimate("JR西日本", 250.8)).toBe(4510);
    });

    it("293.6kmはJR西日本でも同じ基準額表で5,170円", () => {
      expect(calc.estimate("JR西日本", 293.6)).toBe(5170);
    });

    it("303.9kmはJR西日本でも同じ基準額表で5,500円", () => {
      expect(calc.estimate("JR西日本", 303.9)).toBe(5500);
    });
  });

  describe("JR西日本（電車特定区間外・幹線が実質据え置き）", () => {
    // 出典: https://www.westjr.co.jp/press/article/items/240515_00_press_keihanshin_unchin.pdf
    // 幹線(拡大区間)は2025年4月改定でも金額変更なし。電車特定区間内の都市部ルートは
    // 特定運賃・別表のため、ここでは電車特定区間外の路線（加算運賃・特定運賃なし）で検証する
    it("岡山→倉敷 15.9km、実運賃330円（山陽本線）", () => {
      expect(calc.estimate("JR西日本", 15.9)).toBe(330);
    });

    it("姫路→岡山 87.6km、実運賃1,520円（山陽本線）", () => {
      expect(calc.estimate("JR西日本", 87.6)).toBe(1520);
    });

    it("鳥取→米子 92.7km、実運賃1,690円（山陰本線）", () => {
      expect(calc.estimate("JR西日本", 92.7)).toBe(1690);
    });
  });

  describe("JR九州（2025年4月1日改定後）", () => {
    // 出典: https://www.jrkyushu.co.jp/railway/kaitei/pdf/241217_unchinkaitei_guidebook.pdf
    // （公式運賃改定ガイドブック、2026-08-29取得。距離帯別普通運賃表を全帯照合し表と完全一致）
    it("博多→二日市 14.2km、実運賃340円（鹿児島本線）", () => {
      expect(calc.estimate("JR九州", 14.2)).toBe(340);
    });

    it("初乗り運賃(1〜3km)が200円", () => {
      expect(calc.estimate("JR九州", 2)).toBe(200);
    });

    it("4〜6kmが240円", () => {
      expect(calc.estimate("JR九州", 5)).toBe(240);
    });
  });

  describe("JR北海道（2025年4月1日改定後）", () => {
    // 出典: https://jr-group.jp/hokkaido-fare/ (2026-08-24取得)
    it("札幌→小樽 33.8km、実運賃800円（函館本線）", () => {
      expect(calc.estimate("JR北海道", 33.8)).toBe(800);
    });

    it("初乗り運賃(1〜3km)が210円", () => {
      expect(calc.estimate("JR北海道", 2)).toBe(210);
    });
  });

  describe("JR四国", () => {
    // 出典: https://www.jr-shikoku.co.jp/teiki/pdf/fare_change.pdf
    // （公式2023年5月20日改定案内、2026-08-29取得。距離帯別普通運賃表を全帯照合し表と完全一致）
    // 予讃線・土讃線・高徳線・本四備讃線は幹線区分であり営業キロをそのまま運賃表に当てはめる。
    // 同資料によれば瀬戸大橋線・地方交通線関連の特定運賃はこの改定で廃止済みのため、
    // 予讃線内の一般区間なら特殊運賃の心配なく完全一致で照合できる
    it("初乗り運賃(1〜3km)が190円", () => {
      expect(calc.estimate("JR四国", 2)).toBe(190);
    });

    it("高松→坂出 21.3km、実運賃530円（予讃線）", () => {
      expect(calc.estimate("JR四国", 21.3)).toBe(530);
    });

    it("高松→丸亀 28.5km、実運賃630円（予讃線）", () => {
      expect(calc.estimate("JR四国", 28.5)).toBe(630);
    });
  });

  describe("近畿日本鉄道", () => {
    // 出典: https://jikokuhyo.train-times.net/data/kintetsu_fare (2026-08-24取得)
    it("大阪難波→近鉄奈良 32.8km、実運賃680円", () => {
      expect(calc.estimate("近畿日本鉄道", 32.8)).toBe(680);
    });

    it("初乗り運賃(1〜3km)が180円", () => {
      expect(calc.estimate("近畿日本鉄道", 2)).toBe(180);
    });
  });

  describe("名古屋鉄道（2024年3月16日改定後）", () => {
    // 出典: 名鉄公式プレスリリース 23-09-01（2026-08-24取得）
    // 名鉄名古屋～犬山（犬山線）は加算運賃対象路線（知多新線・豊田線・羽島線・空港線）にも
    // 特定運賃区間（名古屋本線の金山〜一宮系統）にも該当しない一般区間。
    // 実運賃はekitan.comの運賃検索(2026-08-29取得)で照合し表と完全一致
    it("名鉄名古屋→犬山 28.2km、実運賃630円（犬山線）", () => {
      expect(calc.estimate("名古屋鉄道", 28.2)).toBe(630);
    });

    it("初乗り運賃(1〜3km)が180円", () => {
      expect(calc.estimate("名古屋鉄道", 2)).toBe(180);
    });
  });

  describe("東武鉄道（公式運賃対キロ表より）", () => {
    // 出典: https://www.tobu.co.jp/pdf/ticket/unchinTable.pdf (2026-08-24取得)
    // 実運賃はジョルダン乗換案内(2026-08-29取得)で照合し表と完全一致
    it("浅草→東武動物公園 41.0km、実運賃610円（きっぷ、IC607円）", () => {
      expect(calc.estimate("東武鉄道", 41.0)).toBe(610);
    });

    it("初乗り運賃(1〜4km)が160円", () => {
      expect(calc.estimate("東武鉄道", 3)).toBe(160);
    });
  });

  describe("特定運賃（駅ペア単位の割引運賃）", () => {
    // 出典: https://www.westjr.co.jp/press/article/items/240515_00_press_keihanshin_unchin.pdf
    // 別紙4（2026-08-29取得）。大阪→京都は営業キロ42.8kmで幹線表なら770円だが特定運賃580円。
    it("特定運賃が設定された駅ペアは距離表ではなく特定運賃を返す", () => {
      expect(calc.estimate("JR西日本", 42.8, "大阪", "京都")).toBe(580);
    });

    it("方向を入れ替えても同じ特定運賃になる", () => {
      expect(calc.estimate("JR西日本", 42.8, "京都", "大阪")).toBe(580);
    });

    it("駅名を与えなければ従来どおり距離表を引く", () => {
      expect(calc.estimate("JR西日本", 42.8)).toBe(770);
    });

    it("特定運賃の無いペアは距離表を引く", () => {
      expect(calc.estimate("JR西日本", 42.8, "大阪", "存在しない駅")).toBe(770);
    });

    it("override 未設定の事業者は駅名を渡しても距離表を引く", () => {
      // JR東海の距離表(jr-central.json)で42.8kmは41-45km帯=770円。JR西日本の特定運賃580円とは無関係。
      expect(calc.estimate("JR東海", 42.8, "大阪", "京都")).toBe(770);
    });
  });

  describe("JR東日本の特定運賃（駅探の実測による、jreast.co.jpはbot保護で一次情報取得不可のため）", () => {
    // 出典: 駅探(ekitan.com) 2026-08-29取得。data/fare-overrides/jr-east.json 参照。
    // 公式営業キロで距離表を引いた値と、駅探が返す実運賃（きっぷ）が乖離する区間のみを特定運賃として採用。
    it("新宿→八王子 37.1km、実運賃620円（京王線と競合、表なら720円）", () => {
      expect(calc.estimate("JR東日本", 37.1, "新宿", "八王子")).toBe(620);
    });

    it("新宿→高尾 42.8km、実運賃720円（京王線・高尾山口方面と競合、表なら810円）", () => {
      expect(calc.estimate("JR東日本", 42.8, "新宿", "高尾")).toBe(720);
    });

    it("品川→横浜 22.0km、実運賃350円（京急本線と競合、表なら440円）", () => {
      expect(calc.estimate("JR東日本", 22.0, "品川", "横浜")).toBe(350);
    });
  });

  describe("東京メトロ（2023年3月18日改定後）", () => {
    // 出典: https://www.tokyometro.jp/safety/barrierfree/pdf/barrierfree_price_230525.pdf
    // 実運賃はekitan.com(2026-08-29取得)で照合し、いずれも特定運賃の対象外区間
    it("浅草→渋谷(銀座線) 14.3km、実運賃260円", () => {
      expect(calc.estimate("東京メトロ", 14.3)).toBe(260);
    });

    it("和光市→渋谷(副都心線) 20.4km、実運賃300円", () => {
      expect(calc.estimate("東京メトロ", 20.4)).toBe(300);
    });

    it("中野→西船橋(東西線) 30.8km、実運賃330円", () => {
      expect(calc.estimate("東京メトロ", 30.8)).toBe(330);
    });
  });

  describe("東京都交通局（2019年10月1日改定後）", () => {
    // 出典: https://ja.wikipedia.org/wiki/都営地下鉄
    // 実運賃はekitan.com(2026-08-29取得)で照合
    it("新宿→本八幡(都営新宿線) 23.5km、実運賃380円", () => {
      expect(calc.estimate("東京都交通局", 23.5)).toBe(380);
    });

    it("西馬込→押上(都営浅草線) 18.3km、実運賃330円", () => {
      expect(calc.estimate("東京都交通局", 18.3)).toBe(330);
    });

    it("光が丘→都庁前(都営大江戸線) 12.1km、実運賃280円", () => {
      expect(calc.estimate("東京都交通局", 12.1)).toBe(280);
    });
  });

  describe("Osaka Metro（2023年4月1日改定後）", () => {
    // 出典: https://ja.wikipedia.org/wiki/Osaka_Metro
    // 実運賃はekitan.com(2026-08-29取得)で照合。夢洲発着は加算運賃90円がかかるため対象外
    it("梅田→心斎橋(御堂筋線) 3.2km、実運賃240円", () => {
      expect(calc.estimate("Osaka Metro", 3.2)).toBe(240);
    });

    it("江坂→なかもず(御堂筋線) 24.5km、実運賃390円（19km超はフラット）", () => {
      expect(calc.estimate("Osaka Metro", 24.5)).toBe(390);
    });

    it("大日→八尾南(谷町線) 28.3km、実運賃390円（19km超はフラット）", () => {
      expect(calc.estimate("Osaka Metro", 28.3)).toBe(390);
    });
  });

  describe("名古屋市交通局", () => {
    // 出典: https://www.kotsu.city.nagoya.jp/rp/subway/trp0000172.htm
    // 実運賃はekitan.com(2026-08-29取得)で照合
    it("名古屋→栄(東山線) 2.4km、実運賃210円", () => {
      expect(calc.estimate("名古屋市交通局", 2.4)).toBe(210);
    });

    it("名古屋→金山(東山線・名城線) 5.4km、実運賃240円", () => {
      expect(calc.estimate("名古屋市交通局", 5.4)).toBe(240);
    });

    it("高畑→藤が丘(東山線全線) 20.6km、実運賃340円（15km超はフラット）", () => {
      expect(calc.estimate("名古屋市交通局", 20.6)).toBe(340);
    });
  });

  describe("南海電鉄（2023年10月1日改定後）", () => {
    // 出典: https://www.mlit.go.jp/common/001583779.pdf（運輸審議会説明資料）
    // 実運賃はekitan.com(2026-08-29取得)で照合。難波～三国ヶ丘・中百舌鳥はJR西日本・Osaka Metroとの
    // 競合特定運賃(350円)の対象区間のため使用しない
    it("難波→堺(南海本線) 9.8km、実運賃290円", () => {
      expect(calc.estimate("南海電鉄", 9.8)).toBe(290);
    });

    it("難波→岸和田(南海本線) 26.0km、実運賃540円", () => {
      expect(calc.estimate("南海電鉄", 26.0)).toBe(540);
    });

    it("難波→橋本(高野線) 43.8km、実運賃740円", () => {
      expect(calc.estimate("南海電鉄", 43.8)).toBe(740);
    });
  });

  describe("西武鉄道（2026年3月14日改定後）", () => {
    // 出典: https://www.seiburailway.jp/file.jsp?file%2F202603_fare_bykm.pdf=
    // 実運賃はekitan.com(2026-08-29取得)で照合
    it("池袋→所沢(池袋線) 24.8km、実運賃410円", () => {
      expect(calc.estimate("西武鉄道", 24.8)).toBe(410);
    });

    it("池袋→飯能(池袋線) 43.7km、実運賃560円", () => {
      expect(calc.estimate("西武鉄道", 43.7)).toBe(560);
    });

    it("西武新宿→本川越(新宿線) 47.5km、実運賃600円", () => {
      expect(calc.estimate("西武鉄道", 47.5)).toBe(600);
    });
  });

  describe("阪急電鉄（2023年4月1日改定後）", () => {
    // 出典: https://jikokuhyo.train-times.net/data/hankyu_fare
    // 実運賃はekitan.com(2026-08-29取得)で照合
    it("大阪梅田→西宮北口(神戸線) 15.6km、実運賃280円", () => {
      expect(calc.estimate("阪急電鉄", 15.6)).toBe(280);
    });

    it("大阪梅田→神戸三宮(神戸線) 32.3km、実運賃330円", () => {
      expect(calc.estimate("阪急電鉄", 32.3)).toBe(330);
    });

    it("大阪梅田→京都河原町(京都線) 47.7km、実運賃410円", () => {
      expect(calc.estimate("阪急電鉄", 47.7)).toBe(410);
    });
  });

  describe("広島電鉄（2025年2月1日改定・全線240円均一）", () => {
    // 出典: https://news.railway-pressnet.com/archives/69108
    // 実運賃はekitan.com(2026-08-29取得)で照合。均一運賃のため距離によらず240円
    it("紙屋町東付近 1.9km、実運賃240円", () => {
      expect(calc.estimate("広島電鉄", 1.9)).toBe(240);
    });

    it("宮島線全線 21.3km、実運賃240円", () => {
      expect(calc.estimate("広島電鉄", 21.3)).toBe(240);
    });

    it("極端に短い距離でも240円", () => {
      expect(calc.estimate("広島電鉄", 0.5)).toBe(240);
    });
  });

  describe("京王電鉄（2023年10月1日改定後）", () => {
    // 出典: https://www.keio.co.jp/train/ticket/fare_chart/fare_chart_km.html
    // 実運賃はekitan.com(2026-08-29取得)で照合
    it("新宿→高尾 43.0km、実運賃410円（JR中央線経由720円より安い）", () => {
      expect(calc.estimate("京王電鉄", 43.0)).toBe(410);
    });

    it("新宿→京王八王子 37.9km、実運賃410円", () => {
      expect(calc.estimate("京王電鉄", 37.9)).toBe(410);
    });

    it("新宿→調布 15.5km、実運賃280円", () => {
      expect(calc.estimate("京王電鉄", 15.5)).toBe(280);
    });
  });

  describe("京急電鉄（2023年10月1日改定後）", () => {
    // 出典: https://www.keikyu.co.jp/cp/unchinkaitei/pdf/futsuu_unchin.pdf
    // 実運賃はekitan.com(2026-08-29取得)で照合。品川〜横浜・京急川崎〜横浜はJRと競合する
    // 特定運賃(fare-overrides/keikyu.json)のため、ここでは一般表と一致する区間のみ使用
    it("金沢文庫→横須賀中央 10.4km、実運賃280円", () => {
      expect(calc.estimate("京急電鉄", 10.4)).toBe(280);
    });

    it("金沢文庫→品川 39.5km、実運賃510円", () => {
      expect(calc.estimate("京急電鉄", 39.5)).toBe(510);
    });

    it("品川→横須賀中央 49.9km、実運賃620円", () => {
      expect(calc.estimate("京急電鉄", 49.9)).toBe(620);
    });

    it("品川→横浜はJRと競合する特定運賃320円（一般表なら350円）", () => {
      expect(calc.estimate("京急電鉄", 22.2, "品川", "横浜")).toBe(320);
    });
  });

  describe("京成電鉄（2024年3月16日改定後・バリアフリー料金込み）", () => {
    // 出典: https://jikokuhyo.train-times.net/data/keisei_fare
    // 実運賃はekitan.com・京成公式PDF(2026-08-29取得)で照合。成田空港線は加算運賃対象のため除外
    it("京成上野→青砥 11.5km、実運賃280円", () => {
      expect(calc.estimate("京成電鉄", 11.5)).toBe(280);
    });

    it("京成上野→京成船橋 25.1km、実運賃450円", () => {
      expect(calc.estimate("京成電鉄", 25.1)).toBe(450);
    });

    it("京成成田→京成上野 61.2km、実運賃860円（京成本線経由・空港第2ビル非経由）", () => {
      expect(calc.estimate("京成電鉄", 61.2)).toBe(860);
    });
  });

  describe("京阪電鉄（2025年10月1日改定後）", () => {
    // 出典: https://www.keihan.co.jp/traffic/station/assets/pdf/fare/010.pdf（淀屋橋発着運賃表）
    // 実運賃はekitan.com(2026-08-29取得)で照合
    it("淀屋橋→京橋(大阪) 3.0km、実運賃180円", () => {
      expect(calc.estimate("京阪電鉄", 3.0)).toBe(180);
    });

    it("淀屋橋→枚方市 21.8km、実運賃400円", () => {
      expect(calc.estimate("京阪電鉄", 21.8)).toBe(400);
    });

    it("淀屋橋→出町柳 51.6km（京阪線最長区間）、実運賃550円", () => {
      expect(calc.estimate("京阪電鉄", 51.6)).toBe(550);
    });
  });

  describe("京阪大津線（京津線・石山坂本線、駅ペアoverride）", () => {
    // 出典: https://www.keihan.co.jp/traffic/ticket/information/kirotei.html（営業キロ程）
    // 実運賃はekitan.com(2026-08-29取得)で照合。operator文字列だけでは京阪線本表と大津線を
    // 区別できないため、data/fare-overrides/keihan.jsonで大津線の全駅ペアを個別に上書きする。
    it("御陵→京阪山科(京津線) 1.5km、実運賃200円（本表なら180円）", () => {
      expect(calc.estimate("京阪電鉄", 1.5, "御陵", "京阪山科")).toBe(200);
    });

    it("びわ湖浜大津→石山寺(石山坂本線) 6.7km、実運賃280円（本表なら240円）", () => {
      expect(calc.estimate("京阪電鉄", 6.7, "びわ湖浜大津", "石山寺")).toBe(
        280,
      );
    });

    it("御陵→びわ湖浜大津(京津線) 7.5km、実運賃280円（本表なら240円）", () => {
      expect(calc.estimate("京阪電鉄", 7.5, "御陵", "びわ湖浜大津")).toBe(280);
    });

    it("坂本比叡山口→石山寺(石山坂本線全線) 14.1km、実運賃380円（本表なら360円）", () => {
      expect(calc.estimate("京阪電鉄", 14.1, "坂本比叡山口", "石山寺")).toBe(
        380,
      );
    });

    it("override対象外の駅ペアは京阪線本表を引く", () => {
      expect(calc.estimate("京阪電鉄", 21.8, "淀屋橋", "枚方市")).toBe(400);
    });
  });

  describe("東急電鉄（2023年3月18日改定後・本線対キロ制）", () => {
    // 出典: https://jikokuhyo.train-times.net/data/tokyu_fare
    // 実運賃はekitan.com(2026-08-29取得)で照合
    it("渋谷→池尻大橋(田園都市線) 1.9km、実運賃140円", () => {
      expect(calc.estimate("東急電鉄", 1.9)).toBe(140);
    });

    it("渋谷→横浜(東横線) 24.2km、実運賃310円", () => {
      expect(calc.estimate("東急電鉄", 24.2)).toBe(310);
    });

    it("渋谷→中央林間(田園都市線) 31.5km、実運賃390円", () => {
      expect(calc.estimate("東急電鉄", 31.5)).toBe(390);
    });
  });

  describe("小田急電鉄（2023年3月18日改定後・対キロ区間制）", () => {
    // 出典: https://jikokuhyo.train-times.net/data/odakyu_fare
    // 実運賃はekitan.com(2026-09-20取得)で照合
    it("新宿→小田原 82.5km、実運賃910円（表の最終帯）", () => {
      expect(calc.estimate("小田急電鉄", 82.5)).toBe(910);
    });

    it("新百合ケ丘→新宿 21.5km、実運賃330円", () => {
      expect(calc.estimate("小田急電鉄", 21.5)).toBe(330);
    });

    // 21.5km が 330円 になるのは「18〜21km帯(300円)の上限が21.0km」だから。
    // 帯の境界を取り違えると 21.5km が 300円 になってしまうため、境界の
    // 内側(21.0km)も固定して取り違えを検出できるようにする。
    it("21.0km ちょうどは 300円（帯の上限側の境界）", () => {
      expect(calc.estimate("小田急電鉄", 21.0)).toBe(300);
    });
  });

  describe("阪神電鉄（2023年4月1日改定後・対キロ区間制）", () => {
    // 出典: https://jikokuhyo.train-times.net/data/hanshin_fare
    // 実運賃はekitan.com(2026-09-20取得)で照合
    it("大阪梅田→神戸三宮 31.2km、実運賃330円", () => {
      expect(calc.estimate("阪神電鉄", 31.2)).toBe(330);
    });

    it("大阪梅田→甲子園 14.1km、実運賃280円", () => {
      expect(calc.estimate("阪神電鉄", 14.1)).toBe(280);
    });

    it("13.0km ちょうどは 250円（14.1km=280円 の1つ下の帯）", () => {
      expect(calc.estimate("阪神電鉄", 13.0)).toBe(250);
    });
  });

  describe("埼玉高速鉄道（第三セクター・汎用表では大幅に過小評価になる）", () => {
    // 出典: 公式駅別運賃表 https://www.s-rail.co.jp/line/akabaneiwabuchi.php 他2駅
    // 営業キロは https://ja.wikipedia.org/wiki/埼玉高速鉄道線
    // 3駅ぶんの運賃表から全21ペアを距離と突き合わせて帯を復元した（source.note参照）
    it("赤羽岩淵→浦和美園 14.6km（全線）、実運賃480円", () => {
      expect(calc.estimate("埼玉高速鉄道", 14.6)).toBe(480);
    });

    it("赤羽岩淵→鳩ヶ谷 5.9km、実運賃310円", () => {
      expect(calc.estimate("埼玉高速鉄道", 5.9)).toBe(310);
    });

    it("浦和美園→東川口 2.4km（初乗り）、実運賃210円", () => {
      expect(calc.estimate("埼玉高速鉄道", 2.4)).toBe(210);
    });

    // 帯の復元が正しいことの要。鳩ヶ谷→浦和美園 8.7km は 350円 で、
    // 赤羽岩淵→戸塚安行 10.0km の 400円 とは別の帯に入る。
    it("8.7km は350円、10.0km は400円（9km の帯境界）", () => {
      expect(calc.estimate("埼玉高速鉄道", 8.7)).toBe(350);
      expect(calc.estimate("埼玉高速鉄道", 10.0)).toBe(400);
    });

    // この表を入れた動機。汎用私鉄表なら同じ距離でずっと安くなる
    it("汎用フォールバック表より高い（第三セクターの高運賃を反映できている）", () => {
      expect(calc.estimate("埼玉高速鉄道", 14.6)).toBeGreaterThan(
        calc.estimate("謎電鉄", 14.6),
      );
    });
  });

  describe("西日本鉄道（2026年4月1日改定後・対キロ区間制）", () => {
    // 出典: https://jikokuhyo.train-times.net/data/nishitetsu_fare
    // 実運賃はekitan.com(2026-09-20取得)で照合
    it("西鉄福岡(天神)→大牟田 74.8km、実運賃1,140円（表の最終帯）", () => {
      expect(calc.estimate("西日本鉄道", 74.8)).toBe(1140);
    });

    it("西鉄二日市→西鉄福岡(天神) 15.2km、実運賃420円", () => {
      expect(calc.estimate("西日本鉄道", 15.2)).toBe(420);
    });

    it("13.0km ちょうどは 360円（15.2km=420円 の1つ下の帯）", () => {
      expect(calc.estimate("西日本鉄道", 13.0)).toBe(360);
    });
  });

  describe("東葉高速鉄道（第三セクター・高運賃）", () => {
    // 出典: 公式駅別運賃表6駅分 https://www.toyokosoku.co.jp/wp/wp-content/themes/trr/print.php?pid=32&sec=sta_fare 他
    // 営業キロは https://ja.wikipedia.org/wiki/東葉高速鉄道東葉高速線
    // 48点の実運賃から帯を復元（source.note参照）
    it("西船橋→東葉勝田台 16.2km（全線）、実運賃640円", () => {
      expect(calc.estimate("東葉高速鉄道", 16.2)).toBe(640);
    });

    it("西船橋→東海神 2.1km（初乗り）、実運賃210円", () => {
      expect(calc.estimate("東葉高速鉄道", 2.1)).toBe(210);
    });

    it("西船橋→北習志野 8.1km、実運賃440円", () => {
      expect(calc.estimate("東葉高速鉄道", 8.1)).toBe(440);
    });

    // 帯境界6本すべてを上下から挟んで固定する。実運賃がどれも帯の内側にあると
    // 境界を1km取り違えても気づけないため、境界そのものを検証対象にする。
    it.each([
      [2.9, 210, 3.7, 300], // 境界 3km
      [4.9, 300, 5.2, 370], // 境界 5km
      [6.4, 370, 7.1, 440], // 境界 7km
      [8.9, 440, 9.1, 520], // 境界 9km
      [11.0, 520, 11.7, 580], // 境界 11km
      [13.8, 580, 14.1, 640], // 境界 14km
    ])(
      "%skm=%i円 / %skm=%i円（帯境界を上下から固定）",
      (lowKm, lowFare, highKm, highFare) => {
        expect(calc.estimate("東葉高速鉄道", lowKm)).toBe(lowFare);
        expect(calc.estimate("東葉高速鉄道", highKm)).toBe(highFare);
      },
    );

    it("汎用フォールバック表より高い（第三セクターの高運賃を反映できている）", () => {
      expect(calc.estimate("東葉高速鉄道", 16.2)).toBeGreaterThan(
        calc.estimate("謎電鉄", 16.2),
      );
    });
  });

  describe("相模鉄道（2023年3月18日改定後・対キロ区間制）", () => {
    // 出典: https://jikokuhyo.train-times.net/data/sotetsu_fare
    // 実運賃はekitan.com(2026-09-20取得)で照合
    it("横浜→海老名 24.6km、実運賃330円（表の最終帯）", () => {
      expect(calc.estimate("相模鉄道", 24.6)).toBe(330);
    });

    it("海老名→二俣川 14.1km、実運賃250円", () => {
      expect(calc.estimate("相模鉄道", 14.1)).toBe(250);
    });

    it("11.0km ちょうどは 210円（14.1km=250円 の1つ下の帯）", () => {
      expect(calc.estimate("相模鉄道", 11.0)).toBe(210);
    });
  });

  describe("均一運賃の路面電車（距離によらず同額）", () => {
    // いずれも各社公式サイトで「全線均一」と金額を確認（2026-09-20取得、source.note参照）。
    // 汎用私鉄表は距離で運賃が上がるため、構造そのものが誤りになる事業者群。
    it.each([
      ["阪堺電気軌道", 240],
      ["京福電気鉄道", 250],
      ["長崎電気軌道", 150],
      ["熊本市交通局", 200],
      ["鹿児島市交通局", 200],
    ])("%s は全線均一 %i円", (operator, fare) => {
      // 短距離・中距離・長距離のいずれでも同額になることが均一運賃の要件
      expect(calc.estimate(operator, 0.5)).toBe(fare);
      expect(calc.estimate(operator, 8)).toBe(fare);
      expect(calc.estimate(operator, 25)).toBe(fare);
    });

    it("均一運賃は距離が増えても変わらない（汎用表は増える）", () => {
      expect(calc.estimate("阪堺電気軌道", 2)).toBe(
        calc.estimate("阪堺電気軌道", 18),
      );
      expect(calc.estimate("謎電鉄", 18)).toBeGreaterThan(
        calc.estimate("謎電鉄", 2),
      );
    });
  });

  describe("東急世田谷線・こどもの国線（均一運賃、駅ペアoverride）", () => {
    // 出典: https://setagaya-line.com/2023/03/18/ (世田谷線160円均一)
    //       https://ja.wikipedia.org/wiki/東急こどもの国線 (こどもの国線 IC157円/きっぷ160円。
    //       本プロジェクトは全事業者きっぷ運賃で統一のため160円を採用)
    // 本線用の対キロ制表(tokyu.json)ではなくoverrideが適用されることを確認
    it("三軒茶屋→下高井戸(世田谷線全線)は均一160円", () => {
      expect(calc.estimate("東急電鉄", 5.0, "三軒茶屋", "下高井戸")).toBe(160);
    });

    it("世田谷線内の隣接駅(松陰神社前→世田谷)も同じ160円均一", () => {
      expect(calc.estimate("東急電鉄", 0.6, "松陰神社前", "世田谷")).toBe(160);
    });

    it("長津田→こどもの国(こどもの国線全線)は均一160円（きっぷ。IC157円とは別）", () => {
      expect(calc.estimate("東急電鉄", 3.4, "長津田", "こどもの国")).toBe(160);
    });

    it("override対象外の駅ペアは本線の対キロ制表を引く", () => {
      expect(calc.estimate("東急電鉄", 24.2, "渋谷", "横浜")).toBe(310);
    });
  });

  describe("tableFare の二分探索境界（table が maxKm 昇順である前提の検証）", () => {
    // c795886 で線形走査から二分探索に変わった。二分探索は「km <= maxKm を
    // 満たす最初の行」を探すが、線形走査と一致するのは table が maxKm の
    // 昇順であるときだけ。ここでは境界値を総当たりして両者が一致することを固定する。
    const table: [number, number][] = [
      [3, 100],
      [10, 200],
      [30, 300],
    ];
    const calcTable = createFareCalculator([
      {
        id: "test-boundary",
        operators: [],
        table,
        beyond: { fromKm: 30, baseFare: 300, ratePerKm: 10 },
      },
    ]);

    it("最初の行の maxKm ちょうど", () => {
      expect(calcTable.estimate("X", 3)).toBe(100);
    });

    it("行間の値（2行目に落ちる）", () => {
      expect(calcTable.estimate("X", 5)).toBe(200);
    });

    it("最終行の maxKm ちょうど", () => {
      expect(calcTable.estimate("X", 30)).toBe(300);
    });

    it("最終行を超過すると beyond 外挿に落ちる", () => {
      expect(calcTable.estimate("X", 31)).toBe(
        Math.ceil((300 + 1 * 10) / 10) * 10,
      );
    });

    it("1行だけのテーブル", () => {
      const single = createFareCalculator([
        {
          id: "test-single",
          operators: [],
          table: [[10, 999]],
          beyond: { fromKm: 10, baseFare: 999, ratePerKm: 5 },
        },
      ]);
      expect(single.estimate("X", 5)).toBe(999);
      expect(single.estimate("X", 10)).toBe(999);
      expect(single.estimate("X", 11)).toBe(Math.ceil((999 + 1 * 5) / 10) * 10);
    });

    it("空テーブルは常に beyond 外挿に落ちる", () => {
      const empty = createFareCalculator([
        {
          id: "test-empty",
          operators: [],
          table: [],
          beyond: { fromKm: 0, baseFare: 150, ratePerKm: 20 },
        },
      ]);
      expect(empty.estimate("X", 1)).toBe(Math.ceil((150 + 1 * 20) / 10) * 10);
      expect(empty.estimate("X", 100)).toBe(
        Math.ceil((150 + 100 * 20) / 10) * 10,
      );
    });
  });

  describe("fareRuleSchema: table が maxKm 昇順であることの検証", () => {
    // 二分探索（tableFare）は table が maxKm の厳密な昇順であることに依存する。
    // 順序が崩れたデータはパース時点で確実に弾かれる必要がある。
    const baseBeyond = { fromKm: 30, baseFare: 300, ratePerKm: 10 };

    it("maxKm が降順を含むデータは parse で例外になる", () => {
      expect(() =>
        fareRuleSchema.parse({
          id: "broken-desc",
          operators: [],
          table: [
            [10, 200],
            [3, 100],
            [30, 300],
          ],
          beyond: baseBeyond,
        }),
      ).toThrow();
    });

    it("maxKm が同値（重複）のデータも parse で例外になる（二分探索の一意性が崩れるため）", () => {
      expect(() =>
        fareRuleSchema.parse({
          id: "broken-dup",
          operators: [],
          table: [
            [3, 100],
            [10, 200],
            [10, 250],
          ],
          beyond: baseBeyond,
        }),
      ).toThrow();
    });

    it("エラーメッセージにルール id と違反位置(index)が含まれる", () => {
      try {
        fareRuleSchema.parse({
          id: "broken-with-id",
          operators: [],
          table: [
            [10, 200],
            [3, 100],
          ],
          beyond: baseBeyond,
        });
        throw new Error("should have thrown");
      } catch (e) {
        const message = String(e);
        expect(message).toContain("broken-with-id");
        expect(message).toContain("table[0]");
        expect(message).toContain("table[1]");
      }
    });

    it("正しく昇順のデータは parse を通る", () => {
      expect(() =>
        fareRuleSchema.parse({
          id: "ok",
          operators: [],
          table: [
            [3, 100],
            [10, 200],
            [30, 300],
          ],
          beyond: baseBeyond,
        }),
      ).not.toThrow();
    });
  });

  describe("lowerBound（探索の枝刈り用下界。締めすぎ・緩めすぎのどちらも危険）", () => {
    const lbTable: [number, number][] = [
      [5, 100],
      [10, 200],
      [20, 400],
    ];
    const calcLb = createFareCalculator(
      [
        {
          id: "test-lb",
          operators: [],
          table: lbTable,
          beyond: { fromKm: 20, baseFare: 400, ratePerKm: 20 },
        },
      ],
      [
        {
          operator: "OpLB",
          pairs: [
            { from: "Anchor1", to: "Anchor2", fare: 90 },
            { from: "Anchor2", to: "Anchor3", fare: 50 },
          ],
          source: { url: "", fetchedAt: "2026-08-29", note: "test" },
        },
      ],
    );

    it("override 非対象の起点（override ペアに一切登場しない駅）は tableFare(km) と一致する", () => {
      for (const km of [0, 3, 5, 6, 10, 15, 20, 25]) {
        expect(calcLb.lowerBound("OpLB", km, "非対象駅")).toBe(
          calcLb.estimate("OpLB", km),
        );
      }
    });

    it("fromName を省略した場合も tableFare と事業者全体の override 最小値の小さいほう", () => {
      // 事業者全体の override 最小値は 50（Anchor2-Anchor3）
      expect(calcLb.lowerBound("OpLB", 20)).toBe(
        Math.min(calcLb.estimate("OpLB", 20), 50),
      );
      expect(calcLb.lowerBound("OpLB", 3)).toBe(
        Math.min(calcLb.estimate("OpLB", 3), 50),
      );
    });

    it("override ペアに from 側として登場する起点は、その駅を含むペアの最小運賃と tableFare の小さいほうになる", () => {
      // Anchor1 は (Anchor1,Anchor2)=90 のみに登場 => 駅単位の最小値は 90
      const km = 20; // tableFare=400
      expect(calcLb.lowerBound("OpLB", km, "Anchor1")).toBe(
        Math.min(calcLb.estimate("OpLB", km), 90),
      );
      expect(calcLb.lowerBound("OpLB", km, "Anchor1")).toBeLessThanOrEqual(
        calcLb.estimate("OpLB", km),
      );
    });

    it("override ペアの to 側にだけ登場する起点でも同様に締まる（pairKey の対称性に依存）", () => {
      // Anchor3 は (Anchor2,Anchor3)=50 の to 側にしか登場しない。
      // ここが崩れると本来到達できる駅を誤って刈ってしまう。
      const km = 20;
      expect(calcLb.lowerBound("OpLB", km, "Anchor3")).toBe(
        Math.min(calcLb.estimate("OpLB", km), 50),
      );
    });

    it("駅単位の下界は事業者全体の override 最小値以上（締まっている）", () => {
      for (const station of ["Anchor1", "Anchor2", "Anchor3"]) {
        for (const km of [0, 5, 10, 20, 30]) {
          const stationBound = calcLb.lowerBound("OpLB", km, station);
          const operatorBound = calcLb.lowerBound("OpLB", km);
          expect(stationBound).toBeGreaterThanOrEqual(operatorBound);
        }
      }
    });

    it("下界性: km' >= km ならどの終点名についても lowerBound(km) <= estimate(km', 終点名)", () => {
      const kms = [0, 1, 3, 5, 6, 10, 12, 20, 25, 40];
      const froms = [undefined, "非対象駅", "Anchor1", "Anchor2", "Anchor3"];
      const tos = [
        undefined,
        "非対象駅",
        "Anchor1",
        "Anchor2",
        "Anchor3",
        "他の駅",
      ];
      for (const from of froms) {
        for (const km of kms) {
          const lb = calcLb.lowerBound("OpLB", km, from);
          for (const kmPrime of kms) {
            if (kmPrime < km) continue;
            for (const to of tos) {
              const est = calcLb.estimate("OpLB", kmPrime, from, to);
              expect(lb).toBeLessThanOrEqual(est);
            }
          }
        }
      }
    });
  });

  describe("isOverrideAnchor（探索側が区間の起点駅を区別すべきか判定するための API）", () => {
    // 探索側 (lib/search/reachable.ts) は、区間の起点駅の名前がその事業者の
    // override 駅ペアのどちらにも登場しない場合、この区間は将来どの駅で降りても
    // override を引けないと判断して状態をマージする（状態爆発を防ぐ最適化）。
    // その安全性は「from と to の両方が anchor と判定される」ことに依存するため、
    // 逆向き探索（B→A）でも override を引けることを確認する必要がある。
    const calcAnchor = createFareCalculator(
      [
        {
          id: "test",
          operators: [],
          table: [[10, 200]],
          beyond: { fromKm: 10, baseFare: 200, ratePerKm: 20 },
        },
      ],
      [
        {
          operator: "OpA",
          pairs: [{ from: "A", to: "B", fare: 150 }],
          source: { url: "", fetchedAt: "2026-08-29", note: "test" },
        },
        {
          operator: "OpA",
          pairs: [{ from: "C", to: "D", fare: 90 }],
          source: { url: "", fetchedAt: "2026-08-29", note: "test" },
        },
      ],
    );

    it("(a) override ペアの from・to のどちらも anchor と判定される", () => {
      expect(calcAnchor.isOverrideAnchor("OpA", "A")).toBe(true);
      expect(calcAnchor.isOverrideAnchor("OpA", "B")).toBe(true);
    });

    it("(b) override 未登録の事業者・駅名では false", () => {
      expect(calcAnchor.isOverrideAnchor("OpA", "存在しない駅")).toBe(false);
      expect(calcAnchor.isOverrideAnchor("未登録事業者", "A")).toBe(false);
    });

    it("(c) stationName が undefined なら false", () => {
      expect(calcAnchor.isOverrideAnchor("OpA", undefined)).toBe(false);
    });

    it("(d) 同一事業者に複数の override エントリがあるとき駅集合がマージされる", () => {
      // "C","D" は2つ目の override エントリ（別の pairs 配列）に属する。
      // マージされていなければここが false になってしまう。
      expect(calcAnchor.isOverrideAnchor("OpA", "C")).toBe(true);
      expect(calcAnchor.isOverrideAnchor("OpA", "D")).toBe(true);
    });
  });

  // JR本州3社（東日本・東海・西日本）をまたぐ通し運賃 = 基準額（総営業キロで
  // 基準額表を1回引いた額）+ 加算額（eastKmに対して加算額表を1回引いた額）。
  // 基準額表は data/fare-rules/jr-central.json（JR東海、据え置きの幹線表）を
  // 代表として使う。「100km超は加算額0円」は出典にない誤りだったため廃止した
  // （加算額表には541km以上の帯まで存在する。詳細は
  // .superpowers/sdd/2026-08-24-fare-accuracy/kasan-verified.md 参照）。
  describe("estimateHonshuThrough / honshuThroughBaseFare（JR本州3社をまたぐ通し運賃）", () => {
    it("総距離100km以下: 基準額＋加算額（jr-central.json・jr-honshu-kasan.json の実データで検証）", () => {
      // 90km = jr-central.json の [90, 1520] 帯。加算額表 [30, 20] は26〜30km帯=20円。
      expect(calc.estimateHonshuThrough(90, 30)).toBe(1520 + 20);
      // ちょうど100km: 基準額 [100, 1690] + 加算額 [100, 100]（91〜100km帯）
      expect(calc.estimateHonshuThrough(100, 100)).toBe(1690 + 100);
    });

    it("総距離100km超でも加算額は0円にならない（長野→名古屋相当、公式4,580円）", () => {
      // 長野→名古屋相当: 基準額4,510円(241〜260km帯) + 加算額70円(71〜80km帯) = 4,580円。
      // 修正前の実装は totalKm>100 で加算額を強制的に0円にしていたため 4,510円になっていた。
      expect(calc.estimateHonshuThrough(250.8, 76.9)).toBe(4580);
    });

    it("東京→豊橋相当（281〜300km帯、実運賃5,170円）: eastKmが0ならJR東日本分の加算はない", () => {
      // 東京都区内発の東海道方面は東京〜熱海間を新幹線(JR東海)経由として計算するため
      // eastKmが0になる（探索側 lib/search/reachable.ts の責務）。ここでは
      // calculator自体は「eastKm=0を渡されれば加算額表の該当帯(0円)を引くだけ」であることを確認する。
      expect(calc.estimateHonshuThrough(293.6, 0)).toBe(5170);
    });

    it("東京→名古屋相当（361〜380km帯、実運賃6,380円）: eastKm=0なら基準額のみ", () => {
      expect(calc.estimateHonshuThrough(370, 0)).toBe(6380);
    });

    it("東京→大阪相当（541〜560km帯、実運賃8,910円）: eastKm=0なら基準額のみ", () => {
      expect(calc.estimateHonshuThrough(556.4, 0)).toBe(8910);
    });

    it("eastKmが渡されると加算額表の該当帯が乗る（101〜120km帯=110円）", () => {
      // 104.6km は101〜120km帯なので加算額110円。
      expect(calc.estimateHonshuThrough(556.4, 104.6)).toBe(8910 + 110);
    });

    it("eastKmが541km以上でも加算額は440円固定（beyond）", () => {
      expect(calc.estimateHonshuThrough(3400, 541)).toBe(
        calc.honshuThroughBaseFare(3400) + 440,
      );
      expect(calc.estimateHonshuThrough(3400, 1000)).toBe(
        calc.honshuThroughBaseFare(3400) + 440,
      );
    });

    it("km<=0 は0円", () => {
      expect(calc.estimateHonshuThrough(0, 0)).toBe(0);
      expect(calc.estimateHonshuThrough(-1, 0)).toBe(0);
    });

    it("honshuThroughBaseFare は加算額抜きの基準額のみ（枝刈り用の下界）", () => {
      expect(calc.honshuThroughBaseFare(90)).toBe(1520);
      expect(calc.honshuThroughBaseFare(293.6)).toBe(5170);
      expect(calc.honshuThroughBaseFare(0)).toBe(0);
    });

    // コントローラが確定した加算額表（kasan-verified.md）の算術検証を固定する。
    // 公式定義「加算額＝改定後のJR東日本運賃－基準額」に従い、
    // jr-east.json（改定後JR東日本）とjr-central.json（基準額）の差額を
    // 100km以下の16帯すべてで計算し、jr-honshu-kasan.jsonの値と一致することを確認する。
    // ここが崩れると「81-90km=100円/91-100km=110円」のような前回の誤転記が再発する。
    it("加算額表(100kmまでの16帯)がjr-east.json - jr-central.jsonの差額と一致する（算術検証）", () => {
      const cases: { km: number; east: number; base: number }[] = [
        { km: 3, east: 160, base: 150 },
        { km: 6, east: 200, base: 190 },
        { km: 10, east: 210, base: 200 },
        { km: 15, east: 260, base: 240 },
        { km: 20, east: 350, base: 330 },
        { km: 25, east: 440, base: 420 },
        { km: 30, east: 530, base: 510 },
        { km: 35, east: 620, base: 590 },
        { km: 40, east: 720, base: 680 },
        { km: 45, east: 810, base: 770 },
        { km: 50, east: 910, base: 860 },
        { km: 60, east: 1040, base: 990 },
        { km: 70, east: 1230, base: 1170 },
        { km: 80, east: 1410, base: 1340 },
        { km: 90, east: 1600, base: 1520 },
        { km: 100, east: 1790, base: 1690 },
      ];
      for (const { km, east, base } of cases) {
        expect(calc.estimate("JR東日本", km)).toBe(east);
        expect(calc.estimate("JR東海", km)).toBe(base);
        const kasan = east - base;
        // eastKm=km・totalKm=kmとして通し運賃を引くと base+kasanになるはず
        // （同じ距離帯であることを前提とした単純化: 通し運賃自体は
        // totalKmとeastKmを別々に引く点に注意。ここではkasan額そのものの
        // 一致だけを検証するため、加算額表を直接引けるkmでestimateHonshuThroughを呼ぶ）。
        expect(
          calc.estimateHonshuThrough(km, km) - calc.honshuThroughBaseFare(km),
        ).toBe(kasan);
      }
    });

    it("基準額表(JR東海)・加算額表が未登録の calculator で呼ぶとエラーになる（サイレントな誤運賃を防ぐ）", () => {
      const bare = createFareCalculator([
        {
          id: "fallback",
          operators: [],
          table: [[10, 100]],
          beyond: { fromKm: 10, baseFare: 100, ratePerKm: 10 },
        },
      ]);
      expect(() => bare.estimateHonshuThrough(50, 10)).toThrow();
      expect(() => bare.honshuThroughBaseFare(50)).toThrow();
    });
  });
});
