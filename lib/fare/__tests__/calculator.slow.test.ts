import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import chitetsuOverride from "@/data/fare-overrides/chitetsu.json";
import shinanoOverride from "@/data/fare-overrides/shinano.json";
import { createFareCalculator } from "@/lib/fare/calculator";
import { fareOverrideSchema, fareRuleSchema } from "@/lib/fare/types";
import { buildOperatorKmTable } from "@/lib/graph/operator-distance";
import type { RailGraph } from "@/lib/graph/types";

// calculator.test.ts のうち、全国の路線網（data/graph.json）の距離で運賃を確かめるもの。
// 路線網を読むので *.slow.test.ts にしている（ミューテーションテストから外す）。
// 運賃表は本番（lib/server/graph-store.ts）と同じく、ディレクトリごと読む
const readAll = (dir: string): unknown[] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as unknown);
const rules = readAll("data/fare-rules").map((r) => fareRuleSchema.parse(r));
const overrides = readAll("data/fare-overrides").map((o) =>
  fareOverrideSchema.parse(o),
);
const calc = createFareCalculator(rules, overrides);

// 富山地方鉄道・しなの鉄道の距離表は枝刈りの下界専用で、公表営業キロではなく
// graph.json の駅間距離（座標から求めて実営業キロで補正した値）で帯を切ってある。
// 探索が calculator に渡すのもこの距離なので、検証も同じ距離でなければ意味がない
// （公表営業キロで検証していたときは、実際には5ペアで下界が破れているのに緑だった）。
// 探索が運賃を引くのに使うのは営業キロではなく運賃計算キロ（GraphEdge.fareKm）。
// 擬制キロのある事業者はこちらで検証しなければ意味がない
// 距離の計算は本体（lib/graph/operator-distance.ts）と同じものを使う。テストの中に
// 最短経路を書くと、本体とずれても気づけず、テスト自体の誤りも検査できない。
// 呼び出し側が [駅, 駅].sort().join("\u0000") のキーで引くので、その形に合わせる
let graphCache: RailGraph | undefined;
const loadGraph = (): RailGraph =>
  (graphCache ??= JSON.parse(
    readFileSync("data/graph.json", "utf8"),
  ) as RailGraph);
function graphKmOf(
  operator: string,
  useFareKm = false,
): { get: (key: string) => number | undefined } {
  const km = buildOperatorKmTable(loadGraph(), operator, { useFareKm });
  return {
    get: (key) => {
      const [a = "", b = ""] = key.split("\u0000");
      return km(a, b) ?? undefined;
    },
  };
}

/** 探索が運賃を引くのに使う距離（運賃計算キロ） */
const graphFareKmOf = (operator: string) => graphKmOf(operator, true);

