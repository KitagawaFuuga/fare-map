// 運賃表の元資料（PDF/テキスト）から距離帯テーブルを復元する補助ツール。
//
//   npx tsx scripts/fare/derive-table.ts <file.pdf|file.txt> \
//     [--id=xxx] [--operator=xxx] [--column=N] [--exclude-km=a,b]
//
// 実績: 豊橋鉄道の改定運賃表PDF（方式triple・観測点117・要 --exclude-km=5.4）と
// 小田急の距離帯表（方式ranges・要 --column=2）から、コミット済みの
// data/fare-rules/toyotetsu-atsumi.json・odakyu.json と同一の表を再現できることを確認済み。
//
// PDFは pdftotext -layout でテキスト化してから解析する（要 poppler）。
// 解析は複数の方式を順に試し、観測点がいちばん多く取れて自己検証を通った方式を採用する。
// 復元できたら data/fare-rules/ に貼れる形のJSONを出力し、帯の上限が一意に決まって
// いない箇所があれば「どの距離の観測点を足せば決まるか」を併せて報告する。
//
// 重要: このツールの出力はそのまま信用してはいけない。必ず ekitan.com 等の
// 独立した情報源で実運賃を2点以上照合してからコミットすること。過去に山陽電鉄で
// 転記元の2次情報が誤っていた例がある（詳細は data/fare-rules/sanyo.json）。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { deriveFareTable, type KmFarePair } from "@/lib/fare/derive";

const INT = /(?<![\d.])\d{2,5}(?![\d.])/g; // 運賃（2〜5桁の整数）
const DEC = /\d+\.\d+/g; // 営業キロ（小数）

function ints(s: string): number[] {
  return [...s.matchAll(INT)].map((m) => Number(m[0]));
}
function decs(s: string): number[] {
  return [...s.matchAll(DEC)].map((m) => Number(m[0]));
}

// 方式A: 「きっぷ運賃 / IC運賃 / 営業キロ」が3行1組で並ぶ形式（豊橋鉄道の改定運賃表など）。
// 全駅ペアぶんの組が取れるため観測点が一気に増える。レイアウトの都合で運賃行が
// 2行に割れることがあるので、キロ行の手前3行から整数を拾って末尾N個を使う。
function strategyTriple(lines: string[]): KmFarePair[] {
  const out: KmFarePair[] = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const km = decs(line);
    if (km.length < 2 || ints(line).length > 0) continue;
    const prev = lines[i - 1];
    if (prev === undefined || ints(prev).length !== km.length) continue; // 直前はIC運賃行
    const buf: number[] = [];
    for (const j of [i - 4, i - 3, i - 2]) {
      const l = lines[j];
      if (l !== undefined && decs(l).length === 0) buf.push(...ints(l));
    }
    if (buf.length < km.length) continue;
    const tickets = buf.slice(buf.length - km.length);
    km.forEach((k, idx) => {
      const fare = tickets[idx];
      if (fare !== undefined) out.push({ km: k, fare });
    });
  }
  return out;
}

// 方式B: 「キロ程 1～3 / 運賃 210」のような2列の距離帯表（小田急・神戸電鉄など）。
// 範囲の上限がそのまま帯の上限なので、上限と下限の両方を観測点として扱う。
// 運賃の列が複数ある資料（IC運賃ときっぷ運賃、改定前と改定後など）では
// どの列を採るかで結果が変わる。--column でその選択を明示する（1始まり）。
// 選択を誤ると「正しい形の、しかし別物の運賃表」ができてしまい自己検証では
// 捕まらないため、実運賃での照合が必須。
function strategyRanges(lines: string[], column: number): KmFarePair[] {
  const out: KmFarePair[] = [];
  const re =
    /(\d+(?:\.\d+)?)\s*[～〜~-]\s*(\d+(?:\.\d+)?)\s*(?:km|ｋｍ|キロ)?(.*)$/;
  for (const line of lines) {
    const m = re.exec(line);
    if (m === null) continue;
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    const rest = m[3] ?? "";
    if (!(lo > 0) || !(hi >= lo)) continue;
    const fares = ints(rest);
    const fare = fares[column - 1];
    if (fare === undefined) continue;
    out.push({ km: hi, fare }, { km: lo, fare });
  }
  return out;
}

