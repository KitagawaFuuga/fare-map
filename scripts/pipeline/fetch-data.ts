import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";

const BASE = "https://raw.githubusercontent.com/ny-a/ekidata/master/csvs";
const FILES = ["company", "line", "station", "join"] as const;

async function main(): Promise<void> {
  mkdirSync("data/raw", { recursive: true });

  // 全ファイルを取得しきってからまとめて書き込む。
  // 途中で失敗した場合に data/raw/ が新旧混在の状態になるのを防ぐため。
  const fetched: { name: (typeof FILES)[number]; text: string }[] = [];
  for (const name of FILES) {
    const res = await fetch(`${BASE}/${name}.csv`);
    if (!res.ok)
      throw new Error(`${name}.csv の取得に失敗: HTTP ${res.status}`);
    const text = await res.text();
    fetched.push({ name, text });
    process.stdout.write(`${name}.csv: ${text.split("\n").length - 1} rows\n`);
  }

  // 実データの書き込みは .tmp に対して行い、全件成功してから rename で確定させる。
  // rename はファイルシステム内のメタデータ操作なので、書き込み完了後は失敗しうる窓がほぼ無い。
  // 途中で例外が起きた場合は finally で .tmp を必ず片付け、data/raw/ 本体には触れない。
  const tmpPaths = fetched.map(({ name }) => `data/raw/${name}.csv.tmp`);
  try {
    for (const { name, text } of fetched) {
      writeFileSync(`data/raw/${name}.csv.tmp`, text);
    }
    for (const { name } of fetched) {
      renameSync(`data/raw/${name}.csv.tmp`, `data/raw/${name}.csv`);
    }
  } finally {
    for (const p of tmpPaths) {
      rmSync(p, { force: true });
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
