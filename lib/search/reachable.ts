import type { FareCalculator } from "@/lib/fare/calculator";
import type { RailGraph } from "@/lib/graph/types";
import { MinHeap } from "@/lib/search/heap";

export interface ReachableStation {
  id: string;
  fare: number;
}

interface SearchState {
  stationId: string;
  doneFare: number;    // 確定済み区間の運賃合計
  segOperator: string; // 進行中区間の事業者（"" = 未乗車）
  segKm: number;       // 進行中区間の距離
  fare: number;         // doneFare + estimate(segOperator, segKm) を状態生成時に確定したもの
}

export function findReachable(
  graph: RailGraph,
  calc: FareCalculator,
  fromId: string,
  budget: number,
): ReachableStation[] {
  const adjacency = new Map<string, { to: string; km: number; kind: "rail" | "transfer"; operator: string }[]>();
  const addAdj = (from: string, to: string, km: number, kind: "rail" | "transfer", operator: string) => {
    const arr = adjacency.get(from) ?? [];
    arr.push({ to, km, kind, operator });
    adjacency.set(from, arr);
  };
  for (const e of graph.edges) {
    addAdj(e.from, e.to, e.km, e.kind, e.operator);
    addAdj(e.to, e.from, e.km, e.kind, e.operator);
  }

  const best = new Map<string, number>();
  const heap = new MinHeap<SearchState>((a, b) => a.fare - b.fare);
  heap.push({ stationId: fromId, doneFare: 0, segOperator: "", segKm: 0, fare: 0 });
  best.set(fromId, 0);

  while (heap.size > 0) {
    const state = heap.pop();
    if (state === undefined) break;
    if (state.fare > (best.get(state.stationId) ?? Infinity)) continue;

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
          segKm,
          fare: state.doneFare + calc.estimate(state.segOperator, segKm),
        };
      } else {
        const doneFare = state.doneFare + calc.estimate(state.segOperator, state.segKm);
        next = {
          stationId: edge.to,
          doneFare,
          segOperator: edge.operator,
          segKm: edge.km,
          fare: doneFare + calc.estimate(edge.operator, edge.km),
        };
      }
      if (next.fare > budget) continue;
      if (next.fare < (best.get(next.stationId) ?? Infinity)) {
        best.set(next.stationId, next.fare);
        heap.push(next);
      }
    }
  }

  return [...best.entries()]
    .map(([id, fare]) => ({ id, fare }))
    .sort((a, b) => a.fare - b.fare);
}
