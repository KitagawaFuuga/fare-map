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

  const totalFare = (s: SearchState): number => s.doneFare + calc.estimate(s.segOperator, s.segKm);
  const best = new Map<string, number>();
  const heap = new MinHeap<SearchState>((a, b) => totalFare(a) - totalFare(b));
  heap.push({ stationId: fromId, doneFare: 0, segOperator: "", segKm: 0 });
  best.set(fromId, 0);

  while (heap.size > 0) {
    const state = heap.pop();
    if (state === undefined) break;
    const fare = totalFare(state);
    if (fare > (best.get(state.stationId) ?? Infinity)) continue;

    for (const edge of adjacency.get(state.stationId) ?? []) {
      let next: SearchState;
      if (edge.kind === "transfer") {
        next = { ...state, stationId: edge.to };
      } else if (edge.operator === state.segOperator) {
        next = { ...state, stationId: edge.to, segKm: state.segKm + edge.km };
      } else {
        next = {
          stationId: edge.to,
          doneFare: state.doneFare + calc.estimate(state.segOperator, state.segKm),
          segOperator: edge.operator,
          segKm: edge.km,
        };
      }
      const nextFare = totalFare(next);
      if (nextFare > budget) continue;
      if (nextFare < (best.get(next.stationId) ?? Infinity)) {
        best.set(next.stationId, nextFare);
        heap.push(next);
      }
    }
  }

  return [...best.entries()]
    .map(([id, fare]) => ({ id, fare }))
    .sort((a, b) => a.fare - b.fare);
}
