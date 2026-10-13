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
  // 駅名を指定すると、その路線のうちこの駅だけを分ける。他社の線路を含めて1路線に
  // 登録されている直通線用（相鉄・JR直通線は新宿〜武蔵小杉〜羽沢横浜国大がJRの線路）。
  // 事業者がまたがる駅間には線路を張らない（どちらの運賃で計算するか決まらないため）
  stations?: string[];
}

// 元データ(join.csv)に無い駅間接続を補う定義。ekidata は「他社の線路に乗り入れる区間」を
// 駅としては登録するが駅間接続は登録しない流儀で、そのままだと乗り入れ先の駅が線路を
// 1本も持たない孤立点になる（実例: しなの鉄道線の篠ノ井〜長野。station.csv には23駅
// あるのに join.csv は篠ノ井までの18接続しかない）。孤立すると探索がその区間を
// 通れず、事業者をまたぐ通し運賃が引けなくなるため、ここで接続を補う。
export interface ExtraJoin {
  lineId: string; // 接続を足す路線。両駅がこの路線に属していることを検証する
  from: string; // station_cd
  to: string;
}

// 元データ(station.csv)から消えた駅を補う。駅データ.jp の2026年版では、しなの鉄道線
// （99403）からJR線に乗り入れる篠ノ井〜長野の4駅が消えた。消えたままだと、しなの鉄道の
// 通し運賃（上田→長野など）が引けず、しなの鉄道とJRの運賃を足した額になる。
// 同じ駅コードが元データにあれば例外にする。元データが直ったら定義を消すため
// （extra-joins の「join.csv に既に存在します」と同じ方針）。
export function mergeExtraStations(
  stations: Record<string, string>[],
  extra: Record<string, string>[],
): Record<string, string>[] {
  const existing = new Set(stations.map((s) => s.station_cd ?? ""));
  for (const s of extra) {
    if (existing.has(s.station_cd ?? "")) {
      throw new Error(
        `extra-stations: ${s.station_cd}(${s.station_name}) は station.csv に既に存在します。` +
          `元データが更新された可能性があるため data/extra-stations.json から削除してください`,
      );
    }
  }
  return [...stations, ...extra];
}

export interface StationCorrections {
  renames: { station_cd: string; from: string; to: string }[];
  closures: { station_cd: string; name: string }[];
}

export function applyStationCorrections(
  stations: Record<string, string>[],
  corrections: StationCorrections,
): Record<string, string>[] {
  const renameByCd = new Map(corrections.renames.map((r) => [r.station_cd, r]));
  // 元データの名前が旧名と合わないなら、元データが改称に追いついたか駅コードが
  // 振り直された。黙って上書きすると別の駅の名前を変えかねないので止める
  for (const r of corrections.renames) {
    const s = stations.find((x) => x.station_cd === r.station_cd);
    if (s?.station_name !== r.from) {
      throw new Error(
        `station-corrections: ${r.station_cd} は「${r.from}」のはずが「${s?.station_name ?? "（無し）"}」です。` +
          `元データが更新された可能性があるため data/station-corrections.json を確認してください`,
      );
    }
  }
  for (const c of corrections.closures) {
    const s = stations.find((x) => x.station_cd === c.station_cd);
    if (s?.station_name !== c.name) {
      throw new Error(
        `station-corrections: 廃止駅 ${c.station_cd}（${c.name}）が元データに見当たりません。` +
          `元データが廃止を反映した可能性があるため data/station-corrections.json を確認してください`,
      );
    }
  }
  const closed = new Set(corrections.closures.map((c) => c.station_cd));
  return stations
    .filter((s) => !closed.has(s.station_cd ?? ""))
    .map((s) => {
      const rename = renameByCd.get(s.station_cd ?? "");
      return rename ? { ...s, station_name: rename.to } : s;
    });
}

// 別駅扱いでも徒歩で乗り換えられるとみなす距離。大きくすると無関係な駅どうしが
// 繋がり運賃が不当に安くなるため、実際に乗換案内が案内する範囲に寄せた値。
const TRANSFER_RADIUS_KM = 0.3;

export function buildGraph(
  input: EkidataInput,
  splits: OperatorSplit[] = [],
  extraJoins: ExtraJoin[] = [],
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
  const splitStationsSeen = new Set<string>();
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
      matched.add(lineId);
      if (
        split.stations === undefined ||
        split.stations.includes(s.station_name ?? "")
      ) {
        operator = split.to;
        splitStationsSeen.add(`${lineId}\u0000${s.station_name ?? ""}`);
      }
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

  for (const split of splits) {
    const missing = (split.stations ?? []).filter(
      (name) => !splitStationsSeen.has(`${split.lineId}\u0000${name}`),
    );
    if (missing.length > 0) {
      throw new Error(
        `operator-splits: lineId=${split.lineId} の路線に無い駅が指定されています ` +
          `(${missing.join(", ")})。data/operator-splits.json を確認してください`,
      );
    }
  }

  const edges: GraphEdge[] = [];
  const joined = new Set<string>();
  const joinKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (const j of input.joins) {
    const a = nodes[j.station_cd1 ?? ""];
    const b = nodes[j.station_cd2 ?? ""];
    if (!a || !b) continue;
    // 駅を指定した分割で事業者がまたがった駅間。どちらの運賃で計算するか決まらない
    if (a.operator !== b.operator) continue;
    joined.add(joinKey(a.id, b.id));
    edges.push({
      from: a.id,
      to: b.id,
      km: haversineKm(a, b),
      kind: "rail",
      operator: a.operator,
    });
  }

  // 補った接続。駅IDが実在しない・指定した路線に属していない・既に元データに
  // 存在する、のいずれも「定義が現実と合っていない」ので例外にする。黙って
  // 無視すると運賃が静かに間違うため（operator-splits と同じ方針）。
  for (const j of extraJoins) {
    const a = nodes[j.from];
    const b = nodes[j.to];
    const where = `extra-joins: lineId=${j.lineId} ${j.from}-${j.to}`;
    if (!a || !b) {
      throw new Error(
        `${where} の駅が station.csv に存在しません。` +
          `station_cd が振り直された可能性があるため data/extra-joins.json を確認してください`,
      );
    }
    if (a.lineId !== j.lineId || b.lineId !== j.lineId) {
      throw new Error(
        `${where} の駅が指定の路線に属していません ` +
          `(${a.name}=${a.lineId} / ${b.name}=${b.lineId})`,
      );
    }
    if (joined.has(joinKey(a.id, b.id))) {
      throw new Error(
        `${where} は join.csv に既に存在します。` +
          `元データが更新された可能性があるため data/extra-joins.json から削除してください`,
      );
    }
    joined.add(joinKey(a.id, b.id));
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
