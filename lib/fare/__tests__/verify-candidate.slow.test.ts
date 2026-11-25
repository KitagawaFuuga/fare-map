import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyFareCandidate, type Finding } from "@/lib/fare/verify-candidate";
import { buildOperatorKmTable } from "@/lib/graph/operator-distance";
import type { RailGraph } from "@/lib/graph/types";

const errors = (findings: Finding[], check: string) =>
  findings.filter((f) => f.severity === "error" && f.check === check);

// ---- 受け入れ条件: 実データで行ズレを捕まえる ----
// scripts/fare/extract/README.md に、富山地方鉄道で行が1つずれると
// 荻生→宇奈月温泉が 740円 のところ 840円 になる、という実例が残っている。
// PDF の中だけで閉じた検査ではこれを見抜けないため、グラフの座標という
// 独立した情報を使う距離単調性がゲートの本体になる。
//
// 1事業者だけで閾値を決めると他社で破綻するため、手元にある全ペアの揃った
// 運賃表6事業者すべてにかける。万葉線(均一運賃)だけは距離検査が原理的に
// 効かず、検出側ではなく「無力」を警告する側に回る。
describe("実データ6事業者（受け入れ条件）", () => {
  const graph = JSON.parse(
    readFileSync("data/graph.json", "utf8"),
  ) as RailGraph;
  const override = JSON.parse(
    readFileSync("data/fare-overrides/chitetsu.json", "utf8"),
  ) as {
    operator: string;
    pairs: { from: string; to: string; fare: number }[];
  };

  const buildKm = (operator: string) => buildOperatorKmTable(graph, operator);

  // 基準駅からの距離順に駅を並べ、発駅のラベルを1つ後ろへずらす。
  // PDF の行と駅の対応を1つ取り違えた状態にあたる。
  const shiftStations = (
    pairs: { from: string; to: string; fare: number }[],
    kmBetween: (a: string, b: string) => number | null,
  ) => {
    const stations = [...new Set(pairs.flatMap((p) => [p.from, p.to]))];
    const anchor = stations[0] as string;
    const ordered = stations
      .map((s) => ({ s, d: kmBetween(anchor, s) }))
      .filter((x) => x.d !== null)
      .sort((a, b) => (a.d as number) - (b.d as number))
      .map((x) => x.s);
    const moved = new Map<string, string>();
    ordered.forEach((s, i) => {
      moved.set(s, ordered[(i + 1) % ordered.length] as string);
    });
    return pairs.map((p) => ({ ...p, from: moved.get(p.from) ?? p.from }));
  };

  // 全ペアが揃っている運賃表。距離が運賃を区別する事業者（万葉線以外）は
  // ずらしたときに検出できなければならない。
  const complete = readdirSync("data/fare-sources")
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const j = JSON.parse(readFileSync(`data/fare-sources/${f}`, "utf8")) as {
        operator: string;
        pairs: { from: string; to: string; fare: number }[];
      };
      return { label: f, ...j };
    })
    .concat([{ label: "chitetsu.json", ...override }]);

  it.each(complete)("$label の正しいデータはエラーにならない", (set) => {
    const findings = verifyFareCandidate(
      { operator: set.operator, pairs: set.pairs },
      { kmBetween: buildKm(set.operator) },
    );
    expect(errors(findings, "distance-monotonicity")).toHaveLength(0);
  });

  // 距離を変えても運賃がほとんど動かない事業者は、距離単調性が原理的に効かない。
  // 検出できる側ではなく「無力」の警告が出る側に回る。
  // 万葉線は路面電車で運賃が5種しかなく、都電荒川線は全線均一170円の1種。
  const FLAT_FARE_OPERATORS = ["万葉線", "東京都交通局(都電)"];
  // 駅が少なく運賃の段階も少ないため、駅を1つずらしても距離単調性の検査では
  // 目立たない表。取り違えは、抽出のときに表ごとの別の検算で検出している:
  //   千葉都市モノレール  行列の左下の小児運賃が全組で大人運賃の半額になること
  //   神戸新交通          同じ組の「区」と運賃が全組で対応すること（環状線もある）
  //   北九州高速鉄道・埼玉新都市交通・愛知高速交通
  //                       表の対称性と、線路に沿って運賃が下がらないこと
  //   肥薩おれんじ鉄道    大人・小児の2段で、小児運賃が全組で大人運賃の半額になること
  //   三陸鉄道・天竜浜名湖鉄道
  //                       行ごとの値の数と、線路に沿って運賃が下がらないこと
  //   松浦鉄道            3つの表の行の長さ、行・列の両方向の単調性、認可資料の25組との一致
  // 長い1本の路線（三陸・肥薩おれんじ・天浜線・松浦）は、1駅ずらしても距離の変化が運賃の段差より
  // 小さく、距離単調性では目立たない。
  // ここに足すときは、上のような表ごとの検算を抽出スクリプトか書き起こしに入れること。
  const CHECKED_BY_TABLE = [
    "千葉都市モノレール",
    "神戸新交通",
    "北九州高速鉄道",
    "埼玉新都市交通",
    "愛知高速交通",
    "肥薩おれんじ鉄道",
    "三陸鉄道",
    "天竜浜名湖鉄道",
    "松浦鉄道",
  ];
  const detectable = complete.filter(
    (s) =>
      !FLAT_FARE_OPERATORS.includes(s.operator) &&
      !CHECKED_BY_TABLE.includes(s.operator),
  );

  it.each(detectable)("$label は駅を1つずらすと検出できる", (set) => {
    const kmBetween = buildKm(set.operator);
    const findings = verifyFareCandidate(
      { operator: set.operator, pairs: shiftStations(set.pairs, kmBetween) },
      { kmBetween },
    );
    expect(errors(findings, "distance-monotonicity").length).toBeGreaterThan(0);
  });

  it.each(FLAT_FARE_OPERATORS)(
    "%s は距離検査が無力だと警告する（黙って通さない）",
    (operator) => {
      const set = complete.find((s) => s.operator === operator);
      expect(set).toBeDefined();
      const findings = verifyFareCandidate(
        { operator, pairs: set?.pairs ?? [] },
        { kmBetween: buildKm(operator) },
      );
      expect(
        findings.filter((f) => f.check === "distance-check-ineffective"),
      ).toHaveLength(1);
    },
  );

  it("距離で運賃が動く事業者には無力の警告を出さない", () => {
    const findings = verifyFareCandidate(
      { operator: override.operator, pairs: override.pairs },
      { kmBetween: buildKm(override.operator) },
    );
    expect(
      findings.filter((f) => f.check === "distance-check-ineffective"),
    ).toHaveLength(0);
  });
});
