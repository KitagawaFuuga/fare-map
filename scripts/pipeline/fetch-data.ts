import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";

// 駅データ.jp の CSV を data/raw/ の正式な名前（station.csv など）にそろえる。
//
// 駅データ.jp 本家のダウンロードは会員ログインが要るので、手で落としたファイル
// （station20260731free.csv のように日付付き）を data/raw/ に置いてから実行する。
// 種類ごとに日付の最も新しいファイルを採る。
//
// 以前は再配布ミラー ny-a/ekidata から取っていたが、ミラーは2021年6月で更新が
// 止まっており、廃止線（日高本線 鵡川〜様似など）・経営移管（北陸本線 金沢〜敦賀）・
// 新線（東急新横浜線など）が反映されていなかった。
const FILES = ["company", "line", "station", "join"] as const;

// 列がずれたファイル（別の種類や形式変更）を黙って採らないよう、見出しを確かめる
const HEADERS: Record<(typeof FILES)[number], string> = {
  company: "company_cd,rr_cd,company_name",
  line: "line_cd,company_cd,line_name",
  station: "station_cd,station_g_cd,station_name",
  join: "line_cd,station_cd1,station_cd2",
};

function main(): void {
  mkdirSync("data/raw", { recursive: true });
  const entries = readdirSync("data/raw");

  const picked = FILES.map((name) => {
    const candidates = entries
      .map((f) => ({
        f,
        m: new RegExp(`^${name}(\\d{8})(free)?\\.csv$`).exec(f),
      }))
      .filter((x) => x.m !== null)
      .sort((a, b) => (a.m![1]! < b.m![1]! ? 1 : -1));
    const newest = candidates[0];
    if (newest === undefined) {
      throw new Error(
        `data/raw/ に ${name}YYYYMMDD.csv が無い。駅データ.jp からダウンロードして置く`,
      );
    }
    const head =
      readFileSync(`data/raw/${newest.f}`, "utf8").split("\n")[0] ?? "";
    if (!head.startsWith(HEADERS[name])) {
      throw new Error(`${newest.f} の見出しが想定と違う: ${head.slice(0, 80)}`);
    }
    return { name, file: newest.f };
  });

  // 全種類そろってから置き換える。途中で失敗して新旧が混ざるのを防ぐ
  const tmpPaths = picked.map(({ name }) => `data/raw/${name}.csv.tmp`);
  try {
    for (const { name, file } of picked) {
      copyFileSync(`data/raw/${file}`, `data/raw/${name}.csv.tmp`);
    }
    for (const { name, file } of picked) {
      renameSync(`data/raw/${name}.csv.tmp`, `data/raw/${name}.csv`);
      process.stdout.write(`${name}.csv ← ${file}\n`);
    }
  } finally {
    for (const p of tmpPaths) rmSync(p, { force: true });
  }
}

try {
  main();
} catch (e: unknown) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
