// 実額の全ペア（data/fare-sources）から特定運賃（data/fare-overrides）を作り直す。
//
//   npx tsx scripts/fare/derive-overrides.ts [--write] [--id=toei-subway]
//
// --write を付けなければ何も書かず、差だけを表示する。
//
// なぜ全ペア持つか: 以前は「距離帯表で引ける額と食い違うペアだけ」を特定運賃にして
// いた。これは生成時のグラフ距離に依存するので、距離データを入れ替えると覆いが外れて
// 運賃が黙って変わる（2026-09-25に実営業キロを53.7%→81.1%に広げたとき、29ペアで
// 実額と違う運賃が出るようになった）。全ペア持てば距離に依存しなくなる。
//
// 増えるのは1万ペア弱で、距離表の正しさは lib/fare/__tests__/fare-sources.test.ts が
// 別に検証しているため、特定運賃で覆っても距離表の誤りは隠れない。
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fareOverrideSchema } from "@/lib/fare/types";
import type { RailGraph } from "@/lib/graph/types";

// 公式の運賃表と graph.json（駅データ.jp）で駅名が食い違うもの。
// 万葉線の西新湊は2023年9月1日に「第一イン新湊 クロスベイ前」へ改称されたが、
// グラフ側は旧名のまま（出典: https://www.manyosen.co.jp/season/2023/95103/）。
// 特定運賃は駅名で引くので、ここを合わせないとそのペアが引けなくなる。
const STATION_ALIASES: Record<string, string> = {
  クロスベイ前: "西新湊",
};

interface FareSource {
  id: string;
  operator: string;
  source: { url: string; fetchedAt: string; note: string };
  pairs: { from: string; to: string; km: number | null; fare: number }[];
}

function main(write: boolean, onlyId: string | undefined): void {
  const graph = JSON.parse(
    readFileSync("data/graph.json", "utf8"),
  ) as RailGraph;
  for (const file of readdirSync("data/fare-sources").filter((f) =>
    f.endsWith(".json"),
  )) {
    const source = JSON.parse(
      readFileSync(`data/fare-sources/${file}`, "utf8"),
    ) as FareSource;
    if (onlyId !== undefined && source.id !== onlyId) continue;

    const path = `data/fare-overrides/${source.id}.json`;
    const before = existsSync(path)
      ? fareOverrideSchema.parse(JSON.parse(readFileSync(path, "utf8")))
      : undefined;

    const names = new Set(
      Object.values(graph.nodes)
        .filter((n) => n.operator === source.operator)
        .map((n) => n.name),
    );
    const alias = (n: string) => STATION_ALIASES[n] ?? n;
    const dropped: string[] = [];
    const pairs = [...source.pairs]
      .map((p) => ({ from: alias(p.from), to: alias(p.to), fare: p.fare }))
      .filter((p) => {
        // グラフに無い駅のペアは持てない（引く手段が無く、整合テストも落ちる）。
        // 落とした数は必ず表示する。黙って捨てると改称や新駅に気づけない
        const ok = names.has(p.from) && names.has(p.to);
        if (!ok) dropped.push(`${p.from}-${p.to}`);
        return ok;
      })
      .sort((a, b) =>
        a.from === b.from
          ? a.to.localeCompare(b.to)
          : a.from.localeCompare(b.from),
      );
    const next = {
      operator: source.operator,
      pairs,
      source: {
        url: source.source.url,
        fetchedAt: source.source.fetchedAt,
        note:
          `data/fare-sources/${source.id}.json の実額を全ペア持つ。` +
          `距離帯表で引ける額と一致するペアも落とさない: 落とすと生成時のグラフ距離に` +
          `依存し、距離データを入れ替えたときに覆いが外れて運賃が変わる。` +
          `再生成は npx tsx scripts/fare/derive-overrides.ts --write。` +
          `元データの出典: ${source.source.note}`,
      },
    };
    fareOverrideSchema.parse(next);

    process.stdout.write(
      `${source.operator} (${source.id}): ${before?.pairs.length ?? 0} → ${pairs.length}ペア` +
        (dropped.length > 0
          ? ` / graph.json に無い駅のため落とした ${dropped.length}（例: ${dropped.slice(0, 3).join(", ")}）`
          : "") +
        "\n",
    );
    if (!write) continue;
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(`  書き出し: ${path}\n`);
  }
}

main(
  process.argv.includes("--write"),
  process.argv.find((a) => a.startsWith("--id="))?.slice(5),
);
