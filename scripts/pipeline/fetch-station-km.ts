// 路線記事の駅一覧から隣接駅間の営業キロを集めて data/station-km.json に書く。
//
//   npx tsx scripts/pipeline/fetch-station-km.ts [--write] [--operator=JR東日本]
//     [--line=山手線] [--cache-dir=<path>]
//
// --write を付けなければ何も書かず、路線ごとの結果だけを表示する。
//
// なぜ要るか: data/graph.json の駅間キロは駅の座標から出した直線距離を
// 実営業キロ（区間単位）の比で補正した推定値で、運賃が距離で決まる事業者では
// これが誤差の主因になっている（帯の境界をまたぐと運賃が1段ずれる）。
// 駅ごとの営業キロが載っている全国規模の資料は路線記事の駅一覧だけなので、
// そこから取る。取るのは駅名と数値だけで、文章は複製しない。
//
// 取り違えの危険: 駅一覧には「駅間」「累計（起点Aから）」「累計（起点Bから）」が
// 並ぶことがあり、列を1本間違えると営業キロが全部狂う。判定は
// lib/graph/station-km.ts が実営業キロの区間を正解にして行う。検証できない表は
// 採用しない。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseCsv } from "@/lib/graph/csv";
import { extractStationKm, type KmSection } from "@/lib/graph/station-km";
import { extractTables } from "@/scripts/fare/ingest/html-table";
import type { RailGraph } from "@/lib/graph/types";

const API = "https://ja.wikipedia.org/w/api.php";
const USER_AGENT =
  "fare-map/1.0 (station kilometrage research; contact via repository issues)";
// 連続取得の間隔。速いと 429 で弾かれる（300ms・1200ms はどちらも数十件で
// 打ち切られた）。取得済みは cacheDir に残るので、途中で止めても再実行で続きから進む
const GAP_MS = 2500;
const MAX_RETRY = 5;

function arg(name: string): string | undefined {
  return process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
}

// JR北海道・JR東海は「函館線」「高山線」と本を付けない表記を使う。
// 路線名の突き合わせはこの形に寄せてから行う
export function normalizeLineKey(name: string): string {
  return name
    .replace(/[（(].*/, "")
    .replace(/\s/g, "")
    .replace(/本線$/, "線")
    .trim();
}

// グラフの路線名は事業者の略称で始まる（近鉄名古屋線・東武伊勢崎線）が、
// 実営業キロのデータ側は略称を落としている（名古屋線・伊勢崎線）。
// 事業者ごとに略称を1つ決めて剥がし、そのうえで完全一致で突き合わせる。
//
// endsWith で緩く照合してはいけない。「近鉄南大阪線」が「大阪線」に一致してしまい、
// 別路線の区間キロを正解として使うことになる（近鉄には大阪線と南大阪線が両方ある）。
export function operatorLinePrefix(lineNames: string[]): string {
  const covers = (prefix: string) =>
    lineNames.filter((n) => n.startsWith(prefix)).length;
  let best = "";
  // 空文字は全路線に前方一致してしまうので、比較の初期値に使ってはいけない
  let bestCount = 0;
  for (const name of lineNames) {
    for (let len = 1; len <= 6 && len < name.length; len++) {
      const candidate = name.slice(0, len);
      const count = covers(candidate);
      // 過半数の路線が持つ接頭辞のうち、いちばん長いものを採る
      if (count < Math.max(2, lineNames.length / 2)) continue;
      if (count > bestCount || (count === bestCount && len > best.length)) {
        best = candidate;
        bestCount = count;
      }
    }
  }
  return best;
}

/** 実営業キロ側の路線名は「南大阪線・吉野線」のように束ねられていることがある */
export function csvLineKeys(name: string): string[] {
  return name
    .split(/[・／/]/)
    .map((part) => normalizeLineKey(part))
    .filter((part) => part !== "");
}

// 記事名は正式路線名。graph の lineName から括弧の区間表記などを落とす
function articleTitle(lineName: string): string {
  return lineName
    .replace(/^JR/, "")
    .replace(/[（(].*/, "")
    .trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FetchOutcome =
  | { kind: "ok"; html: string }
  | { kind: "missing" }
  | { kind: "failed"; reason: string };

// 「記事が存在しない」と「こちらが弾かれた」を混ぜないこと。混ぜると
// レート制限で落ちたぶんを「記事なし」と誤読して、取れるはずのデータを諦める
async function fetchArticleHtml(
  title: string,
  cacheDir: string,
): Promise<FetchOutcome> {
  const cache = `${cacheDir}/${encodeURIComponent(title)}.html`;
  if (existsSync(cache))
    return { kind: "ok", html: readFileSync(cache, "utf8") };
  const url =
    `${API}?action=parse&page=${encodeURIComponent(title)}` +
    "&prop=text&format=json&formatversion=2&redirects=1&maxlag=5";

  let wait = 10000;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    } catch (e) {
      // 接続断も一時的なものとして扱う。ここで投げると全体が止まり、
      // それまでに取れたぶんも書き出せない
      process.stdout.write(
        `  再接続待ち ${Math.round(wait / 1000)}秒 (${e instanceof Error ? e.message : "不明"})
`,
      );
      await sleep(wait);
      wait *= 2;
      continue;
    }
    await sleep(GAP_MS);
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "0") * 1000;
      process.stdout.write(
        `
  待機 ${Math.round(Math.max(retryAfter, wait) / 1000)}秒 (HTTP ${res.status})          `,
      );
      await sleep(Math.max(retryAfter, wait));
      wait *= 2;
      continue;
    }
    if (!res.ok) return { kind: "failed", reason: `HTTP ${res.status}` };
    const body = (await res.json()) as {
      parse?: { text?: string };
      error?: { code?: string };
    };
    if (body.error?.code === "missingtitle") return { kind: "missing" };
    if (body.error?.code === "maxlag") {
      await sleep(wait);
      wait *= 3;
      continue;
    }
    const html = body.parse?.text;
    if (html === undefined) {
      return { kind: "failed", reason: body.error?.code ?? "本文が無い" };
    }
    writeFileSync(cache, html);
    return { kind: "ok", html };
  }
  return { kind: "failed", reason: "再試行しても弾かれた" };
}

