import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";

const URL =
  "https://gtfs-gis.jp/railway_honsu/data/unkohonsu2026_kukan_sjis.csv";

async function main(): Promise<void> {
  mkdirSync("data/raw", { recursive: true });

  const res = await fetch(URL);
  if (!res.ok) throw new Error(`kilometrage.csv の取得に失敗: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // 配布元は Shift_JIS。デコードして UTF-8 として保存する
  const text = new TextDecoder("shift-jis").decode(buf);
  process.stdout.write(`kilometrage.csv: ${text.split("\n").length - 1} rows\n`);

  // fetch-data.ts と同じ原子性の方針: .tmp に書いてから rename で確定させ、
  // 途中で例外が起きても finally で .tmp を必ず片付ける
  const tmpPath = "data/raw/kilometrage.csv.tmp";
  try {
    writeFileSync(tmpPath, text);
    renameSync(tmpPath, "data/raw/kilometrage.csv");
  } finally {
    rmSync(tmpPath, { force: true });
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
