import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import { fareRuleSchema } from "@/lib/fare/types";
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
].map((r) => fareRuleSchema.parse(r));
const calc = createFareCalculator(rules);

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
});