describe("FareCalculator（路線網の距離で検証）", () => {
  describe("加算運賃（JR）", () => {
    // 出典: JR九州 運賃改定ガイドブック p4「加算運賃」。
    // 宮崎空港線 田吉〜宮崎空港の130円。ガイドブックの例では宮崎〜宮崎空港が
    // 運賃計算キロ6.2kmで普通運賃270円＋加算130円＝400円。
    // 本実装は370円で30円低い。原因は加算運賃ではなく、graph.json が同じ物理区間を
    // 運転系統名ごとに重複して持っており（南宮崎〜田吉が「JR宮崎空港線」＝幹線と
    // 「JR日南線」＝地方交通線の2本）、最短経路が擬制キロの小さいほうを選ぶこと。
    // 加算運賃を入れる前は240円だったので、改善してはいる。
    it("宮崎→宮崎空港に加算運賃130円が乗る", () => {
      const km = graphFareKmOf("JR九州").get(
        ["宮崎", "宮崎空港"].sort().join("\u0000"),
      );
      expect(km).toBeDefined();
      expect(
        calc.estimate("JR九州", km!, "宮崎", "宮崎空港") -
          calc.estimate("JR九州", km!),
      ).toBe(130);
    });

    it("宮崎空港を通らない区間には加算運賃が乗らない", () => {
      const km = graphFareKmOf("JR九州").get(
        ["宮崎", "田吉"].sort().join("\u0000"),
      );
      expect(km).toBeDefined();
      expect(calc.estimate("JR九州", km!, "宮崎", "田吉")).toBe(
        calc.estimate("JR九州", km!),
      );
    });

    // 出典: JR四国の公開加算額表（本四備讃線 児島〜宇多津18.1kmの110円を含む）。
    // graph.json ではこの区間が瀬戸大橋線としてJR西日本のエッジになっている。
    // JR西日本（1,150駅）の全駅間距離を作るので数秒かかり、全体を並列実行すると
    // 既定の5秒を超えて落ちる（値の誤りではない）。時間を延ばしておく
    it("岡山→宇多津に本四備讃線の加算運賃110円が乗る", () => {
      const km = graphFareKmOf("JR西日本").get(
        ["岡山", "宇多津"].sort().join("\u0000"),
      );
      expect(km).toBeDefined();
      expect(
        calc.estimate("JR西日本", km!, "岡山", "宇多津") -
          calc.estimate("JR西日本", km!),
      ).toBe(110);
    }, 60_000);
  });

  describe("近畿日本鉄道", () => {
    // 距離を直値で書いてはいけない。実行時に使われるのは graph.json の距離なので、
    // 直値だとグラフ側が狂っても気づけない。実際に全国鉄道運行本数データの
    // 難波線の区間キロが2.8km（正しくは2.0km）だったため 190.5km と出ており、
    // 181〜190km帯の2,860円ではなく191〜200km帯の3,000円になっていた。
    // 差し替えは data/kilometrage-corrections.json。
    it("大阪難波→近鉄名古屋は 189.7km で 2,860円（graph.json の距離で検証）", () => {
      const km = graphFareKmOf("近畿日本鉄道").get(
        ["大阪難波", "近鉄名古屋"].sort().join("\u0000"),
      );
      expect(km).toBeCloseTo(189.7, 1);
      expect(calc.estimate("近畿日本鉄道", km!, "大阪難波", "近鉄名古屋")).toBe(
        2860,
      );
    });
  });

  describe("名古屋鉄道（2024年3月16日改定後）", () => {
    // この4点は実運賃そのもの。距離はグラフの営業キロを渡して、
    // 生成の過程が変わったら落ちるようにしてある。
    it("名鉄名古屋→犬山 は 630円（営業キロ27.9のままだと570円）", () => {
      const key = ["名鉄名古屋", "犬山"].sort().join("\u0000");
      // 探索は運賃計算キロで引く。擬制キロが効いて 630円 になる
      expect(
        calc.estimate("名古屋鉄道", graphFareKmOf("名古屋鉄道").get(key)!),
      ).toBe(630);
      // 営業キロのままだと1帯安い。直っていることを同時に固定する
      expect(
        calc.estimate("名古屋鉄道", graphKmOf("名古屋鉄道").get(key)!),
      ).toBe(570);
    });

    it.each([
      ["常滑", "中部国際空港", 330],
      ["太田川", "中部国際空港", 650],
      ["名鉄名古屋", "中部国際空港", 980],
    ])("%s→%s は %i円（擬制キロ＋空港線の加算運賃）", (from, to, fare) => {
      const d = graphFareKmOf("名古屋鉄道").get(
        [from, to].sort().join("\u0000"),
      );
      expect(d).toBeDefined();
      expect(
        calc.estimate("名古屋鉄道", d!, from as string, to as string),
      ).toBe(fare);
    });
  });

  describe("東武鉄道（公式運賃対キロ表より）", () => {
    // 小泉線は館林〜東小泉〜太田を、遠回りな伊勢崎線経由に合わせた擬制キロ
    // 20.1km で運賃計算する（実キロは16.2km）。実キロで引くと330円で50円安く
    // 出るが、この擬制キロは全国鉄道運行本数データの区間営業キロ（館林〜東小泉
    // 11.0km）の側にすでに入っており、graph.json の km がそれになっている。
    // 名鉄やJR地方交通線のように fareKm で持つ必要はない。
    // 実運賃は ekitan.com (2026-09-25取得) で380円/20.1kmを確認。
    it("小泉線の館林→太田は擬制キロ20.1kmで380円（実キロ16.2kmなら330円）", () => {
      expect(
        graphKmOf("東武鉄道").get(["館林", "太田"].sort().join("\u0000")),
      ).toBeCloseTo(20.1, 3);
      expect(calc.estimate("東武鉄道", 20.1)).toBe(380);
      expect(calc.estimate("東武鉄道", 16.2)).toBe(330);
    });
  });

  describe("富山地方鉄道（鉄道線67駅の全2211ペアをoverrideで登録）", () => {
    // 距離表は「各距離での最小運賃」の階段。枝刈りの下界に使うので実運賃を超えてはいけない
    // 枝刈りの下界としての正しさ。graph を再生成して駅間距離が動くと帯の境界を
    // またいで壊れうる（境界の余裕は最小6m）ので、実距離で全ペアを検査する
    it("距離表は全2211ペアの実運賃を上回らない（graph.json の実距離で検証）", () => {
      const km = graphKmOf("富山地方鉄道");
      expect(chitetsuOverride.pairs).toHaveLength(2211);
      let checked = 0;
      for (const p of chitetsuOverride.pairs) {
        const d = km.get([p.from, p.to].sort().join("\u0000"));
        expect(
          d,
          `${p.from}-${p.to} の距離が graph.json から取れない`,
        ).toBeDefined();
        expect(
          calc.estimate("富山地方鉄道", d!),
          `${p.from}→${p.to} ${d!.toFixed(3)}km`,
        ).toBeLessThanOrEqual(p.fare);
        checked++;
      }
      expect(checked).toBe(2211);
    });

    // override が丸ごと消えても距離表が同じ値を返すペアが多く、代表値のテストでは
    // 欠落を検出できない。件数と、距離表と食い違う値が実際に引けることの両方を見る
    it("override は全2211ペア揃っていて、距離表と違う値が引ける", () => {
      const km = graphKmOf("富山地方鉄道");
      const differing = chitetsuOverride.pairs.filter((p) => {
        const d = km.get([p.from, p.to].sort().join("\u0000"));
        return d !== undefined && calc.estimate("富山地方鉄道", d) !== p.fare;
      });
      expect(differing.length).toBeGreaterThan(100);
      for (const p of differing.slice(0, 50)) {
        expect(
          calc.estimate("富山地方鉄道", 0.1, p.from, p.to),
          `${p.from}→${p.to}`,
        ).toBe(p.fare);
      }
    });
  });

  describe("しなの鉄道（2026年3月14日改定）", () => {
    // 探索は confirmedFare + lowerBound で枝を刈るので、lowerBound が実運賃を
    // 上回ると予算内の経路を取りこぼす。ここで守るのはその不変条件。
    //
    // lowerBound は override の駅別最小額と min を取るため、距離表が実額を
    // 上回っていても隠れてしまう。ここで見るのは距離表そのもの。
    // 表は scripts/fare/derive-lower-bound.ts が実額行列と graph.json の距離から
    // 作っており、この不変条件が表の生成規則そのものになっている。
    it("距離表は全435ペアの実運賃を上回らない（graph.json の実距離で検証）", () => {
      const km = graphKmOf("しなの鉄道");
      expect(shinanoOverride.pairs).toHaveLength(435);
      for (const p of shinanoOverride.pairs) {
        const d = km.get([p.from, p.to].sort().join("\u0000"));
        expect(
          d,
          `${p.from}-${p.to} の距離が graph.json から取れない`,
        ).toBeDefined();
        expect(
          calc.estimate("しなの鉄道", d!),
          `${p.from}→${p.to} ${d!.toFixed(3)}km`,
        ).toBeLessThanOrEqual(p.fare);
      }
    });
  });

  // 運賃表・特定運賃と data/graph.json の結合はすべて手打ちの日本語（事業者名・駅名）で、
  // 1文字でも違うと calculator は黙って汎用フォールバック表に落ちる。zod もファイル読み込み
  // 漏れ検出テストもこの食い違いは見ないので、ここで実データと突き合わせる。
  describe("運賃データと graph.json の整合", () => {
    const graph = JSON.parse(
      readFileSync("data/graph.json", "utf8"),
    ) as RailGraph;
    const nodes = Object.values(graph.nodes);
    const operators = new Set(nodes.map((n) => n.operator));
    const stationsByOperator = new Map<string, Set<string>>();
    for (const n of nodes) {
      let s = stationsByOperator.get(n.operator);
      if (!s) stationsByOperator.set(n.operator, (s = new Set()));
      s.add(n.name);
    }

    it("運賃表が宣言する事業者名はすべて graph.json に実在する", () => {
      const missing = rules
        .flatMap((r) => r.operators)
        .filter((op) => !op.startsWith("__") && !operators.has(op));
      expect(missing).toEqual([]);
    });

    it("特定運賃の事業者名と駅名はすべて graph.json に実在する", () => {
      const missing: string[] = [];
      for (const o of overrides) {
        const stations = stationsByOperator.get(o.operator);
        if (!stations) {
          missing.push(`事業者 ${o.operator}`);
          continue;
        }
        for (const p of o.pairs) {
          if (!stations.has(p.from)) missing.push(`${o.operator}/${p.from}`);
          if (!stations.has(p.to)) missing.push(`${o.operator}/${p.to}`);
        }
      }
      expect([...new Set(missing)]).toEqual([]);
    });

    it("同じ事業者を宣言する運賃表が2つ以上ない（後勝ちで静かに上書きされる）", () => {
      const seen = new Map<string, string[]>();
      for (const r of rules)
        for (const op of r.operators) {
          let l = seen.get(op);
          if (!l) seen.set(op, (l = []));
          l.push(r.id);
        }
      expect([...seen].filter(([, ids]) => ids.length > 1)).toEqual([]);
    });

    it("特定運賃に同じ駅ペアの重複がない（後勝ちで静かに上書きされる）", () => {
      const dup: string[] = [];
      for (const o of overrides) {
        const seen = new Set<string>();
        for (const p of o.pairs) {
          const key = [p.from, p.to].sort().join("\u0000");
          if (seen.has(key)) dup.push(`${o.operator}: ${p.from}-${p.to}`);
          seen.add(key);
          if (p.from === p.to) dup.push(`${o.operator}: 同一駅 ${p.from}`);
        }
      }
      expect(dup).toEqual([]);
    });
  });
});
