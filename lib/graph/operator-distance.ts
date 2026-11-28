import type { RailGraph } from "@/lib/graph/types";
import { MinHeap } from "@/lib/search/heap";

// 事業者内の駅間営業キロを駅名で引くための表を作る。
//
// 運賃データの検証（lib/fare/verify-candidate.ts）と取り込み
// （scripts/fare/ingest/）は、どちらも「この事業者のこの2駅は何キロ離れているか」を
// 大量に問い合わせる。毎回ダイクストラを回すと駅数の2乗で効くため、
// 駅名ごとに1回だけ走らせて名前→名前の表に畳んでおく。
//
// グラフには同じ駅名のノードが路線ぶんだけあるので、始点は同名ノード全部を
// 距離0で初期化し、終点も同名ノードのうち最小値を採る。
export interface OperatorKmOptions {
  // 運賃計算キロ（GraphEdge.fareKm）で合算する。運賃を引く距離で検証・生成したい
  // ときに使う。既定は営業キロで、距離そのものの検証はこちらでなければならない
  useFareKm?: boolean;
}

export function buildOperatorKmTable(
  graph: RailGraph,
  operator: string,
  options: OperatorKmOptions = {},
): (a: string, b: string) => number | null {
  const nodes = Object.values(graph.nodes).filter(
    (n) => n.operator === operator,
  );
  const inOperator = new Set(nodes.map((n) => n.id));

  const adjacency = new Map<string, { to: string; km: number }[]>();
  const link = (from: string, to: string, km: number) => {
    const list = adjacency.get(from);
    if (list === undefined) adjacency.set(from, [{ to, km }]);
    else list.push({ to, km });
  };
  for (const e of graph.edges) {
    if (!inOperator.has(e.from) || !inOperator.has(e.to)) continue;
    // 自社の駅同士でも、他社線の区間を通る経路は営業キロに含めない
    if (e.kind === "rail" && e.operator !== operator) continue;
    const km =
      e.kind === "rail"
        ? options.useFareKm === true
          ? (e.fareKm ?? e.km)
          : e.km
        : 0;
    link(e.from, e.to, km);
    link(e.to, e.from, km);
  }

  const idsByName = new Map<string, string[]>();
  for (const n of nodes) {
    const list = idsByName.get(n.name);
    if (list === undefined) idsByName.set(n.name, [n.id]);
    else list.push(n.id);
  }

  // 始点の駅名ごとの距離。問い合わせがあった駅名の分だけ求めて覚えておく。
  // JR西日本（1247ノード）は全駅名ぶん先に求めると約3秒かかり、テストが
  // 時間切れで落ちていた。検証で聞かれる始点は全駅名のごく一部
  const table = new Map<string, Map<string, number>>();
  const from = (name: string): Map<string, number> | undefined => {
    const hit = table.get(name);
    // Stryker disable next-line ConditionalExpression: 覚えた表を使わず求め直しても結果は同じ
    if (hit !== undefined) return hit;
    const starts = idsByName.get(name);
    if (starts === undefined) return undefined;
    const distance = new Map<string, number>();
    // 距離は積むときに更新し、縮んだら積み直すので、取り出し順が崩れても
    // 最後に残る距離は同じ（順は探索を速くするためのもの）
    const queue = new MinHeap<{ id: string; km: number }>(
      // Stryker disable next-line ArrowFunction,ArithmeticOperator: 取り出し順は速さにしか効かない（上の説明）
      (x, y) => x.km - y.km,
    );
    for (const id of starts) {
      distance.set(id, 0);
      queue.push({ id, km: 0 });
    }
    for (
      let current = queue.pop();
      current !== undefined;
      current = queue.pop()
    ) {
      // Stryker disable next-line ConditionalExpression,LogicalOperator: 古い候補を読み飛ばすだけ。広げ直しても結果は同じ
      if (current.km > (distance.get(current.id) ?? Infinity)) continue;
      // Stryker disable next-line ArrayDeclaration: 線路の無い駅。中身を変えても距離が NaN の候補が増えるだけで更新されない
      for (const edge of adjacency.get(current.id) ?? []) {
        const next = current.km + edge.km;
        if (next < (distance.get(edge.to) ?? Infinity)) {
          distance.set(edge.to, next);
          queue.push({ id: edge.to, km: next });
        }
      }
    }
    const byName = new Map<string, number>();
    for (const n of nodes) {
      const km = distance.get(n.id);
      if (km === undefined) continue;
      byName.set(n.name, Math.min(byName.get(n.name) ?? Infinity, km));
    }
    // Stryker disable next-line CallExpression: 覚えなくても次に求め直すだけ
    table.set(name, byName);
    return byName;
  };

  return (a, b) => from(a)?.get(b) ?? null;
}