interface OutputEdge {
  operator: string;
  line: string;
  from: string;
  to: string;
  km: number;
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const onlyOperator = arg("operator");
  const onlyLine = arg("line");
  const cacheDir = arg("cache-dir") ?? "node_modules/.cache/fare-map-wiki";
  mkdirSync(cacheDir, { recursive: true });

  const graph = JSON.parse(
    readFileSync("data/graph.json", "utf8"),
  ) as RailGraph;
  const kmRows = parseCsv(
    readFileSync("data/raw/kilometrage.csv", "utf8").replace(/"/g, ""),
  );

  // 事業者ごとの路線名の接頭辞（近鉄・東武・JR など）を先に決める。
  // --operator で絞っても接頭辞は全路線から決める（絞ると母数が偏る）
  const lineNamesByOperator = new Map<string, Set<string>>();
  for (const n of Object.values(graph.nodes)) {
    const set = lineNamesByOperator.get(n.operator) ?? new Set<string>();
    set.add(n.lineName);
    lineNamesByOperator.set(n.operator, set);
  }
  const prefixOf = new Map(
    [...lineNamesByOperator].map(([operator, names]) => [
      operator,
      operatorLinePrefix([...names]),
    ]),
  );
  const graphLineKey = (operator: string, lineName: string): string => {
    const prefix = prefixOf.get(operator) ?? "";
    const stripped =
      prefix !== "" && lineName.startsWith(prefix)
        ? lineName.slice(prefix.length)
        : lineName;
    return normalizeLineKey(stripped);
  };

  // 駅の候補は路線ではなく事業者の全駅から採る。
  //
  // グラフの lineName は運転系統なので、正式な所属路線とずれる。名鉄常滑線には
  // 直通する名古屋本線の駅（名鉄名古屋・山王・金山）が入っており、常滑線の記事には
  // 当然その3駅が無いため、路線で絞ると3区間が推定値のまま残って路線全体が
  // 5.8km長くなっていた。
  //
  // 広げても誤対応は起きない。突き合わせはセルの完全一致で、接続路線の欄は
  // 長い文章なのでどの駅名とも一致しないため。加えて採用には実営業キロの
  // 区間との一致が要る。
  const namesByOperator = new Map<string, Set<string>>();
  for (const n of Object.values(graph.nodes)) {
    const set = namesByOperator.get(n.operator) ?? new Set<string>();
    set.add(n.name);
    namesByOperator.set(n.operator, set);
  }

  // 路線ごとに、正解に使う実営業キロの区間を集める
  const lines = new Map<
    string,
    { operator: string; lineName: string; names: Set<string> }
  >();
  for (const n of Object.values(graph.nodes)) {
    if (onlyOperator !== undefined && n.operator !== onlyOperator) continue;
    const key = `${n.operator}\u0000${graphLineKey(n.operator, n.lineName)}`;
    const entry = lines.get(key) ?? {
      operator: n.operator,
      lineName: n.lineName,
      names: namesByOperator.get(n.operator) ?? new Set<string>(),
    };
    lines.set(key, entry);
  }

  const targets = [...lines.values()]
    .map((l) => ({ ...l, title: articleTitle(l.lineName) }))
    .filter((l) => onlyLine === undefined || l.title === onlyLine)
    // 同じ記事を何度も引かないよう、記事名で重複を畳む
    .filter(
      (l, i, all) =>
        all.findIndex(
          (x) => x.title === l.title && x.operator === l.operator,
        ) === i,
    );

  const edges: OutputEdge[] = [];
  const report: string[] = [];
  let missingArticle = 0;
  let noSections = 0;

  for (const target of targets) {
    const sections: KmSection[] = kmRows
      .filter(
        (r) =>
          (r["事業者名"] ?? "") === target.operator &&
          csvLineKeys(r["路線名"] ?? "").includes(
            graphLineKey(target.operator, target.lineName),
          ) &&
          target.names.has(r["起点駅"] ?? "") &&
          target.names.has(r["終点駅"] ?? ""),
      )
      .map((r) => ({
        from: r["起点駅"] as string,
        to: r["終点駅"] as string,
        officialKm: Number(r["営業キロ"]),
      }))
      .filter((s) => Number.isFinite(s.officialKm) && s.officialKm > 0);

    if (sections.length === 0) {
      noSections++;
      report.push(
        `- ${target.operator} ${target.title}: 正解に使える区間が無い`,
      );
      continue;
    }

    const outcome = await fetchArticleHtml(target.title, cacheDir);
    if (outcome.kind !== "ok") {
      missingArticle++;
      report.push(
        `- ${target.operator} ${target.title}: ` +
          (outcome.kind === "missing"
            ? "記事が無い"
            : `取得失敗 (${outcome.reason})`),
      );
      continue;
    }

    const result = extractStationKm(extractTables(outcome.html), {
      stationNames: target.names,
      sections,
    });
    for (const [key, km] of result.edgeKm) {
      const [from, to] = key.split("\u0000");
      if (from === undefined || to === undefined) continue;
      edges.push({
        operator: target.operator,
        line: target.lineName,
        from,
        to,
        km,
      });
    }
    report.push(
      `  ${target.operator} ${target.title}: 駅${target.names.size} 区間${sections.length} ` +
        `→ 駅間${result.edgeKm.size} (採用表${result.accepted.length})`,
    );
  }

  process.stdout.write(`${report.join("\n")}\n\n`);
  process.stdout.write(
    `路線 ${targets.length} / 記事なし ${missingArticle} / 区間なし ${noSections} / 駅間 ${edges.length}\n`,
  );

  // グラフのどれだけのレールエッジを置き換えられるか
  const byName = new Map<string, string>();
  for (const n of Object.values(graph.nodes)) byName.set(n.id, n.name);
  const known = new Set(
    edges.map(
      (e) => `${e.operator}\u0000${[e.from, e.to].sort().join("\u0000")}`,
    ),
  );
  const rail = graph.edges.filter((e) => e.kind === "rail");
  const covered = rail.filter((e) =>
    known.has(
      `${e.operator}\u0000${[byName.get(e.from) ?? "", byName.get(e.to) ?? ""]
        .sort()
        .join("\u0000")}`,
    ),
  );
  process.stdout.write(
    `レールエッジ被覆: ${covered.length}/${rail.length} (${((covered.length / rail.length) * 100).toFixed(1)}%)\n`,
  );

  if (!write) return;
  edges.sort((a, b) =>
    a.operator === b.operator
      ? a.from === b.from
        ? a.to.localeCompare(b.to)
        : a.from.localeCompare(b.from)
      : a.operator.localeCompare(b.operator),
  );
  writeFileSync(
    "data/station-km.json",
    `${JSON.stringify(
      {
        source: {
          url: "https://ja.wikipedia.org/ (各路線の記事の駅一覧)",
          fetchedAt: new Date().toISOString().slice(0, 10),
          note:
            "路線記事の駅一覧から取った隣接駅間の営業キロ。取得したのは駅名と数値のみで、" +
            "文章は複製していない。どの列が累計営業キロかは記事だけでは決まらないため、" +
            "全国鉄道運行本数データ(CC BY 4.0)の区間営業キロを正解として突き合わせ、" +
            "一致した列だけを採用している（lib/graph/station-km.ts）。検証できない表は捨てる。" +
            "再生成は npx tsx scripts/pipeline/fetch-station-km.ts --write",
        },
        edges,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write("data/station-km.json に書き出した\n");
}

void main();
