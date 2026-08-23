import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://raw.githubusercontent.com/ny-a/ekidata/master/csvs";
const FILES = ["company", "line", "station", "join"] as const;

async function main(): Promise<void> {
  mkdirSync("data/raw", { recursive: true });

  // 全ファイルを取得しきってからまとめて書き込む。
  // 途中で失敗した場合に data/raw/ が新旧混在の状態になるのを防ぐため。
  const fetched: { name: (typeof FILES)[number]; text: string }[] = [];
  for (const name of FILES) {
    const res = await fetch(`${BASE}/${name}.csv`);
    if (!res.ok) throw new Error(`${name}.csv の取得に失敗: HTTP ${res.status}`);
    const text = await res.text();
    fetched.push({ name, text });
    process.stdout.write(`${name}.csv: ${text.split("\n").length - 1} rows\n`);
  }

  for (const { name, text } of fetched) {
    writeFileSync(`data/raw/${name}.csv`, text);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
