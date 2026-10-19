// 東京都交通局の全駅ペア運賃を ODPT から取り込む。
//
//   npx tsx scripts/fare/ingest/odpt-toei.ts [--write]
//
// --write を付けなければ何も書かず、検証結果と差分だけを表示する。
//
// 出所: 公共交通オープンデータセンター（api-public.odpt.org）。このエンドポイントは
// CC BY 4.0 のデータセットだけを配信しており、アクセストークン無しで引ける。
// ODPT の「基本ライセンス」データ（他事業者ぶん）は再配布が禁止されているので、
// ここで扱ってよいのは都営だけである（詳細は README の出典節）。
//
// 都営は1つの事業者名の下に運賃体系が3つある（地下鉄4線=対キロ区間制、
// 都電荒川線=均一170円、日暮里・舎人ライナー=独自の対キロ）。data/operator-splits.json
// で事業者を分けてあるので、ここでも ODPT の路線IDを見て3群に振り分ける。
import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { createFareCalculator } from "@/lib/fare/calculator";
import { fareRuleSchema } from "@/lib/fare/types";
import {
  verifyFareCandidate,
  type CandidatePair,
} from "@/lib/fare/verify-candidate";
import { buildOperatorKmTable } from "@/lib/graph/operator-distance";
import type { RailGraph } from "@/lib/graph/types";

const ENDPOINT = "https://api-public.odpt.org/api/v4";
const OPERATOR = "odpt.Operator:Toei";
const FETCHED_AT = new Date().toISOString().slice(0, 10);

interface OdptStation {
  "dc:title": string;
  "owl:sameAs": string;
  "odpt:railway": string;
}
interface OdptFare {
  "odpt:fromStation": string;
  "odpt:toStation": string;
  "odpt:ticketFare"?: number;
}

// ODPT とグラフ（駅データ.jp 由来）で表記が違う駅。増えたらここに足す。
// 対応を取り違えると運賃が別の駅に付くので、突き合わせで余った駅名は必ず報告する。
const NAME_ALIASES: Record<string, string> = {
  押上: "押上（スカイツリー前）",
};

interface Group {
  id: string;
  operator: string;
  railways: string[];
  note: string;
}

const GROUPS: Group[] = [
  {
    id: "toei-subway",
    operator: "東京都交通局",
    railways: ["Toei.Asakusa", "Toei.Mita", "Toei.Shinjuku", "Toei.Oedo"],
    note: "都営地下鉄4線（浅草線・三田線・新宿線・大江戸線）。対キロ区間制。",
  },
  {
    id: "toei-toden",
    operator: "東京都交通局(都電)",
    railways: ["Toei.Arakawa"],
    note: "都電荒川線（東京さくらトラム）。全線均一170円。",
  },
  {
    id: "toei-toneri",
    operator: "東京都交通局(日暮里・舎人ライナー)",
    railways: ["Toei.NipporiToneri"],
    note: "日暮里・舎人ライナー。地下鉄とは別の対キロ運賃。",
  },
];

async function get<T>(query: string): Promise<T[]> {
  const res = await fetch(`${ENDPOINT}/${query}`);
  if (!res.ok) throw new Error(`${query} の取得に失敗: HTTP ${res.status}`);
  return (await res.json()) as T[];
}

// 1リクエストあたり1000件で頭打ちになる（都営の運賃は12,000件超あるので
// 事業者で引くと静かに欠ける）。発駅で絞ると全件返るため、駅ごとに引いて繋ぐ。
async function fetchAllFares(stationIds: string[]): Promise<OdptFare[]> {
  const out: OdptFare[] = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < stationIds.length; i += CONCURRENCY) {
    const chunk = stationIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map((id) =>
        get<OdptFare>(
          `odpt:RailwayFare?odpt:operator=${OPERATOR}&odpt:fromStation=${id}`,
        ),
      ),
    );
    for (const r of results) out.push(...r);
    process.stdout.write(
      `\r運賃を取得中 ${Math.min(i + CONCURRENCY, stationIds.length)}/${stationIds.length} 駅`,
    );
  }
  process.stdout.write("\n");
  return out;
}

interface SourcePair {
  from: string;
  to: string;
  km: number | null;
  fare: number;
}

