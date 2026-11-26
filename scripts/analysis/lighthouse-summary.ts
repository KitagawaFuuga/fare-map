// Lighthouse CI（lhci autorun）の結果 .lighthouseci/reports/manifest.json を要約する。
// PR ごとの計測（.github/workflows/ci.yml の lighthouse ジョブ）でジョブの要約欄に貼る表を出す。
//
//   npx tsx scripts/analysis/lighthouse-summary.ts [.lighthouseci/reports]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

interface ManifestEntry {
  url: string;
  isRepresentativeRun: boolean;
  jsonPath: string;
  summary: { performance?: number };
}

export interface Row {
  url: string;
  // 0〜100 に直したスコア
  performance: number;
  lcpMs: number;
  cls: number;
  // INP はページを操作しないと測れないので、実験室での代わりに TBT を見る（web.dev の推奨）
  tbtMs: number;
}

// Core Web Vitals の「良い」の基準（web.dev）。lighthouserc.json の assert と同じ値
const LIMIT = { performance: 90, lcpMs: 2500, cls: 0.1, tbtMs: 200 };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// lhci の版が上がって形が変わったとき、どこが違うかを言って落ちる
export function parseManifest(json: unknown): ManifestEntry[] {
  if (!Array.isArray(json))
    throw new Error("manifest.json が配列ではありません");
  if (json.length === 0)
    throw new Error("manifest.json に計測結果が1件もありません");
  json.forEach((e, i) => {
    if (!isRecord(e))
      throw new Error(`manifest.json の ${i} 件目が object ではありません`);
    if (typeof e.url !== "string")
      throw new Error(`${i} 件目に url がありません`);
    if (typeof e.isRepresentativeRun !== "boolean")
      throw new Error(`${i} 件目に isRepresentativeRun がありません`);
    if (typeof e.jsonPath !== "string")
      throw new Error(`${i} 件目に jsonPath がありません`);
    if (!isRecord(e.summary))
      throw new Error(`${i} 件目に summary がありません`);
  });
  return json as ManifestEntry[];
}

function numericValue(lhr: unknown, audit: string): number {
  const v =
    isRecord(lhr) && isRecord(lhr.audits) && isRecord(lhr.audits[audit])
      ? lhr.audits[audit].numericValue
      : undefined;
  if (typeof v !== "number")
    throw new Error(`レポートに ${audit} の値がありません`);
  return v;
}

// URL ごとに、lhci が選んだ代表の回（中央値の回）の値を取る
export function summarize(
  manifest: ManifestEntry[],
  readReport: (jsonPath: string) => unknown,
): Row[] {
  const urls = [...new Set(manifest.map((e) => e.url))];
  return urls.map((url) => {
    const rep = manifest.find((e) => e.url === url && e.isRepresentativeRun);
    if (!rep) throw new Error(`${url} に代表の回がありません`);
    const lhr = readReport(rep.jsonPath);
    // 計測が失敗した回はスコアが null になる。0 と出すと測れたように見えるので落とす
    const score: unknown = rep.summary.performance;
    if (typeof score !== "number")
      throw new Error(`${url} の代表の回にスコアがありません（計測の失敗）`);
    return {
      url,
      performance: Math.round(score * 100),
      lcpMs: numericValue(lhr, "largest-contentful-paint"),
      cls: numericValue(lhr, "cumulative-layout-shift"),
      tbtMs: numericValue(lhr, "total-blocking-time"),
    };
  });
}

const mark = (bad: boolean) => (bad ? " ⚠" : "");

export function toMarkdown(rows: Row[]): string {
  const lines = rows.map(
    (r) =>
      `| ${r.url} | ${r.performance}${mark(r.performance < LIMIT.performance)} | ` +
      `${(r.lcpMs / 1000).toFixed(2)} s${mark(r.lcpMs > LIMIT.lcpMs)} | ` +
      `${r.cls.toFixed(3)}${mark(r.cls > LIMIT.cls)} | ` +
      `${Math.round(r.tbtMs)} ms${mark(r.tbtMs > LIMIT.tbtMs)} |`,
  );
  return [
    "## Lighthouse（表示速度）",
    "",
    "3回測った中央値の回。⚠ は Core Web Vitals の「良い」の基準を外れた値（警告だけで、CI は止めない）。",
    "CI の計測はぶれるので、1回の ⚠ より PR をまたいだ傾向を見る。",
    "",
    "| URL | スコア | LCP（≤2.5 s） | CLS（≤0.1） | TBT（≤200 ms） |",
    "| --- | --- | --- | --- | --- |",
    ...lines,
    "",
  ].join("\n");
}

// テストから import したときに読み込みが走らないよう、直接実行されたときだけ動かす
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const dir = process.argv[2] ?? ".lighthouseci/reports";
  const manifest = parseManifest(
    JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as unknown,
  );
  const rows = summarize(
    manifest,
    (p) => JSON.parse(readFileSync(p, "utf8")) as unknown,
  );
  process.stdout.write(toMarkdown(rows));
}
