// ミューテーションテスト（Stryker）の結果 reports/mutation/mutation.json を要約する。
// 週1回の計測（.github/workflows/mutation.yml）でジョブの要約欄に貼る表を出す。
//
//   npx tsx scripts/analysis/mutation-summary.ts [reports/mutation/mutation.json]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

interface Report {
  files: Record<string, { mutants: { status: string }[] }>;
}

export interface Counts {
  killed: number;
  timeout: number;
  survived: number;
  noCoverage: number;
  // 捕まえた割合（%）。Stryker の mutation score と同じ定義。
  // 有効な壊し方が0件なら null（Stryker も NaN を返す。100% と出すと壊れた実行が正常に見える）
  score: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Stryker の版が上がって形が変わったとき、どこが違うかを言って落ちる
export function parseReport(json: unknown): Report {
  if (!isRecord(json) || !isRecord(json.files)) {
    throw new Error("mutation.json に files がありません");
  }
  for (const [path, f] of Object.entries(json.files)) {
    const ok =
      isRecord(f) &&
      Array.isArray(f.mutants) &&
      f.mutants.every((m) => isRecord(m) && typeof m.status === "string");
    if (!ok) throw new Error(`${path} の mutants の形が想定と違います`);
  }
  return json as unknown as Report;
}

export interface Summary {
  total: Counts;
  // 見逃し（survived + noCoverage）の多い順。テストを足すべき場所の順でもある
  files: (Counts & { path: string })[];
}

function count(statuses: string[]): Counts {
  const n = (s: string) => statuses.filter((x) => x === s).length;
  const killed = n("Killed");
  const timeout = n("Timeout");
  const survived = n("Survived");
  const noCoverage = n("NoCoverage");
  // 壊したコードがコンパイルできない・実行時に落ちるものは、テストの検出力と
  // 関係がないので分母に入れない
  const valid = killed + timeout + survived + noCoverage;
  return {
    killed,
    timeout,
    survived,
    noCoverage,
    score: valid === 0 ? null : ((killed + timeout) / valid) * 100,
  };
}

export function summarize(report: Report): Summary {
  const all = Object.values(report.files).flatMap((f) =>
    f.mutants.map((m) => m.status),
  );
  const files = Object.entries(report.files)
    .map(([path, f]) => ({ path, ...count(f.mutants.map((m) => m.status)) }))
    .sort((a, b) => b.survived + b.noCoverage - (a.survived + a.noCoverage));
  return { total: count(all), files };
}

const pct = (n: number | null) => (n === null ? "N/A" : `${n.toFixed(1)}%`);

// 見逃しのあるファイルを上位 limit 件まで載せる。全部載せると数十行になり読まれない
export function toMarkdown(s: Summary, limit: number): string {
  const t = s.total;
  const rows = s.files
    .filter((f) => f.survived + f.noCoverage > 0)
    .slice(0, limit)
    .map(
      (f) =>
        `| ${f.path} | ${pct(f.score)} | ${f.survived} | ${f.noCoverage} |`,
    );
  const table =
    rows.length === 0
      ? ["見逃しはありません"]
      : [
          `見逃しの多いファイル（上位 ${rows.length} 件）`,
          "",
          "| ファイル | スコア | 見逃し | テストが無い |",
          "| --- | --- | --- | --- |",
          ...rows,
        ];
  return [
    "## ミューテーションテスト",
    "",
    `スコア: ${pct(t.score)}（捕まえた ${t.killed + t.timeout} / 見逃し ${t.survived} / テストが無い ${t.noCoverage}）`,
    "",
    ...table,
    "",
  ].join("\n");
}

// テストから import したときに読み込みが走らないよう、直接実行されたときだけ動かす
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const file = process.argv[2] ?? "reports/mutation/mutation.json";
  const report = parseReport(JSON.parse(readFileSync(file, "utf8")) as unknown);
  process.stdout.write(toMarkdown(summarize(report), 15));
}
