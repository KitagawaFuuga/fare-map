// JRの特定都区市内（旅客営業規則 第86条）と東京山手線内（第87条）の駅一覧を作る。
//
// 区域は「路線：A〜B間」の区間で定義されている（Wikipedia「特定都区市内」の表、
// 旅客営業規則の別表にもとづく）。区間の両端を、その会社の線路上の最短経路でたどり、
// 経路上の駅を区域の駅とする。出力は data/special-cities.json。
//
//   npx tsx scripts/fare/build-special-cities.ts [--write]
import { readFileSync, writeFileSync } from "node:fs";
import { matchKey } from "@/lib/graph/station-name";
import type { RailGraph } from "@/lib/graph/types";

type Section =
  | { from: string; to: string } // 区間の両端（経路上の駅をすべて含む）
  | { line: string } // 路線の全駅（graph.json の lineName）
  | { station: string }; // 個別の駅

interface CityDef {
  id: string;
  name: string;
  center: string;
  operator: string;
  /** 適用される片道営業キロ（中心駅から）の下限。この値を超えると適用（第86条は200、第87条は100） */
  minKm: number;
  /** 第87条（山手線内）は200km以下だけ */
  maxKm?: number;
  sections: Section[];
}

const CITIES: CityDef[] = [
  {
    id: "sapporo",
    name: "札幌市内",
    center: "札幌",
    operator: "JR北海道",
    minKm: 200,
    sections: [
      { from: "ほしみ", to: "森林公園" },
      { from: "上野幌", to: "白石" },
      { from: "桑園", to: "あいの里公園" },
    ],
  },
  {
    id: "sendai",
    name: "仙台市内",
    center: "仙台",
    operator: "JR東日本",
    minKm: 200,
    sections: [
      { from: "南仙台", to: "岩切" },
      { from: "あおば通", to: "中野栄" },
      { from: "仙台", to: "奥新川" },
    ],
  },
  {
    id: "tokyo",
    name: "東京都区内",
    center: "東京",
    operator: "JR東日本",
    minKm: 200,
    sections: [
      { from: "東京", to: "蒲田" },
      { from: "東京", to: "西大井" },
      { line: "JR山手線" },
      { from: "池袋", to: "赤羽" },
      { from: "神田", to: "代々木" },
      { from: "新宿", to: "西荻窪" },
      { from: "東京", to: "新小岩" },
      { from: "秋葉原", to: "小岩" },
      { from: "東京", to: "葛西臨海公園" },
      { from: "田端", to: "赤羽" },
      { from: "上野", to: "尾久" },
      { from: "尾久", to: "赤羽" },
      { from: "赤羽", to: "浮間舟渡" },
      { from: "日暮里", to: "金町" },
    ],
  },
  {
    id: "yamanote",
    name: "東京山手線内",
    center: "東京",
    operator: "JR東日本",
    minKm: 100,
    maxKm: 200,
    sections: [
      { from: "東京", to: "品川" },
      { from: "東京", to: "上野" },
      { from: "東京", to: "田端" },
      { line: "JR山手線" },
      { from: "神田", to: "代々木" },
      { from: "秋葉原", to: "御茶ノ水" },
    ],
  },
  {
    id: "yokohama",
    name: "横浜市内",
    center: "横浜",
    operator: "JR東日本",
    minKm: 200,
    sections: [
      { from: "川崎", to: "戸塚" },
      { station: "羽沢横浜国大" },
      { from: "横浜", to: "本郷台" },
      { line: "JR鶴見線" },
      { from: "川崎", to: "矢向" },
      { from: "尻手", to: "浜川崎" },
      { from: "東神奈川", to: "長津田" },
    ],
  },
  {
    id: "nagoya",
    name: "名古屋市内",
    center: "名古屋",
    operator: "JR東海",
    minKm: 200,
    sections: [
      { from: "南大高", to: "名古屋" },
      { from: "新守山", to: "名古屋" },
      { from: "名古屋", to: "春田" },
    ],
  },
  {
    id: "kyoto",
    name: "京都市内",
    center: "京都",
    operator: "JR西日本",
    minKm: 200,
    sections: [
      { from: "山科", to: "桂川" },
      { from: "京都", to: "保津峡" },
      { from: "京都", to: "桃山" },
    ],
  },
  {
    id: "osaka",
    name: "大阪市内",
    center: "大阪",
    operator: "JR西日本",
    minKm: 200,
    sections: [
      { from: "東淀川", to: "大阪" },
      { from: "大阪", to: "塚本" },
      { line: "大阪環状線" },
      { from: "西九条", to: "桜島" },
      { from: "加美", to: "JR難波" },
      { from: "天王寺", to: "杉本町" },
      { from: "放出", to: "京橋" },
      { from: "京橋", to: "加島" },
      { from: "新大阪", to: "新加美" },
    ],
  },
  {
    id: "kobe",
    name: "神戸市内",
    center: "神戸",
    operator: "JR西日本",
    minKm: 200,
    sections: [
      { from: "甲南山手", to: "神戸" },
      { from: "神戸", to: "舞子" },
      { from: "兵庫", to: "和田岬" },
    ],
  },
  {
    id: "hiroshima",
    name: "広島市内",
    center: "広島",
    operator: "JR西日本",
    minKm: 200,
    sections: [
      { from: "瀬野", to: "五日市" },
      { from: "矢野", to: "海田市" },
      { from: "横川", to: "あき亀山" },
      { from: "井原市", to: "広島" },
    ],
  },
  {
    id: "kitakyushu",
    name: "北九州市内",
    center: "小倉",
    operator: "JR九州",
    minKm: 200,
    sections: [
      { from: "門司港", to: "折尾" },
      { from: "西小倉", to: "朽網" },
      { from: "若松", to: "折尾" },
      { from: "城野", to: "呼野" },
    ],
  },
  {
    id: "fukuoka",
    name: "福岡市内",
    center: "博多",
    operator: "JR九州",
    minKm: 200,
    sections: [
      { from: "福工大前", to: "南福岡" },
      { from: "西戸崎", to: "土井" },
    ],
  },
];

