// 加算運賃のかかる区間を「距離帯の額＋加算額」で計算し、特定運賃として書き出す。
//
//   npx tsx scripts/fare/ingest/apply-surcharges.ts [--write]
//
// --write を付けなければ何も書かず、件数と照合結果だけを表示する。
//
// 運賃計算器は事業者単位で距離帯表を引くので、路線単位でかかる加算運賃を
// 実行時に足すことができない。探索まで改修が波及するのを避けるため、
// 生成時に実額を出して data/fare-overrides/ に置く。運賃は最短経路で計算する
// という規則どおりなので、探索がどの経路を通っても端点で引ければ正しい額になる。
//
// 対象は data/fare-surcharges.json。加算を入れないと運賃が実額より安く出て、
// 到達できない駅を到達できると言うことになる。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createFareCalculator } from "@/lib/fare/calculator";
import { surchargeAmount, surchargeSchema } from "@/lib/fare/surcharge";
import type { Surcharge } from "@/lib/fare/surcharge";
import { fareRuleSchema } from "@/lib/fare/types";
import type { RailGraph, StationNode } from "@/lib/graph/types";

const FETCHED_AT = new Date().toISOString().slice(0, 10);

interface Leg {
  to: string;
  km: number;
  /** この区間で加算対象になる距離（対象外なら 0） */
  surchargedKm: Map<string, number>;
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

function main(write: boolean): void {
  const graph = JSON.parse(
    readFileSync("data/graph.json", "utf8"),
  ) as RailGraph;
  const surcharges = (
    JSON.parse(readFileSync("data/fare-surcharges.json", "utf8")) as {
      surcharges: unknown[];
    }
  ).surcharges.map((s) => surchargeSchema.parse(s) as Surcharge);

  // 加算前の額を引くため、距離帯だけの計算器を使う
  const tableOnly = createFareCalculator(
    readdirSync("data/fare-rules")
      .filter((f) => f.endsWith(".json"))
      .map((f) =>
        fareRuleSchema.parse(
          JSON.parse(readFileSync(`data/fare-rules/${f}`, "utf8")),
        ),
      ),
  );

  const byOperator = new Map<string, Surcharge[]>();
  for (const s of surcharges) {
    byOperator.set(s.operator, [...(byOperator.get(s.operator) ?? []), s]);
  }

  for (const [operator, list] of byOperator) {
    const nodes = Object.values(graph.nodes).filter(
      (n) => n.operator === operator,
    );
    const inOperator = new Set(nodes.map((n) => n.id));

    // 隣接表。辺ごとに、どの加算定義に何km効くかを先に持たせる
    const adjacency = new Map<string, Leg[]>();
    const link = (from: string, to: string, km: number) => {
      const line = lineOfEdge(graph.nodes, from, to);
      const surchargedKm = new Map<string, number>();
      for (const s of list) {
        if (line === null || !s.lines.includes(line)) continue;
        // 路線の一部だけが対象のときは、両端がその区間に入る辺だけ数える
        if (s.stations !== undefined) {
          const a = graph.nodes[from]?.name ?? "";
          const b = graph.nodes[to]?.name ?? "";
          if (!s.stations.includes(a) || !s.stations.includes(b)) continue;
        }
        surchargedKm.set(s.id, km);
      }
      adjacency.set(from, [
        ...(adjacency.get(from) ?? []),
        { to, km, surchargedKm },
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
    const nameOf = new Map(nodes.map((n) => [n.id, n.name]));

    // 駅名ごとに、最短経路とその経路上の加算対象キロを求める
    const pairs = new Map<string, { from: string; to: string; fare: number }>();
    let surchargedPairs = 0;
    for (const [origin, starts] of idsByName) {
      const best = new Map<
        string,
        { km: number; surcharged: Map<string, number> }
      >();
      const queue: { id: string; km: number; s: Map<string, number> }[] = [];
      for (const id of starts) {
        best.set(id, { km: 0, surcharged: new Map() });
        queue.push({ id, km: 0, s: new Map() });
      }
      while (queue.length > 0) {
        let pick = 0;
        for (let i = 1; i < queue.length; i++) {
          const q = queue[i];
          const p = queue[pick];
          if (q !== undefined && p !== undefined && q.km < p.km) pick = i;
        }
        const cur = queue.splice(pick, 1)[0];
        if (cur === undefined) break;
        if (cur.km > (best.get(cur.id)?.km ?? Infinity)) continue;
        for (const leg of adjacency.get(cur.id) ?? []) {
          const km = cur.km + leg.km;
          if (km >= (best.get(leg.to)?.km ?? Infinity)) continue;
          const s = new Map(cur.s);
          for (const [id, add] of leg.surchargedKm) {
            s.set(id, (s.get(id) ?? 0) + add);
          }
          best.set(leg.to, { km, surcharged: s });
          queue.push({ id: leg.to, km, s });
        }
      }

      // 同名ノードのうち最短のものを採る
      const byName = new Map<
        string,
        { km: number; surcharged: Map<string, number> }
      >();
      for (const [id, v] of best) {
        const name = nameOf.get(id);
        if (name === undefined || name === origin) continue;
        const cur = byName.get(name);
        if (cur === undefined || v.km < cur.km) byName.set(name, v);
      }

      for (const [destination, v] of byName) {
        let extra = 0;
        for (const s of list) {
          extra += surchargeAmount(s, v.surcharged.get(s.id) ?? 0);
        }
        if (extra === 0) continue;
        surchargedPairs++;
        const key = [origin, destination].sort().join("\u0000");
        if (pairs.has(key)) continue;
        pairs.set(key, {
          from: origin,
          to: destination,
          fare: tableOnly.estimate(operator, v.km) + extra,
        });
      }
    }

    process.stdout.write(
      `${operator}: 加算のかかるペア ${pairs.size}（有向 ${surchargedPairs}）\n`,
    );
    for (const s of list) {
      const lines = s.lines.join("・");
      process.stdout.write(`  ${s.id}: ${lines}\n`);
    }

    if (!write) continue;
    const id = `${list[0]?.id.split("-")[0] ?? "surcharge"}-kasan`;
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
            url: list
              .map((s) => s.source?.url ?? "")
              .filter((u) => u !== "")
              .join(", "),
            fetchedAt: FETCHED_AT,
            note:
              `加算運賃のかかる区間の実額（距離帯の額＋加算額）。` +
              `対象は ${list.map((s) => s.lines.join("・")).join(" / ")}。` +
              `加算額の表と出典は data/fare-surcharges.json、計算は ` +
              `scripts/fare/ingest/apply-surcharges.ts --write で再生成できる。` +
              `営業キロは data/graph.json の自社線最短経路。`,
          },
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(`  書き出し: data/fare-overrides/${id}.json\n`);
  }
}

main(process.argv.includes("--write"));
