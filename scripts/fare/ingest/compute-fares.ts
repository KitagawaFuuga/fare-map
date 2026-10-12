// 公式の運賃規則から実額を計算し、特定運賃として書き出す。
//
//   npx tsx scripts/fare/ingest/compute-fares.ts [--write] [--operator=名古屋鉄道]
//
// --write を付けなければ何も書かず、件数と差の内訳だけを表示する。
//
// 扱うのは2つ。どちらも「路線」に紐づくため、事業者単位で距離帯表を引く
// 実行時の運賃計算器では表現できない。
//
//   1. 擬制キロ（data/fare-distance-classes.json）
//      名鉄は線区ごとに擬制率をかけた運賃計算キロで運賃を決める。
//      営業キロのまま引くと安く出る。
//   2. 加算運賃（data/fare-surcharges.json）
//      新線の建設費に充てる上乗せ。距離帯式と駅間表式がある。
//
// 探索まで改修が波及するのを避けるため、生成時に実額を出して
// data/fare-overrides/ に置く。運賃は最短経路で計算するという規則どおりなので、
// 探索がどの経路を通っても端点で引ければ正しい額になる。
//
// どちらも入れないと運賃が実額より安く出る。到達できない駅を到達できると言う
// 側の誤りなので、精度の問題では済まない。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createFareCalculator } from "@/lib/fare/calculator";
import {
  surchargeAmount,
  surchargePairAmount,
  surchargeSchema,
  type Surcharge,
} from "@/lib/fare/surcharge";
import { fareRuleSchema } from "@/lib/fare/types";
import type { RailGraph, StationNode } from "@/lib/graph/types";

const FETCHED_AT = new Date().toISOString().slice(0, 10);

// 事業者名 → 書き出すファイル名。data/fare-surcharges.json に事業者を足したら
// ここにも足す（決め打ちのままだと別の事業者のファイルを上書きしてしまう）
const OUTPUT_IDS: Record<string, string> = {
  近畿日本鉄道: "kintetsu",
  名古屋鉄道: "meitetsu",
  JR九州: "jr-kyushu",
  JR西日本: "jr-west-seto",
  南海電鉄: "nankai",
  北大阪急行電鉄: "kitakyu",
};

interface DistanceClass {
  operator: string;
  rates: Record<string, number>;
  source: { url: string; fetchedAt: string; note: string };
}

/** 加算定義ごとの「乗った距離」と「乗り入れ駅・降りた駅」 */
interface Ridden {
  km: number;
  entry: string;
  exit: string;
}

interface Leg {
  to: string;
  km: number;
  rate: number;
  /** この辺が加算対象になる定義の id */
  surcharged: string[];
}

interface State {
  /** 運賃計算キロ（擬制率をかけた値）。経路の選択もこれで行う */
  weighted: number;
  ridden: Map<string, Ridden>;
}

/** 辺がどの路線に属するか。両端が同じ路線名ならそれ、違えば不明 */
function lineOfEdge(
  nodes: Record<string, StationNode>,
  from: string,
  to: string,
): string | null {
  const a = nodes[from]?.lineName;
  const b = nodes[to]?.lineName;
  return a !== undefined && a === b ? a : null;
}

