import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyFareCandidate, type Finding } from "@/lib/fare/verify-candidate";
import type { RailGraph } from "@/lib/graph/types";

// 距離を返さない文脈。距離に依存しない検査だけを見たいとき用。
const noKm = { kmBetween: () => null };

const errors = (findings: Finding[], check: string) =>
  findings.filter((f) => f.severity === "error" && f.check === check);

describe("対称性", () => {
  it("同じ駅ペアが違う運賃で二度現れたらエラーにする", () => {
    const findings = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: [
          { from: "A", to: "B", fare: 200 },
          { from: "B", to: "A", fare: 250 },
        ],
      },
      noKm,
    );
    expect(errors(findings, "symmetry")).toHaveLength(1);
    expect(errors(findings, "symmetry")[0]?.samples.join()).toContain("A");
  });

  it("同じ駅ペアが同じ運賃なら所見を出さない", () => {
    const findings = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: [
          { from: "A", to: "B", fare: 200 },
          { from: "B", to: "A", fare: 200 },
        ],
      },
      noKm,
    );
    expect(errors(findings, "symmetry")).toHaveLength(0);
  });
});

describe("欠落ペア", () => {
  it("全組み合わせに満たない場合は警告する", () => {
    // 3駅なら C(3,2)=3 ペアあるはずだが 2 ペアしかない
    const findings = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: [
          { from: "A", to: "B", fare: 200 },
          { from: "B", to: "C", fare: 200 },
        ],
      },
      noKm,
    );
    const f = findings.filter((x) => x.check === "missing-pairs");
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("warn");
    expect(f[0]?.samples.join()).toContain("C");
  });

  it("全組み合わせが揃っていれば所見を出さない", () => {
    const findings = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: [
          { from: "A", to: "B", fare: 200 },
          { from: "B", to: "C", fare: 200 },
          { from: "A", to: "C", fare: 300 },
        ],
      },
      noKm,
    );
    expect(findings.filter((x) => x.check === "missing-pairs")).toHaveLength(0);
  });
});

describe("運賃額の所属", () => {
  it("公式の運賃額一覧に無い値はエラーにする", () => {
    const findings = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: [
          { from: "A", to: "B", fare: 200 },
          { from: "A", to: "C", fare: 237 },
          { from: "B", to: "C", fare: 300 },
        ],
      },
      { ...noKm, allowedFares: [200, 300, 400] },
    );
    const f = errors(findings, "fare-not-allowed");
    expect(f).toHaveLength(1);
    expect(f[0]?.samples.join()).toContain("237");
  });

  it("一覧を渡さなければこの検査は行わない", () => {
    const findings = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: [{ from: "A", to: "B", fare: 237 }],
      },
      noKm,
    );
    expect(findings.filter((x) => x.check === "fare-not-allowed")).toHaveLength(
      0,
    );
  });
});

