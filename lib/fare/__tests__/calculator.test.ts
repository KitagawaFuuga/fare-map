import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import { fareOverrideSchema, fareRuleSchema } from "@/lib/fare/types";
import jrEast from "@/data/fare-rules/jr-east.json";
import jrCentral from "@/data/fare-rules/jr-central.json";
import jrWest from "@/data/fare-rules/jr-west.json";
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
import jrWestOverride from "@/data/fare-overrides/jr-west.json";
import jrEastOverride from "@/data/fare-overrides/jr-east.json";

const rules = [
  jrEast,
  jrCentral,
  jrWest,
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
].map((r) => fareRuleSchema.parse(r));
const overrides = [jrWestOverride, jrEastOverride].map((o) =>
  fareOverrideSchema.parse(o),
);
const calc = createFareCalculator(rules, overrides);

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
      expect(calc.estimate("JR西日本", 42.8, "大阪", "存在しない駅")).toBe(
        770,
      );
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
});