// 方式C: 1行に「営業キロ ... 運賃」が並ぶ形式（駅別運賃表をテキストに起こした場合など）
function strategyInline(lines: string[]): KmFarePair[] {
  const out: KmFarePair[] = [];
  const re = /(\d+\.\d+)\D+?(\d{2,5})(?![\d.])/g;
  for (const line of lines) {
    for (const m of line.matchAll(re)) {
      out.push({ km: Number(m[1]), fare: Number(m[2]) });
    }
  }
  return out;
}

// 方式D: 駅別の三角運賃表で、各行の末尾にその駅の営業キロ（起点からの累計）が
// 付いている形式（愛知環状鉄道の旅客運賃表など）。行に並ぶ運賃は、その行より上に
// 現れた駅（＝すでに読んだキロ値）への運賃を、近い順に並べたものになる。
// 起点からの累計キロ同士の差が区間の距離なので、駅名が読めなくても観測点が作れる。
//
// 左側に定期運賃の列が入っていることがあるが、定期額は桁区切りのカンマを含むので、
// 「最後のカンマ付き数値より後ろの整数」だけを普通運賃として拾えば分離できる。
function strategyTriangleKm(lines: string[]): KmFarePair[] {
  const out: KmFarePair[] = [];
  const kmSeen: number[] = [];
  for (const line of lines) {
    const tokens = [...line.matchAll(/[\d,]*\d(?:\.\d+)?/g)].map((m) => m[0]);
    if (tokens.length === 0) continue;
    const last = tokens[tokens.length - 1];
    if (last === undefined || !last.includes(".")) continue;
    // 起点駅のキロは 0.0 になる。ここで弾くと最長区間の観測点を丸ごと失うので、
    // 0 を許す（区間の距離が0になる組は下で除外される）。
    const km = Number(last);
    if (!Number.isFinite(km) || km < 0) continue;

    let lastComma = -1;
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (tokens[i]?.includes(",") === true) {
        lastComma = i;
        break;
      }
    }
    const fares = tokens
      .slice(lastComma + 1, tokens.length - 1)
      .filter((t) => !t.includes(",") && !t.includes("."))
      .map(Number)
      .filter((n) => n >= 100 && n <= 99999);

    // 上に現れた駅を近い順に並べたものが運賃の並び順
    const targets = [...kmSeen].reverse();
    for (let i = 0; i < fares.length && i < targets.length; i++) {
      const target = targets[i];
      const fare = fares[i];
      if (target === undefined || fare === undefined) continue;
      const d = Math.abs(km - target);
      if (d > 0) out.push({ km: Number(d.toFixed(1)), fare });
    }
    kmSeen.push(km);
  }
  return out;
}

type Strategy = (lines: string[], column: number) => KmFarePair[];

const STRATEGIES: readonly (readonly [string, Strategy])[] = [
  ["triple", (l) => strategyTriple(l)],
  ["ranges", strategyRanges],
  ["inline", (l) => strategyInline(l)],
  ["tri-km", (l) => strategyTriangleKm(l)],
] as const;

