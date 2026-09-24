// GTFS の fare_rules.txt を持つ鉄道事業者から、全駅ペアの実運賃を取り込む。
//
//   npx tsx scripts/fare/ingest/gtfs-fares.ts [--write] [--only=<id>] [--zip-dir=<path>]
//
// --write を付けなければ何も書かず、検証結果だけを表示する。
// --zip-dir を渡すとダウンロードの代わりにそのディレクトリの <id>.zip を読む。
//
// 対象は data/gtfs-sources.json に定義する。ライセンスは CC BY 4.0 など
// 再配布可能なものに限る（表示条件は README とアプリのフッターで満たす）。
//
// GTFS の運賃は「stops.zone_id」「fare_rules.txt の origin_id/destination_id」
// 「fare_attributes.txt の price」の3つを突き合わせて決まる。鉄道事業者の
// GTFS-JP では zone_id が駅と1対1になっているので、駅ペアの実額表として読める。
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createFareCalculator } from "@/lib/fare/calculator";
import { fareRuleSchema } from "@/lib/fare/types";
import {
  verifyFareCandidate,
  type CandidatePair,
} from "@/lib/fare/verify-candidate";
import { buildOperatorKmTable } from "@/lib/graph/operator-distance";
import type { RailGraph } from "@/lib/graph/types";
import { parseGtfsCsv } from "@/scripts/fare/ingest/csv";
import { readZipEntries } from "@/scripts/fare/ingest/zip";

interface Feed {
  id: string;
  url: string;
  license: string;
  attribution: string;
  operators: string[];
  aliases: Record<string, string>;
  note: string;
}

interface SourcePair {
  from: string;
  to: string;
  km: number | null;
  fare: number;
}