const graph = JSON.parse(readFileSync("data/graph.json", "utf8")) as RailGraph;

function stationsOf(def: CityDef): string[] {
  const adj = new Map<string, [string, number][]>();
  for (const e of graph.edges) {
    if (e.kind !== "rail" || e.operator !== def.operator) continue;
    const a = graph.nodes[e.from]!.name;
    const b = graph.nodes[e.to]!.name;
    if (a === b) continue;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push([b, e.km]);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push([a, e.km]);
  }
  // 表の駅名（JR難波）をグラフの表記（ＪＲ難波）に読み替える
  const byKey = new Map([...adj.keys()].map((n) => [matchKey(n), n]));
  const resolve = (name: string) => byKey.get(matchKey(name)) ?? name;
  const path = (rawFrom: string, rawTo: string): string[] => {
    const from = resolve(rawFrom);
    const to = resolve(rawTo);
    if (!adj.has(from) || !adj.has(to))
      throw new Error(`${def.name}: ${from} か ${to} が無い`);
    const dist = new Map([[from, 0]]);
    const prev = new Map<string, string>();
    const done = new Set<string>();
    for (;;) {
      let u: string | undefined;
      let best = Infinity;
      for (const [k, d] of dist)
        if (!done.has(k) && d < best) {
          best = d;
          u = k;
        }
      if (u === undefined)
        throw new Error(`${def.name}: ${from}〜${to} がつながらない`);
      if (u === to) break;
      done.add(u);
      // 快速の「駅を飛ばす辺」を通ると間の駅を取りこぼすので、辺ごとに0.2km割り引いて
      // 駅の多い（各駅に止まる）経路を選ばせる
      for (const [v, w] of adj.get(u) ?? []) {
        const cost = Math.max(w - 0.2, 0.05);
        if (best + cost < (dist.get(v) ?? Infinity)) {
          dist.set(v, best + cost);
          prev.set(v, u);
        }
      }
    }
    const out = [to];
    while (out[0] !== from) out.unshift(prev.get(out[0]!)!);
    return out;
  };
  const set = new Set<string>();
  for (const s of def.sections) {
    if ("line" in s) {
      const names = Object.values(graph.nodes)
        .filter((n) => n.operator === def.operator && n.lineName === s.line)
        .map((n) => n.name);
      if (names.length === 0)
        throw new Error(`${def.name}: 路線 ${s.line} が無い`);
      names.forEach((n) => set.add(n));
    } else if ("station" in s) {
      const name = resolve(s.station);
      if (!adj.has(name)) throw new Error(`${def.name}: ${s.station} が無い`);
      set.add(name);
    } else {
      path(s.from, s.to).forEach((n) => set.add(n));
    }
  }
  if (!set.has(def.center))
    throw new Error(`${def.name}: 中心駅 ${def.center} が区域に無い`);
  return [...set].sort();
}

const out = CITIES.map((c) => ({
  id: c.id,
  name: c.name,
  center: c.center,
  operator: c.operator,
  minKm: c.minKm,
  ...(c.maxKm === undefined ? {} : { maxKm: c.maxKm }),
  stations: stationsOf(c),
}));
for (const c of out)
  process.stdout.write(
    `${c.name}（${c.center}）${c.stations.length}駅: ${c.stations.join("・")}\n`,
  );
if (process.argv.includes("--write")) {
  writeFileSync(
    "data/special-cities.json",
    `${JSON.stringify(
      {
        cities: out,
        source: {
          url: "https://ja.wikipedia.org/wiki/特定都区市内",
          fetchedAt: "2026-10-12",
          note: "JR旅客営業規則 第86条（特定都区市内）・第87条（東京山手線内）の区域。Wikipedia の表の「路線：A〜B間」の区間を、scripts/fare/build-special-cities.ts が各社の線路上の最短経路でたどって駅に展開したもの。新幹線の駅（新横浜・新神戸の新幹線ホームなど）はグラフに無いので含まない。",
        },
      },
      null,
      1,
    )}\n`,
  );
}
