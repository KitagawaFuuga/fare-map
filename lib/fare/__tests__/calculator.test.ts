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

/** 実運賃との誤差率を検証する。目標は±10%以内（brief参照）。 */
function expectWithinTolerance(
  operator: string,
  km: number,
  realFare: number,
  tolerance = 0.1,
) {
  const fare = calc.estimate(operator, km);
  const diff = Math.abs(fare - realFare) / realFare;
  expect(diff).toBeLessThanOrEqual(tolerance);
}

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
    // 各実運賃は allabout.co.jp / train-writer.jp 等の報道記事のIC運賃をきっぷ運賃(10円単位切上げ)に換算し照合
    it("新宿→東京 10.3km、実運賃260円(きっぷ、IC253円)", () => {
      expectWithinTolerance("JR東日本", 10.3, 260);
    });

    it("東京→横浜 28.8km、実運賃530円(きっぷ、IC528円)", () => {
      expectWithinTolerance("JR東日本", 28.8, 530);
    });

    it("東京→大宮 30.3km、実運賃620円相当(きっぷ、IC616円)", () => {
      expectWithinTolerance("JR東日本", 30.3, 620);
    });
  });

  describe("JR東海（改定なし・据え置き）", () => {
    // 出典: https://jr-group.jp/tokai-fare/ (2026-08-24取得)。改定前と同一表であることを確認済み
    it("豊橋→浜松 39.7km、実運賃680円", () => {
      expectWithinTolerance("JR東海", 39.7, 680);
    });

    it("浜松→静岡 76.9km、実運賃1,340円", () => {
      expectWithinTolerance("JR東海", 76.9, 1340);
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
    // 特定運賃・別表のため、ここでは電車特定区間外の路線で検証する
    it("岡山→倉敷 15.9km、実運賃330円（山陽本線）", () => {
      expectWithinTolerance("JR西日本", 15.9, 330);
    });

    it("姫路→岡山 87.6km、実運賃1,520円（山陽本線）", () => {
      expectWithinTolerance("JR西日本", 87.6, 1520);
    });

    it("鳥取→米子 92.7km、実運賃1,690円（山陰本線）", () => {
      expectWithinTolerance("JR西日本", 92.7, 1690);
    });
  });

  describe("JR九州（2025年4月1日改定後）", () => {
    // 出典: https://jr-group.jp/kyushu-fare/ (2026-08-24取得)
    it("博多→二日市 14.2km、実運賃340円", () => {
      expectWithinTolerance("JR九州", 14.2, 340);
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
    it("札幌→小樽 33.8km、実運賃800円", () => {
      expectWithinTolerance("JR北海道", 33.8, 800);
    });

    it("初乗り運賃(1〜3km)が210円", () => {
      expect(calc.estimate("JR北海道", 2)).toBe(210);
    });
  });

  describe("JR四国", () => {
    // 出典: https://jikokuhyo.train-times.net/data/jrshikoku_fare (2026-08-24取得)。
    // JR四国は地方交通線が多く擬制キロ(実キロ×1.1)で運賃計算されるため、
    // 実キロそのままだと実運賃よりやや安く出る傾向がある点に留意
    it("初乗り運賃(1〜3km)が190円", () => {
      expect(calc.estimate("JR四国", 2)).toBe(190);
    });

    it("高松→坂出 相当（擬制キロ21km換算）、実運賃530円", () => {
      expectWithinTolerance("JR四国", 21, 530);
    });
  });

  describe("近畿日本鉄道", () => {
    // 出典: https://jikokuhyo.train-times.net/data/kintetsu_fare (2026-08-24取得)
    it("大阪難波→近鉄奈良 32.8km、実運賃680円", () => {
      expectWithinTolerance("近畿日本鉄道", 32.8, 680);
    });

    it("初乗り運賃(1〜3km)が180円", () => {
      expect(calc.estimate("近畿日本鉄道", 2)).toBe(180);
    });
  });

  describe("名古屋鉄道（2024年3月16日改定後）", () => {
    // 出典: 名鉄公式プレスリリース 23-09-01（2026-08-24取得）
    it("神宮前→中部国際空港 38.6km、実運賃830円", () => {
      expectWithinTolerance("名古屋鉄道", 38.6, 830);
    });

    it("初乗り運賃(1〜3km)が180円", () => {
      expect(calc.estimate("名古屋鉄道", 2)).toBe(180);
    });
  });

  describe("東武鉄道（公式運賃対キロ表より）", () => {
    // 出典: https://www.tobu.co.jp/pdf/ticket/unchinTable.pdf (2026-08-24取得)
    it("浅草→東武動物公園 相当41km、実運賃610円(きっぷ、IC607円)", () => {
      expectWithinTolerance("東武鉄道", 41, 610);
    });

    it("初乗り運賃(1〜4km)が160円", () => {
      expect(calc.estimate("東武鉄道", 3)).toBe(160);
    });
  });
});
