// JR西日本「大阪附近の電車特定区間」に入る駅を集め、data/fare-zones.json を書く。
//
//   npx tsx scripts/fare/ingest/jr-west-zone.ts [--write]
//
// --write を付けなければ何も書かず、集めた駅と経路だけを表示する。
//
// 区間は正式な線路名と駅の範囲で定義されている（2025年4月1日改定。JR西日本の
// プレスリリースでは地図画像でしか示されていないため、Wikipedia「電車特定区間」の
// 適用線区の一覧を使う）。グラフの lineName は愛称・運転系統名なので、正式な
// 線路名では引けない。代わりに「両端の駅を含むグラフの路線」を探し、その路線の
// 辺だけで両端を結んで、経路上の駅を区間内とする。
//
// 路線で絞らず最短経路だけで引いてはいけない。京橋〜尼崎は JR東西線（12.5km）
// ではなく大阪経由（11.9km）が最短になり、北新地・大阪天満宮などを取りこぼす。
import { writeFileSync, readFileSync } from "node:fs";
import type { RailGraph } from "@/lib/graph/types";

const OPERATOR = "JR西日本";

// [線路名, 通る駅を順に]。途中駅を挟んでいるのは、1本のグラフ路線に両端が
// 入っていない区間を分けるため（野洲〜神戸は琵琶湖線・京都線・神戸線にまたがる）
const SECTIONS: [string, string[]][] = [
  ["東海道本線", ["野洲", "京都", "大阪", "神戸"]],
  ["湖西線", ["山科", "堅田"]],
  ["山陰本線", ["京都", "亀岡"]],
  ["奈良線", ["城陽", "京都"]],
  ["おおさか東線", ["新大阪", "久宝寺"]],
  ["桜島線", ["西九条", "桜島"]],
  ["JR東西線", ["京橋", "尼崎"]],
  ["福知山線", ["尼崎", "新三田"]],
  ["山陽本線", ["神戸", "姫路", "網干"]],
  ["関西本線", ["奈良", "ＪＲ難波"]],
  ["片町線", ["松井山手", "京橋"]],
  ["阪和線", ["天王寺", "和歌山"]],
  ["阪和線（羽衣線）", ["鳳", "東羽衣"]],
  ["関西空港線", ["日根野", "関西空港"]],
];
// 全線が区間内で、環状なので両端で表せないもの
const WHOLE_LINES = ["大阪環状線"];

function main(write: boolean): void {
  const graph = JSON.parse(
    readFileSync("data/graph.json", "utf8"),
  ) as RailGraph;
  const nodes = Object.values(graph.nodes).filter(
    (n) => n.operator === OPERATOR,
  );
  const lineOf = new Map(nodes.map((n) => [n.id, n.lineName]));
  const nameOf = new Map(nodes.map((n) => [n.id, n.name]));
  const namesByLine = new Map<string, Set<string>>();
  for (const n of nodes) {
    const set = namesByLine.get(n.lineName) ?? new Set<string>();
    set.add(n.name);
    namesByLine.set(n.lineName, set);
  }

  // 1本のグラフ路線の中だけで2駅を結び、経路上の駅名を返す
  const pathOnLine = (line: string, a: string, b: string): string[] | null => {
    const adj = new Map<string, { to: string; km: number }[]>();
    for (const e of graph.edges) {
      if (e.kind !== "rail" || e.operator !== OPERATOR) continue;
      if (lineOf.get(e.from) !== line || lineOf.get(e.to) !== line) continue;
      adj.set(e.from, [...(adj.get(e.from) ?? []), { to: e.to, km: e.km }]);
      adj.set(e.to, [...(adj.get(e.to) ?? []), { to: e.from, km: e.km }]);
    }
    const starts = nodes.filter((n) => n.lineName === line && n.name === a);
    const dist = new Map<string, number>();
    const prev = new Map<string, string>();
    const queue: [number, string][] = [];
    for (const s of starts) {
      dist.set(s.id, 0);
      queue.push([0, s.id]);
    }
    let end: string | undefined;
    while (queue.length > 0) {
      queue.sort((x, y) => x[0] - y[0]);
      const [d, u] = queue.shift()!;
      if (nameOf.get(u) === b) {
        end = u;
        break;
      }
      if (d > (dist.get(u) ?? Infinity)) continue;
      for (const { to, km } of adj.get(u) ?? []) {
        if (d + km < (dist.get(to) ?? Infinity)) {
          dist.set(to, d + km);
          prev.set(to, u);
          queue.push([d + km, to]);
        }
      }
    }
    if (end === undefined) return null;
    const names: string[] = [];
    for (let c: string | undefined = end; c !== undefined; c = prev.get(c))
      names.push(nameOf.get(c) ?? "");
    return names.reverse();
  };

  const zone = new Set<string>();
  const report: string[] = [];
  for (const [label, stops] of SECTIONS) {
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1]!;
      const b = stops[i]!;
      // 両端を含むグラフの路線をすべて試し、経路上の駅を足す
      const lines = [...namesByLine]
        .filter(([, set]) => set.has(a) && set.has(b))
        .map(([line]) => line);
      const found = lines
        .map((line) => ({ line, path: pathOnLine(line, a, b) }))
        .filter((x): x is { line: string; path: string[] } => x.path !== null);
      if (found.length === 0) {
        throw new Error(`${label} ${a}〜${b} を結ぶグラフの路線が無い`);
      }
      for (const { path } of found) for (const s of path) zone.add(s);
      report.push(
        `${label} ${a}〜${b}: ${found.map((f) => `${f.line}(${f.path.length}駅)`).join(" / ")}`,
      );
    }
  }
  for (const line of WHOLE_LINES) {
    const set = namesByLine.get(line);
    if (set === undefined) throw new Error(`${line} がグラフに無い`);
    for (const s of set) zone.add(s);
    report.push(`${line}: 全線 ${set.size}駅`);
  }

  process.stdout.write(`${report.join("\n")}\n区間内の駅 ${zone.size}\n`);
  if (!write) return;

  const zones = JSON.parse(readFileSync("data/fare-zones.json", "utf8")) as {
    zones: { id: string; stations: string[] }[];
  };
  const target = zones.zones.find((z) => z.id === "jr-west-osaka");
  if (target === undefined) throw new Error("jr-west-osaka が無い");
  target.stations = [...zone].sort((x, y) => x.localeCompare(y));
  writeFileSync("data/fare-zones.json", `${JSON.stringify(zones, null, 2)}\n`);
  process.stdout.write("data/fare-zones.json に書き出した\n");
}

main(process.argv.includes("--write"));