describe("距離単調性", () => {
  // 一直線に並ぶ駅。駅間隔は不均一にする。等間隔かつ運賃が距離に完全比例する表は
  // 駅を1つずらしても単調性が保たれてしまい（運賃が1区間ぶん平行移動するだけ）、
  // 実在の路線から乖離する。
  const line = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const cumulative = [0, 1.2, 3.5, 4.1, 7.8, 9.0, 13.4, 14.2, 19.6, 21.0];
  const pos = new Map(line.map((n, i) => [n, cumulative[i] as number]));
  const kmBetween = (a: string, b: string) => {
    const x = pos.get(a);
    const y = pos.get(b);
    return x === undefined || y === undefined ? null : Math.abs(x - y);
  };
  const allPairs = (fare: (km: number) => number) => {
    const pairs = [];
    for (let i = 0; i < line.length; i++)
      for (let j = i + 1; j < line.length; j++)
        pairs.push({
          from: line[i] as string,
          to: line[j] as string,
          fare: fare((cumulative[j] as number) - (cumulative[i] as number)),
        });
    return pairs;
  };

  it("距離に対して単調な運賃表では所見を出さない", () => {
    const findings = verifyFareCandidate(
      { operator: "テスト鉄道", pairs: allPairs((km) => 100 + km * 50) },
      { kmBetween },
    );
    expect(errors(findings, "distance-monotonicity")).toHaveLength(0);
  });

  it("運賃が距離をほとんど区別しない場合は「検査が無力」と警告する", () => {
    // 路面電車の均一運賃。距離を変えても運賃が動かないので、行がずれても
    // 距離単調性では見抜けない。所見なしを「検証できた」と誤読させないため、
    // 無力であること自体を所見として出す。
    const findings = verifyFareCandidate(
      { operator: "テスト軌道", pairs: allPairs(() => 200) },
      { kmBetween },
    );
    const f = findings.filter((x) => x.check === "distance-check-ineffective");
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("warn");
  });

  it("距離で運賃が動く表では「検査が無力」とは言わない", () => {
    const findings = verifyFareCandidate(
      { operator: "テスト鉄道", pairs: allPairs((km) => 100 + km * 50) },
      { kmBetween },
    );
    expect(
      findings.filter((x) => x.check === "distance-check-ineffective"),
    ).toHaveLength(0);
  });

  it("距離が離れるほど安くなる駅を検出する", () => {
    // D 発の運賃だけ距離に逆行させる
    const pairs = allPairs((km) => 100 + km * 50).map((p) =>
      p.from === "D" || p.to === "D"
        ? { ...p, fare: 1000 - (kmBetween(p.from, p.to) ?? 0) * 50 }
        : p,
    );
    const findings = verifyFareCandidate(
      { operator: "テスト鉄道", pairs },
      { kmBetween },
    );
    const f = errors(findings, "distance-monotonicity");
    expect(f.length).toBeGreaterThan(0);
    expect(f.map((x) => x.samples.join()).join()).toContain("D");
  });

  it("距離が取れないペアは距離の検査から除外する", () => {
    // 距離不明の駅 Z を足しても、既存の単調な表は落ちない
    const pairs = [
      ...allPairs((km) => 100 + km * 50),
      { from: "A", to: "Z", fare: 9999 },
    ];
    const findings = verifyFareCandidate(
      { operator: "テスト鉄道", pairs },
      { kmBetween },
    );
    expect(errors(findings, "distance-monotonicity")).toHaveLength(0);
  });
});

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

  // 事業者内の rail エッジだけを辿り、駅名どうしの距離を先に全件求めておく。
  // 1ペアずつ都度探索すると 2,211 ペアぶんで数十秒かかる。
  const buildKm = (operator: string) => {
    const nodes = Object.values(graph.nodes).filter(
      (n) => n.operator === operator,
    );
    const inOp = new Set(nodes.map((n) => n.id));
    const idsByName = new Map<string, string[]>();
    for (const n of nodes) {
      const l = idsByName.get(n.name) ?? [];
      l.push(n.id);
      idsByName.set(n.name, l);
    }
    const adj = new Map<string, { to: string; km: number }[]>();
    const push = (a: string, b: string, km: number) => {
      const l = adj.get(a) ?? [];
      l.push({ to: b, km });
      adj.set(a, l);
    };
    for (const e of graph.edges) {
      if (!inOp.has(e.from) || !inOp.has(e.to)) continue;
      if (e.kind === "rail" && e.operator !== operator) continue;
      push(e.from, e.to, e.kind === "rail" ? e.km : 0);
      push(e.to, e.from, e.kind === "rail" ? e.km : 0);
    }
    const nameOf = new Map(nodes.map((n) => [n.id, n.name]));

    // 駅名ごとに1回だけ全域へのダイクストラを回す
    const table = new Map<string, Map<string, number>>();
    for (const [name, starts] of idsByName) {
      const dist = new Map<string, number>();
      const queue: [number, string][] = [];
      for (const s of starts) {
        dist.set(s, 0);
        queue.push([0, s]);
      }
      while (queue.length) {
        queue.sort((x, y) => x[0] - y[0]);
        const next = queue.shift();
        if (!next) break;
        const [d, id] = next;
        if (d > (dist.get(id) ?? Infinity)) continue;
        for (const e of adj.get(id) ?? []) {
          const nd = d + e.km;
          if (nd < (dist.get(e.to) ?? Infinity)) {
            dist.set(e.to, nd);
            queue.push([nd, e.to]);
          }
        }
      }
      const byName = new Map<string, number>();
      for (const [id, d] of dist) {
        const n = nameOf.get(id);
        if (n === undefined) continue;
        if (d < (byName.get(n) ?? Infinity)) byName.set(n, d);
      }
      table.set(name, byName);
    }
    return (a: string, b: string): number | null =>
      table.get(a)?.get(b) ?? null;
  };

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

  // 万葉線は路面電車で運賃が5種しかなく、距離を変えても運賃がほとんど動かない。
  // 距離単調性は原理的に効かないので、検出ではなく「無力」の警告が出る側に回る。
  const detectable = complete.filter((s) => s.operator !== "万葉線");

  it.each(detectable)("$label は駅を1つずらすと検出できる", (set) => {
    const kmBetween = buildKm(set.operator);
    const findings = verifyFareCandidate(
      { operator: set.operator, pairs: shiftStations(set.pairs, kmBetween) },
      { kmBetween },
    );
    expect(errors(findings, "distance-monotonicity").length).toBeGreaterThan(0);
  });

  it("万葉線は距離検査が無力だと警告する（黙って通さない）", () => {
    const set = complete.find((s) => s.operator === "万葉線");
    expect(set).toBeDefined();
    const findings = verifyFareCandidate(
      { operator: "万葉線", pairs: set?.pairs ?? [] },
      { kmBetween: buildKm("万葉線") },
    );
    expect(
      findings.filter((f) => f.check === "distance-check-ineffective"),
    ).toHaveLength(1);
  });

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
