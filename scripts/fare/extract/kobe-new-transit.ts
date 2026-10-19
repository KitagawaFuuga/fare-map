// 神戸新交通（ポートライナー・六甲ライナー）の公式運賃表（全駅間の表）から全ペアの
// 大人運賃を取り出す。
//
//   curl -o knt.html https://www.knt-liner.co.jp/ticket/fee/
//   npx tsx scripts/fare/extract/kobe-new-transit.ts knt.html > pairs.json
//
// 表の形: 駅 k の行は、先頭に自駅より前の駅との「区」（k個）、次に自駅の名前、その後に
// 自駅より後の駅との運賃（"210100" のように大人と小児が続けて書かれる）。
// 区と運賃は同じ組を別々に表すので、区から決まる運賃と表の運賃が全組で一致するかを検算する。
import { readFileSync } from "node:fs";
import { extractTables } from "@/scripts/fare/ingest/html-table";

const FARE_BY_ZONE: Record<string, number> = {
  "1区": 210,
  "2区": 250,
  "3区": 290,
  "4区": 340,
};

const html = readFileSync(process.argv[2] ?? "knt.html", "utf8");
const tables = extractTables(html).slice(0, 2); // 0: ポートライナー、1: 六甲ライナー

const pairs: { from: string; to: string; km: null; fare: number }[] = [];
for (const table of tables) {
  // セルを1列に並べ直す（行の切れ目は表示の都合で、意味を持たない）
  const cells = table
    .flat()
    .map((c) => c.trim())
    .filter((c) => c !== "");
  const names: string[] = [];
  const fares: number[][] = [];
  const zones: string[][] = [];
  let i = 0;
  for (let k = 0; i < cells.length; k++) {
    const z = cells.slice(i, i + k);
    if (z.some((c) => !(c in FARE_BY_ZONE))) {
      throw new Error(`区の並びが想定と違う: ${k}番目の駅 ${z.join(",")}`);
    }
    zones.push(z);
    i += k;
    const name = cells[i];
    if (name === undefined) break;
    // 駅名のあとに改行と駅番号（[P01]）が付いている
    names.push(name.replace(/\s*\[[A-Z0-9]+\]\s*$/, "").trim());
    i++;
    const row: number[] = [];
    while (i < cells.length && /^\d{6}$/.test(cells[i]!)) {
      row.push(Number(cells[i]!.slice(0, 3)));
      i++;
    }
    fares.push(row);
  }
  const n = names.length;
  for (let a = 0; a < n; a++) {
    if (fares[a]!.length !== n - a - 1) {
      throw new Error(`${names[a]} の運賃の数が合わない: ${fares[a]!.length}`);
    }
    for (let b = a + 1; b < n; b++) {
      const fare = fares[a]![b - a - 1]!;
      const zone = zones[b]![a]!;
      if (FARE_BY_ZONE[zone] !== fare) {
        throw new Error(
          `${names[a]}-${names[b]}: 区${zone} と運賃${fare} が合わない`,
        );
      }
      pairs.push({ from: names[a]!, to: names[b]!, km: null, fare });
    }
  }
}
process.stdout.write(`${JSON.stringify(pairs, null, 1)}\n`);
process.stderr.write(`${pairs.length} ペア\n`);