function toText(path: string): string {
  if (!path.toLowerCase().endsWith(".pdf")) return readFileSync(path, "utf8");
  // -layout は列の位置関係を保つので、3行1組の形式を復元しやすい
  return execFileSync("pdftotext", ["-layout", path, "-"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function main(): void {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith("--"));
  if (path === undefined) {
    process.stderr.write(
      "usage: tsx scripts/fare/derive-table.ts <file.pdf|file.txt> " +
        "[--id=xxx] [--operator=xxx] [--column=N] [--exclude-km=a,b]\n",
    );
    process.exitCode = 1;
    return;
  }
  // 1つの資料に複数の運賃体系が載っている場合（豊橋鉄道の改定運賃表は渥美線の
  // 全駅ペア表の傍らに市内線の均一運賃ブロックが入っている）、混ざった観測点を
  // 距離で除外する。除外は必ず出力に明記し、source.note に理由を書くこと。
  // 「自己検証が通らないから消す」という使い方をしてはいけない。
  const excludeKm = new Set(
    args
      .filter((a) => a.startsWith("--exclude-km="))
      .flatMap((a) => a.slice(13).split(",").map(Number))
      .filter((n) => Number.isFinite(n)),
  );
  // 運賃の列が複数ある資料でどの列を採るか（1始まり。既定は1列目）
  const column = Number(
    args.find((a) => a.startsWith("--column="))?.slice(9) ?? "1",
  );
  const id = args.find((a) => a.startsWith("--id="))?.slice(5) ?? "TODO-id";
  const operator =
    args.find((a) => a.startsWith("--operator="))?.slice(11) ?? "TODO-事業者名";

  const lines = toText(path)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");

  let best: {
    name: string;
    result: ReturnType<typeof deriveFareTable>;
  } | null = null;
  if (excludeKm.size > 0) {
    process.stdout.write(
      `除外した距離: ${[...excludeKm].join(", ")}km（理由を source.note に残すこと）\n`,
    );
  }

  for (const [name, fn] of STRATEGIES) {
    const pairs = fn([...lines], column).filter((p) => !excludeKm.has(p.km));
    const result = deriveFareTable(pairs);
    process.stdout.write(
      `方式 ${name.padEnd(6)}: 観測点 ${String(result.pairCount).padStart(4)} / ` +
        `${result.ok ? "自己検証OK" : "NG"} ${result.problems[0] ?? ""}\n`,
    );
    // 自己検証を通ったもののうち観測点が最多のものを採用する
    if (
      result.ok &&
      (best === null || result.pairCount > best.result.pairCount)
    ) {
      best = { name, result };
    }
  }

  if (best === null) {
    process.stdout.write(
      "\nどの方式でも復元できなかった。資料の形式を目視で確認し、" +
        "必要なら ekitan 等で実運賃を6点ほど集めて手で組み立てること。\n",
    );
    process.exitCode = 1;
    return;
  }

  const { name, result } = best;
  process.stdout.write(
    `\n採用: 方式 ${name}（観測点 ${result.pairCount}）\n\n`,
  );
  for (const b of result.bands) {
    const range = b.boundaryRange
      ? `境界候補 [${b.boundaryRange[0]}, ${b.boundaryRange[1]})`
      : "最終帯";
    process.stdout.write(
      `  ${String(b.fare).padStart(5)}円 まで${String(b.maxKm).padStart(6)}km  ` +
        `観測${String(b.observed).padStart(3)}点  ${b.pinned ? "確定" : "未確定"}  ${range}\n`,
    );
  }
  if (result.unpinned > 0) {
    process.stdout.write(
      `\n上限が未確定の帯が ${result.unpinned} 本ある。` +
        `該当の境界候補の範囲に入る距離の実運賃を足せば確定する。\n`,
    );
  }

  const table = result.table
    .map(([km, fare]) => `    [${km}, ${fare}]`)
    .join(",\n");
  const lastRow = result.table[result.table.length - 1];
  process.stdout.write(`
--- data/fare-rules/${id}.json の下書き（実運賃を2点以上照合してから使うこと）---
{
  "id": ${JSON.stringify(id)},
  "operators": [${JSON.stringify(operator)}],
  "table": [
${table}
  ],
  "beyond": { "fromKm": ${lastRow?.[0] ?? 0}, "baseFare": ${lastRow?.[1] ?? 0}, "ratePerKm": 10 },
  "source": {
    "url": "TODO",
    "fetchedAt": "${new Date().toISOString().slice(0, 10)}",
    "note": "TODO: 出典と、scripts/fare/derive-table.ts の方式${name}で観測点${result.pairCount}点から復元した旨、および ekitan.com 等で照合した実運賃2点以上を書く。"
  }
}
`);
}

main();