function main(write: boolean, onlyOperator: string | undefined): void {
  const graph = JSON.parse(
    readFileSync("data/graph.json", "utf8"),
  ) as RailGraph;
  const classes = (
    JSON.parse(readFileSync("data/fare-distance-classes.json", "utf8")) as {
      classes: DistanceClass[];
    }
  ).classes;
  const surcharges = (
    JSON.parse(readFileSync("data/fare-surcharges.json", "utf8")) as {
      surcharges: unknown[];
    }
  ).surcharges.map((s) => surchargeSchema.parse(s) as Surcharge);
  for (const s of surcharges.filter((x) => x.pending === true)) {
    process.stdout.write(`保留: ${s.id}（${s.lines.join("・")}）\n`);
  }

  // 加算前・擬制前の額を引くため、距離帯だけの計算器を使う
  const tableOnly = createFareCalculator(
    readdirSync("data/fare-rules")
      .filter((f) => f.endsWith(".json"))
      .map((f) =>
        fareRuleSchema.parse(
          JSON.parse(readFileSync(`data/fare-rules/${f}`, "utf8")),
        ),
      ),
  );

  // 擬制キロだけの事業者は graph.json の fareKm で実行時に解決されるので、
  // 特定運賃を作る必要が無い（JR各社はこれに該当し、全ペア走ると数百万組になる）。
  // ここで扱うのは加算運賃のある事業者だけ。
  const operators = [
    ...new Set(
      surcharges.filter((s) => s.pending !== true).map((s) => s.operator),
    ),
  ].filter((op) => onlyOperator === undefined || op === onlyOperator);

  for (const operator of operators) {
    const rates = classes.find((c) => c.operator === operator)?.rates ?? {};
    const applied = surcharges.filter(
      (s) => s.operator === operator && s.pending !== true,
    );
    const nodes = Object.values(graph.nodes).filter(
      (n) => n.operator === operator,
    );
    const inOperator = new Set(nodes.map((n) => n.id));
    const nameOf = new Map(nodes.map((n) => [n.id, n.name]));

    const adjacency = new Map<string, Leg[]>();
    const link = (from: string, to: string, km: number) => {
      const line = lineOfEdge(graph.nodes, from, to);
      const rate = line === null ? 1 : (rates[line] ?? 1);
      const surcharged: string[] = [];
      for (const s of applied) {
        if (line === null || !s.lines.includes(line)) continue;
        // 路線の一部だけが対象のときは、両端がその区間に入る辺だけ数える
        if (s.stations !== undefined) {
          const a = graph.nodes[from]?.name ?? "";
          const b = graph.nodes[to]?.name ?? "";
          if (!s.stations.includes(a) || !s.stations.includes(b)) continue;
        }
        surcharged.push(s.id);
      }
      adjacency.set(from, [
        ...(adjacency.get(from) ?? []),
        { to, km, rate, surcharged },
      ]);
    };
    for (const e of graph.edges) {
      if (!inOperator.has(e.from) || !inOperator.has(e.to)) continue;
      if (e.kind === "rail" && e.operator !== operator) continue;
      const km = e.kind === "rail" ? e.km : 0;
      link(e.from, e.to, km);
      link(e.to, e.from, km);
    }

    const idsByName = new Map<string, string[]>();
    for (const n of nodes) {
      idsByName.set(n.name, [...(idsByName.get(n.name) ?? []), n.id]);
    }

    const pairs = new Map<string, { from: string; to: string; fare: number }>();
    let sameAsTable = 0;
    for (const [origin, starts] of idsByName) {
      const best = new Map<string, State>();
      const queue: { id: string; state: State }[] = [];
      for (const id of starts) {
        const state: State = { weighted: 0, ridden: new Map() };
        best.set(id, state);
        queue.push({ id, state });
      }
      while (queue.length > 0) {
        let pick = 0;
        for (let i = 1; i < queue.length; i++) {
          const q = queue[i];
          const p = queue[pick];
          if (
            q !== undefined &&
            p !== undefined &&
            q.state.weighted < p.state.weighted
          )
            pick = i;
        }
        const cur = queue.splice(pick, 1)[0];
        if (cur === undefined) break;
        if (cur.state.weighted > (best.get(cur.id)?.weighted ?? Infinity))
          continue;
        for (const leg of adjacency.get(cur.id) ?? []) {
          const weighted = cur.state.weighted + leg.km * leg.rate;
          if (weighted >= (best.get(leg.to)?.weighted ?? Infinity)) continue;
          const ridden = new Map(cur.state.ridden);
          for (const id of leg.surcharged) {
            const prev = ridden.get(id);
            // 乗り入れ駅は最初に対象路線の辺を踏んだところ、降りた駅は最後
            ridden.set(id, {
              km: (prev?.km ?? 0) + leg.km,
              entry: prev?.entry ?? nameOf.get(cur.id) ?? "",
              exit: nameOf.get(leg.to) ?? "",
            });
          }
          const state: State = { weighted, ridden };
          best.set(leg.to, state);
          queue.push({ id: leg.to, state });
        }
      }

      // 同名ノードのうち運賃計算キロが最小のものを採る
      const byName = new Map<string, State>();
      for (const [id, state] of best) {
        const name = nameOf.get(id);
        if (name === undefined || name === origin) continue;
        const cur = byName.get(name);
        if (cur === undefined || state.weighted < cur.weighted)
          byName.set(name, state);
      }

      for (const [destination, state] of byName) {
        // 擬制キロは graph.json の fareKm に焼いてあり実行時が扱うので、
        // ここで足すのは加算運賃だけ。両方で足すと二重になる。
        let extra = 0;
        for (const s of applied) {
          const r = state.ridden.get(s.id);
          extra +=
            s.pairs !== undefined
              ? surchargePairAmount(s, r?.entry, r?.exit)
              : surchargeAmount(s, r?.km ?? 0);
        }
        if (extra === 0) {
          sameAsTable++;
          continue;
        }
        const fare = tableOnly.estimate(operator, state.weighted) + extra;
        const key = [origin, destination].sort().join("\u0000");
        if (!pairs.has(key))
          pairs.set(key, { from: origin, to: destination, fare });
      }
    }

    const hasRates = Object.keys(rates).length > 0;
    process.stdout.write(
      `${operator}: 加算のかかるペア ${pairs.size}（加算なしで落としたもの ${sameAsTable}）` +
        ` 擬制キロ${hasRates ? "あり" : "なし"} 加算${applied.length}件\n`,
    );
    if (!write || pairs.size === 0) continue;

    const id = `${OUTPUT_IDS[operator] ?? ""}-computed`;
    if (id === "-computed") {
      throw new Error(
        `${operator} の出力ファイル名が OUTPUT_IDS に無い（data/fare-surcharges.json に` +
          `事業者を足したら、ここにも名前を足す）`,
      );
    }
    const urls = [
      ...new Set(
        [
          classes.find((c) => c.operator === operator)?.source.url,
          ...applied.map((s) => s.source?.url),
        ].filter((u): u is string => u !== undefined && u !== ""),
      ),
    ];
    writeFileSync(
      `data/fare-overrides/${id}.json`,
      `${JSON.stringify(
        {
          operator,
          pairs: [...pairs.values()].sort((a, b) =>
            a.from === b.from
              ? a.to.localeCompare(b.to)
              : a.from.localeCompare(b.from),
          ),
          source: {
            url: urls.join(", "),
            fetchedAt: FETCHED_AT,
            note:
              `公式の運賃規則から計算した実額。距離帯表そのままでは引けないペアだけを持つ。` +
              (hasRates
                ? `擬制キロは graph.json の fareKm に焼いてあるので、ここには含まれない（定義と出典は data/fare-distance-classes.json）。`
                : "") +
              (applied.length > 0
                ? `加算運賃は ${applied.map((s) => s.lines.join("・")).join(" / ")}（定義と出典は data/fare-surcharges.json）。`
                : "") +
              `営業キロは data/graph.json。再生成は npx tsx scripts/fare/ingest/compute-fares.ts --write`,
          },
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(`  書き出し: data/fare-overrides/${id}.json\n`);
  }
}

main(
  process.argv.includes("--write"),
  process.argv.find((a) => a.startsWith("--operator="))?.slice(11),
);