const FETCHED_AT = new Date().toISOString().slice(0, 10);

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function loadZip(
  feed: Feed,
  zipDir: string | undefined,
): Promise<Buffer> {
  if (zipDir !== undefined) return readFileSync(`${zipDir}/${feed.id}.zip`);
  const res = await fetch(feed.url);
  if (!res.ok) throw new Error(`${feed.id} の取得に失敗: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function table(
  zip: Map<string, Buffer>,
  name: string,
): Record<string, string>[] {
  // GTFS の zip はファイルを直下に置くものとサブディレクトリに置くものがある
  const key = [...zip.keys()].find((k) => k === name || k.endsWith(`/${name}`));
  if (key === undefined) return [];
  return parseGtfsCsv(zip.get(key)?.toString("utf8") ?? "");
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const only = arg("only");
  const zipDir = arg("zip-dir");
  const feeds = (
    JSON.parse(readFileSync("data/gtfs-sources.json", "utf8")) as {
      feeds: Feed[];
    }
  ).feeds.filter((f) => only === undefined || f.id === only);
  if (feeds.length === 0) throw new Error("対象のフィードがありません");

  const graph = JSON.parse(
    readFileSync("data/graph.json", "utf8"),
  ) as RailGraph;

  // 距離帯だけを積んだ計算器。既存の特定運賃を混ぜると「帯で引けるか」を判定できない
  const tableOnly = createFareCalculator(
    readdirSync("data/fare-rules")
      .filter((f) => f.endsWith(".json"))
      .map((f) =>
        fareRuleSchema.parse(
          JSON.parse(readFileSync(`data/fare-rules/${f}`, "utf8")),
        ),
      ),
  );

  const ownTableOperators = new Set(
    readdirSync("data/fare-rules")
      .filter((f) => f.endsWith(".json"))
      .flatMap(
        (f) =>
          (
            JSON.parse(readFileSync(`data/fare-rules/${f}`, "utf8")) as {
              operators: string[];
            }
          ).operators,
      ),
  );
  const hasOwnTable = (operator: string) => ownTableOperators.has(operator);

  let failed = false;
  for (const feed of feeds) {
    process.stdout.write(`\n### ${feed.id} (${feed.attribution})\n`);
    const zip = readZipEntries(await loadZip(feed, zipDir));

    const price = new Map(
      table(zip, "fare_attributes.txt").map((a) => [
        a.fare_id ?? "",
        Number(a.price),
      ]),
    );
    if (price.size === 0) {
      process.stderr.write("  fare_attributes.txt が無い。対象外にすること\n");
      failed = true;
      continue;
    }

    // zone_id → 駅名。親駅(location_type=1)は乗り場をまとめる箱なので使わない
    const zoneName = new Map<string, string>();
    for (const s of table(zip, "stops.txt")) {
      const zone = s.zone_id ?? "";
      if (zone === "" || (s.location_type ?? "0") === "1") continue;
      const raw = (s.stop_name ?? "").trim().replace(/駅$/, "");
      if (!zoneName.has(zone)) zoneName.set(zone, feed.aliases[raw] ?? raw);
    }

    // 駅名 → 事業者。1つの GTFS に運賃体系の違う路線が混ざることがある
    // （札幌市交通局は地下鉄と市電で、data/operator-splits.json で分けてある）。
    const namesByOperator = new Map(
      feed.operators.map((op) => [
        op,
        new Set(
          Object.values(graph.nodes)
            .filter((n) => n.operator === op)
            .map((n) => n.name),
        ),
      ]),
    );
    const AMBIGUOUS = "__ambiguous";
    const operatorOf = (name: string): string | null => {
      const hit = feed.operators.filter((op) =>
        namesByOperator.get(op)?.has(name),
      );
      if (hit.length === 1) return hit[0] as string;
      return hit.length === 0 ? null : AMBIGUOUS;
    };

    const kmTables = new Map(
      feed.operators.map((op) => [op, buildOperatorKmTable(graph, op)]),
    );
    const collected = new Map<string, Map<string, SourcePair>>();
    const unmapped = new Set<string>();
    const ambiguous = new Set<string>();
    let crossOperator = 0;
    let conflicts = 0;

    for (const r of table(zip, "fare_rules.txt")) {
      const from = zoneName.get(r.origin_id ?? "");
      const to = zoneName.get(r.destination_id ?? "");
      const fare = price.get(r.fare_id ?? "");
      if (from === undefined || to === undefined || from === to) continue;
      if (fare === undefined || !Number.isFinite(fare)) continue;
      const opA = operatorOf(from);
      const opB = operatorOf(to);
      for (const [name, op] of [
        [from, opA],
        [to, opB],
      ] as const) {
        if (op === null) unmapped.add(name);
        if (op === AMBIGUOUS) ambiguous.add(name);
      }
      if (opA === null || opB === null) continue;
      if (opA === AMBIGUOUS || opB === AMBIGUOUS) continue;
      // 体系が違う路線をまたぐ運賃は、こちらは区間を分けて課金するので使わない
      if (opA !== opB) {
        crossOperator++;
        continue;
      }
      const bucket = collected.get(opA) ?? new Map<string, SourcePair>();
      const key = [from, to].sort().join("\u0000");
      const existing = bucket.get(key);
      if (existing !== undefined) {
        if (existing.fare !== fare) conflicts++;
        continue;
      }
      // 300m以内の駅に張られる距離0の乗換エッジのせいで別駅でも0kmになることがある。
      // 実距離ではないので距離不明として扱う（詳細は odpt-toei.ts の同じ箇所）
      const km = kmTables.get(opA)?.(from, to) ?? null;
      bucket.set(key, {
        from,
        to,
        km: km !== null && km > 0 ? km : null,
        fare,
      });
      collected.set(opA, bucket);
    }

    if (unmapped.size > 0)
      process.stdout.write(
        `  グラフに無い駅名 ${unmapped.size}: ${[...unmapped].slice(0, 8).join(", ")}\n` +
          "    表記ゆれなら data/gtfs-sources.json の aliases に足すこと\n",
      );
    if (ambiguous.size > 0)
      process.stdout.write(
        `  事業者を特定できない駅名 ${ambiguous.size}: ${[...ambiguous].slice(0, 8).join(", ")}\n`,
      );
    if (crossOperator > 0)
      process.stdout.write(`  体系をまたぐ運賃 ${crossOperator} 件を除外\n`);
    if (conflicts > 0) {
      process.stderr.write(`  往復で額が食い違うペア ${conflicts} 件\n`);
      failed = true;
      continue;
    }

    for (const operator of feed.operators) {
      const pairs = [...(collected.get(operator)?.values() ?? [])];
      const id =
        feed.operators.length === 1
          ? feed.id
          : `${feed.id}-${feed.operators.indexOf(operator) + 1}`;
      process.stdout.write(`  == ${operator}: ${pairs.length} ペア ==\n`);
      if (pairs.length === 0) {
        process.stderr.write("     ペアが0件\n");
        failed = true;
        continue;
      }
      const kmBetween = kmTables.get(operator);
      if (kmBetween === undefined) continue;
      const candidate: CandidatePair[] = pairs.map((p) => ({
        from: p.from,
        to: p.to,
        fare: p.fare,
      }));
      const findings = verifyFareCandidate(
        { operator, pairs: candidate },
        { kmBetween },
      );
      if (findings.length === 0) process.stdout.write("     検証: 所見なし\n");
      for (const f of findings) {
        process.stdout.write(`     [${f.severity}] ${f.check}: ${f.message}\n`);
        for (const s of f.samples) process.stdout.write(`         ${s}\n`);
        if (f.severity === "error") failed = true;
      }
      if (!write) continue;

      const url = `${feed.url} （一覧: https://github.com/tshimada291/gtfs-jp-list）`;
      const note =
        `${feed.attribution} が公開する GTFS の fare_rules.txt / fare_attributes.txt から起こした実額。` +
        `${feed.note} ライセンスは ${feed.license}。` +
        "GTFS は origin_id/destination_id で駅を明示するため、運賃表PDFのような行ズレは起こりえない" +
        "（距離単調性が無力という警告が出ても、それは検査が効かないという意味であって誤りの兆候ではない）。" +
        `営業キロは data/graph.json の自社線最短経路（実測ではなく補正済みの推定値）。` +
        `再生成は npx tsx scripts/fare/ingest/gtfs-fares.ts --only=${feed.id} --write`;
      writeFileSync(
        `data/fare-sources/${id}.json`,
        `${JSON.stringify(
          {
            id,
            operator,
            source: { url, fetchedAt: FETCHED_AT, note },
            pairs: pairs.sort((a, b) =>
              a.from === b.from
                ? a.to.localeCompare(b.to)
                : a.from.localeCompare(b.from),
            ),
          },
          null,
          2,
        )}\n`,
      );
      // 事業者専用の距離帯が無い相手は、全ペアを特定運賃で持つ。全国共通の
      // フォールバック表とたまたま一致したペアを距離表任せにすると、その表を
      // 直したときに黙って運賃が変わってしまう。
      const overridePairs = pairs
        .filter(
          (p) =>
            !hasOwnTable(operator) ||
            tableOnly.estimate(operator, p.km ?? 0.1) !== p.fare,
        )
        .map((p) => ({ from: p.from, to: p.to, fare: p.fare }));
      process.stdout.write(
        `     書き出し: data/fare-sources/${id}.json / 特定運賃 ${overridePairs.length}\n`,
      );
      if (overridePairs.length === 0) continue;
      writeFileSync(
        `data/fare-overrides/${id}.json`,
        `${JSON.stringify(
          {
            operator,
            pairs: overridePairs,
            source: {
              url,
              fetchedAt: FETCHED_AT,
              note:
                `data/fare-rules/ の距離帯では引けないペア（${overridePairs.length}/${pairs.length}）。` +
                `${note} data/fare-sources/${id}.json と合わせて ` +
                `lib/fare/__tests__/fare-sources.test.ts が全ペア一致を検証する。`,
            },
          },
          null,
          2,
        )}\n`,
      );
    }
  }

  if (failed) {
    process.stderr.write("\n検証でエラーが出たため採用しない\n");
    process.exitCode = 1;
  }
}

mkdirSync("data/fare-sources", { recursive: true });
void main();
