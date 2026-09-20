import { haversineKm } from "@/lib/geo";
import type { GraphEdge, RailGraph, StationNode } from "@/lib/graph/types";

export interface EkidataInput {
  companies: Record<string, string>[];
  lines: Record<string, string>[];
  stations: Record<string, string>[];
  joins: Record<string, string>[];
}

// 1事業者が運賃体系の異なる路線群を持つ場合に、グラフ生成時点で事業者名を分ける定義。
// 運賃表は事業者単位で引かれ、探索も事業者が変わったところで区間を確定するため、
// ここで分けないと「均一運賃の市電と対キロ制の地下鉄」が1区間として通算されてしまう。
export interface OperatorSplit {
  lineId: string;
  from: string; // 分割前の事業者名。実データと食い違えば例外にするための検証用
  to: string;
}

// 別駅扱いでも徒歩で乗り換えられるとみなす距離。大きくすると無関係な駅どうしが
// 繋がり運賃が不当に安くなるため、実際に乗換案内が案内する範囲に寄せた値。
const TRANSFER_RADIUS_KM = 0.3;

export function buildGraph(
  input: EkidataInput,
  splits: OperatorSplit[] = [],
): RailGraph {
  const splitByLine = new Map(splits.map((s) => [s.lineId, s]));
  // 定義された lineId が実在し、期待どおりの事業者に属しているかを記録する。
  // lineId は station.csv 由来の内部IDで再生成時に振り直されうるため、
  // 黙って分割が効かなくなる（＝運賃が静かに間違う）事態を防ぐ。
  const matched = new Set<string>();

  const companyName = new Map(
    input.companies.map((c) => [c.company_cd ?? "", c.company_name ?? ""]),
  );
  const lineInfo = new Map(
    input.lines.map((l) => [
      l.line_cd ?? "",
      {
        name: l.line_name ?? "",
        operator: companyName.get(l.company_cd ?? "") ?? "",
      },
    ]),
  );

  const nodes: Record<string, StationNode> = {};
  for (const s of input.stations) {
    const line = lineInfo.get(s.line_cd ?? "");
    if (!line || !s.station_cd) continue;
    // 空文字は Number("") = 0（null island）に、キー欠落は Number(undefined) = NaN になる。
    // どちらも座標欠損であり距離計算に使えないため、生値の段階で弾いてからノードに入れる。
    if (!s.lat || !s.lon) continue;
    const lat = Number(s.lat);
    const lng = Number(s.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const lineId = s.line_cd ?? "";
    const split = splitByLine.get(lineId);
    let operator = line.operator;
    if (split !== undefined) {
      if (split.from !== line.operator) {
        throw new Error(
          `operator-splits: lineId=${lineId} の事業者が想定と違います ` +
            `(定義: "${split.from}" / 実データ: "${line.operator}")。` +
            `lineId が振り直された可能性があるため data/operator-splits.json を確認してください`,
        );
      }
      operator = split.to;
      matched.add(lineId);
    }
    nodes[s.station_cd] = {
      id: s.station_cd,
      groupId: s.station_g_cd ?? s.station_cd,
      name: s.station_name ?? "",
      lat,
      lng,
      lineId,
      lineName: line.name,
      operator,
    };
  }

  const unmatched = splits.filter((s) => !matched.has(s.lineId));
  if (unmatched.length > 0) {
    throw new Error(
      `operator-splits: 実データに存在しない lineId があります ` +
        `(${unmatched.map((s) => `${s.lineId}→${s.to}`).join(", ")})。` +
        `lineId が振り直された可能性があるため data/operator-splits.json を確認してください`,
    );
  }

  const edges: GraphEdge[] = [];
  for (const j of input.joins) {
    const a = nodes[j.station_cd1 ?? ""];
    const b = nodes[j.station_cd2 ?? ""];
    if (!a || !b) continue;
    edges.push({
      from: a.id,
      to: b.id,
      km: haversineKm(a, b),
      kind: "rail",
      operator: a.operator,
    });
  }

  edges.push(...buildTransferEdges(Object.values(nodes)));
  return { nodes, edges };
}

// 乗換エッジ（距離0・事業者なし）を張る。(a) 同一 groupId の全組と、
// (b) groupId は違うが徒歩圏内にある駅どうし の2系統。
function buildTransferEdges(stations: StationNode[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const add = (a: StationNode, b: StationNode) => {
    const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
    if (seen.has(key) || a.id === b.id) return;
    seen.add(key);
    edges.push({ from: a.id, to: b.id, km: 0, kind: "transfer", operator: "" });
  };

  // (a) 同一グループ
  const byGroup = new Map<string, StationNode[]>();
  for (const s of stations) {
    const arr = byGroup.get(s.groupId) ?? [];
    arr.push(s);
    byGroup.set(s.groupId, arr);
  }
  for (const group of byGroup.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a && b) add(a, b);
      }
    }
  }

  // (b) 近接駅。全駅の総当たりは約1万件の2乗で現実的でないため、緯度経度を
  // 0.01度（約1km）刻みのセルに割り、自セルと周囲8セルだけを比較する。
  // TRANSFER_RADIUS_KM(0.3km) はセル幅より小さいので、この範囲で取りこぼさない。
  const cell = (s: StationNode) =>
    `${Math.round(s.lat * 100)}:${Math.round(s.lng * 100)}`;
  const grid = new Map<string, StationNode[]>();
  for (const s of stations) {
    const k = cell(s);
    const arr = grid.get(k) ?? [];
    arr.push(s);
    grid.set(k, arr);
  }
  for (const s of stations) {
    const clat = Math.round(s.lat * 100);
    const clng = Math.round(s.lng * 100);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const t of grid.get(`${clat + dy}:${clng + dx}`) ?? []) {
          if (t.id > s.id && haversineKm(s, t) <= TRANSFER_RADIUS_KM) add(s, t);
        }
      }
    }
  }
  return edges;
}