function main(write: boolean): Promise<void> {
  return (async () => {
    const stations = await get<OdptStation>(
      `odpt:Station?odpt:operator=${OPERATOR}`,
    );
    const fares = await fetchAllFares(stations.map((s) => s["owl:sameAs"]));
    process.stdout.write(
      `ODPT: 駅 ${stations.length} / 運賃 ${fares.length} 件\n`,
    );

    const graph = JSON.parse(
      readFileSync("data/graph.json", "utf8"),
    ) as RailGraph;

    // 距離帯だけを積んだ計算器。既存の特定運賃を混ぜると「帯で引けるか」を
    // 判定できなくなるので overrides は渡さない。
    const tableOnly = createFareCalculator(
      readdirSync("data/fare-rules")
        .filter((f) => f.endsWith(".json"))
        .map((f) =>
          fareRuleSchema.parse(
            JSON.parse(readFileSync(`data/fare-rules/${f}`, "utf8")),
          ),
        ),
    );

    const nameById = new Map<string, string>();
    const railwayById = new Map<string, string>();
    for (const s of stations) {
      const title = s["dc:title"];
      nameById.set(s["owl:sameAs"], NAME_ALIASES[title] ?? title);
      railwayById.set(s["owl:sameAs"], s["odpt:railway"]);
    }

    const groupOf = new Map<string, Group>();
    for (const g of GROUPS) {
      for (const r of g.railways) groupOf.set(`odpt.Railway:${r}`, g);
    }

    // 同じ駅ペアが往復2件で来るので、無向のペアに畳んでから扱う
    const collected = new Map<string, Map<string, SourcePair>>();
    const unknownRailway = new Set<string>();
    const crossGroup: string[] = [];
    const conflicts: string[] = [];
    const kmTables = new Map<string, (a: string, b: string) => number | null>();
    for (const g of GROUPS) {
      kmTables.set(g.operator, buildOperatorKmTable(graph, g.operator));
    }

    for (const f of fares) {
      const fare = f["odpt:ticketFare"];
      if (fare === undefined) continue;
      const fromId = f["odpt:fromStation"];
      const toId = f["odpt:toStation"];
      const ga = groupOf.get(railwayById.get(fromId) ?? "");
      const gb = groupOf.get(railwayById.get(toId) ?? "");
      if (ga === undefined || gb === undefined) {
        unknownRailway.add(railwayById.get(fromId) ?? fromId);
        continue;
      }
      // 都営は群をまたぐ通し運賃を持たない（乗り継ぐと双方の運賃がかかる）
      if (ga !== gb) {
        crossGroup.push(`${fromId}→${toId}`);
        continue;
      }
      const from = nameById.get(fromId);
      const to = nameById.get(toId);
      if (from === undefined || to === undefined || from === to) continue;

      const bucket = collected.get(ga.id) ?? new Map<string, SourcePair>();
      const key = [from, to].sort().join("\u0000");
      const existing = bucket.get(key);
      if (existing !== undefined) {
        // 往復で額が違えば、どちらかの駅対応が間違っている
        if (existing.fare !== fare)
          conflicts.push(`${from}–${to}: ${existing.fare} / ${fare}`);
        continue;
      }
      // 300m以内の駅同士にはグラフが距離0の乗換エッジを張るため（lib/graph/build.ts の
      // TRANSFER_RADIUS_KM）、停留所間隔の短い都電では別駅なのに0kmになる組が出る。
      // 実距離ではないので距離不明として扱い、距離帯ではなく初乗り側で解決させる。
      const km = kmTables.get(ga.operator)?.(from, to) ?? null;
      bucket.set(key, {
        from,
        to,
        km: km !== null && km > 0 ? km : null,
        fare,
      });
      collected.set(ga.id, bucket);
    }

    if (unknownRailway.size > 0)
      process.stdout.write(
        `未知の路線: ${[...unknownRailway].join(", ")}（GROUPS に足すこと）\n`,
      );
    if (crossGroup.length > 0)
      process.stdout.write(
        `群をまたぐ運賃 ${crossGroup.length} 件を無視した（例: ${crossGroup[0]}）\n`,
      );
    if (conflicts.length > 0) {
      process.stderr.write(
        `往復で額が食い違うペアがある:\n  ${conflicts.slice(0, 5).join("\n  ")}\n`,
      );
      process.exitCode = 1;
      return;
    }

    let failed = false;
    for (const g of GROUPS) {
      const pairs = [...(collected.get(g.id)?.values() ?? [])];
      process.stdout.write(`\n== ${g.operator}: ${pairs.length} ペア ==\n`);
      if (pairs.length === 0) {
        process.stderr.write("  ペアが0件。路線IDの指定を確認すること\n");
        failed = true;
        continue;
      }

      const kmBetween = kmTables.get(g.operator);
      if (kmBetween === undefined) continue;
      const candidate: CandidatePair[] = pairs.map((p) => ({
        from: p.from,
        to: p.to,
        fare: p.fare,
      }));
      const findings = verifyFareCandidate(
        { operator: g.operator, pairs: candidate },
        { kmBetween },
      );
      if (findings.length === 0) process.stdout.write("  検証: 所見なし\n");
      for (const f of findings) {
        process.stdout.write(`  [${f.severity}] ${f.check}: ${f.message}\n`);
        for (const s of f.samples) process.stdout.write(`      ${s}\n`);
        if (f.severity === "error") failed = true;
      }

      const noKm = pairs.filter((p) => p.km === null).length;
      if (noKm > 0) process.stdout.write(`  距離が取れないペア: ${noKm}\n`);

      if (!write) continue;
      const out = {
        id: g.id,
        operator: g.operator,
        source: {
          url: `${ENDPOINT}/odpt:RailwayFare?odpt:operator=${OPERATOR}`,
          fetchedAt: FETCHED_AT,
          note:
            `公共交通オープンデータセンター（ODPT）の odpt:RailwayFare より取得した全ペアの実運賃。` +
            `${g.note} 営業キロは data/graph.json の自社線最短経路（実測ではなく補正済みの推定値）。` +
            `駅名は ODPT の dc:title を駅データ.jp の表記に寄せてある（別名は scripts/fare/ingest/odpt-toei.ts の NAME_ALIASES）。` +
            `ライセンスは CC BY 4.0。再生成は npx tsx scripts/fare/ingest/odpt-toei.ts --write`,
        },
        pairs: pairs.sort((a, b) =>
          a.from === b.from
            ? a.to.localeCompare(b.to)
            : a.from.localeCompare(b.from),
        ),
      };
      const sourcePath = `data/fare-sources/${g.id}.json`;
      writeFileSync(sourcePath, `${JSON.stringify(out, null, 2)}\n`);
      process.stdout.write(`  書き出し: ${sourcePath}\n`);

      // 距離帯で引いた額が実額と食い違うペアを特定運賃に回す。
      // 都営の距離帯は公式の区分そのものなので、食い違いの主因はこちらの
      // 営業キロの誤差（data/graph.json は座標由来の推定を実営業キロで補正した値）で、
      // 帯の境界をまたぐ側にずれたペアだけがここに落ちる。
      const overridePairs = pairs
        .filter((p) => tableOnly.estimate(g.operator, p.km ?? 0.1) !== p.fare)
        .map((p) => ({ from: p.from, to: p.to, fare: p.fare }));
      if (overridePairs.length === 0) {
        process.stdout.write("  特定運賃: 不要\n");
        continue;
      }
      const overridePath = `data/fare-overrides/${g.id}.json`;
      const override = {
        operator: g.operator,
        pairs: overridePairs,
        source: {
          url: out.source.url,
          fetchedAt: FETCHED_AT,
          note:
            `data/fare-rules/ の距離帯では引けないペア（${overridePairs.length}/${pairs.length}）。` +
            `都営の距離帯は公式の区分そのものなので、これは運賃側ではなく ` +
            `data/graph.json の営業キロ（座標から推定し実営業キロで補正した値）の誤差で ` +
            `帯の境界をまたいだぶんである。実額は ODPT の odpt:RailwayFare。` +
            `data/fare-sources/${g.id}.json と合わせて lib/fare/__tests__/fare-sources.test.ts が全ペア一致を検証する。`,
        },
      };
      writeFileSync(overridePath, `${JSON.stringify(override, null, 2)}\n`);
      process.stdout.write(
        `  書き出し: ${overridePath} (${overridePairs.length} ペア)\n`,
      );
    }

    if (failed) {
      process.stderr.write(
        "\n検証でエラーが出たため採用しない。駅名の対応か路線の分け方を疑うこと\n",
      );
      process.exitCode = 1;
    }
  })();
}

void main(process.argv.includes("--write"));
