import type { FareCalculator } from "@/lib/fare/calculator";
import type { RailGraph } from "@/lib/graph/types";
import { MinHeap } from "@/lib/search/heap";

export interface ReachableStation {
  id: string;
  fare: number;
}

interface SearchState {
  stationId: string;
  doneFare: number; // 確定済み区間の運賃合計
  segOperator: string; // 進行中区間の事業者（"" = 未乗車）
  segFromId: string; // 進行中区間の開始駅（特定運賃は区間全体の駅ペアに適用するため必要）
  segKm: number; // 進行中区間の距離
  fare: number; // doneFare + estimate(segOperator, segKm) を状態生成時に確定したもの
}

export function findReachable(
  graph: RailGraph,
  calc: FareCalculator,
  fromId: string,
  budget: number,
): ReachableStation[] {
  const adjacency = new Map<
    string,
    { to: string; km: number; kind: "rail" | "transfer"; operator: string }[]
  >();
  const addAdj = (
    from: string,
    to: string,
    km: number,
    kind: "rail" | "transfer",
    operator: string,
  ) => {
    const arr = adjacency.get(from) ?? [];
    arr.push({ to, km, kind, operator });
    adjacency.set(from, arr);
  };
  for (const e of graph.edges) {
    addAdj(e.from, e.to, e.km, e.kind, e.operator);
    addAdj(e.to, e.from, e.km, e.kind, e.operator);
  }

  const nameOf = (id: string): string | undefined => graph.nodes[id]?.name;

  // 枝刈りキー: 同じ駅でも「進行中区間の事業者」が違えば将来の運賃が変わりうる
  // ので区別する。さらに、進行中区間の起点駅がその事業者の override 駅ペアの
  // どちらかに登場する場合は、起点駅次第で override が引けるかどうかが変わる
  // ため segFromId も区別する。それ以外（override 対象外の事業者、または
  // override 駅ペアに登場しない起点駅）は運賃が距離のみの単調な関数なので
  // stationId+segOperator の粒度で「今の運賃が安い方」を残せば正しさを保てる。
  // JR のように事業者自体は override 対象でも路線網が広大な場合、区別対象を
  // 該当駅起点の区間だけへ絞り込むことで状態空間の爆発を防ぐ。
  const stateKey = (state: SearchState): string => {
    const base = `${state.stationId}:${state.segOperator}`;
    return calc.isOverrideAnchor(state.segOperator, nameOf(state.segFromId))
      ? `${base}:${state.segFromId}`
      : base;
  };

  const best = new Map<string, { stationId: string; fare: number }>();
  const initial: SearchState = {
    stationId: fromId,
    doneFare: 0,
    segOperator: "",
    segFromId: fromId,
    segKm: 0,
    fare: 0,
  };
  const heap = new MinHeap<SearchState>((a, b) => a.fare - b.fare);
  heap.push(initial);
  best.set(stateKey(initial), { stationId: initial.stationId, fare: 0 });

  while (heap.size > 0) {
    const state = heap.pop();
    if (state === undefined) break;
    const current = best.get(stateKey(state));
    if (current !== undefined && state.fare > current.fare) continue;

    for (const edge of adjacency.get(state.stationId) ?? []) {
      let next: SearchState;
      if (edge.kind === "transfer") {
        next = { ...state, stationId: edge.to };
      } else if (edge.operator === state.segOperator) {
        const segKm = state.segKm + edge.km;
        next = {
          stationId: edge.to,
          doneFare: state.doneFare,
          segOperator: state.segOperator,
          segFromId: state.segFromId,
          segKm,
          fare:
            state.doneFare +
            calc.estimate(
              state.segOperator,
              segKm,
              nameOf(state.segFromId),
              nameOf(edge.to),
            ),
        };
      } else {
        const doneFare =
          state.doneFare +
          calc.estimate(
            state.segOperator,
            state.segKm,
            nameOf(state.segFromId),
            nameOf(state.stationId),
          );
        next = {
          stationId: edge.to,
          doneFare,
          segOperator: edge.operator,
          segFromId: state.stationId,
          segKm: edge.km,
          fare:
            doneFare +
            calc.estimate(
              edge.operator,
              edge.km,
              nameOf(state.stationId),
              nameOf(edge.to),
            ),
        };
      }
      if (next.fare > budget) continue;
      const key = stateKey(next);
      const prev = best.get(key);
      if (prev === undefined || next.fare < prev.fare) {
        best.set(key, { stationId: next.stationId, fare: next.fare });
        heap.push(next);
      }
    }
  }

  // 同じ駅に複数の状態（由来違い）が残りうるので、駅ごとに最安値へ集約する
  const byStation = new Map<string, number>();
  for (const { stationId, fare } of best.values()) {
    if (fare < (byStation.get(stationId) ?? Infinity)) {
      byStation.set(stationId, fare);
    }
  }

  return [...byStation.entries()]
    .map(([id, fare]) => ({ id, fare }))
    .sort((a, b) => a.fare - b.fare);
}
