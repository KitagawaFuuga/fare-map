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
import { pathToFileURL } from "node:url";
import { parseCsv } from "@/lib/graph/csv";
import {
  csvOperatorOf,
  operatorAliasesSchema,
} from "@/lib/graph/operator-alias";
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

// 検証に使う実営業キロの区間を、路線ではなく事業者単位で集める。
//
// 路線名で絞ってはいけない。グラフの lineName の多くは愛称や運転系統名
// （花咲線＝根室本線、宇都宮線＝東北本線、琵琶湖線・京都線・神戸線＝東海道本線）で、
// 実営業キロ側の正式路線名と一致しない。路線で絞ると231路線が「正解に使える区間が
// 無い」として丸ごと棄却されていた。
//
// 絞らなくても取り違えは起きない。正解は駅ペアで引くので、別路線の区間は
// その2駅が表に並んでいなければ参照されないし、並んでいれば同じ2駅の距離として
// 正しい。ただし同じ2駅を別経路で結ぶ区間（池袋〜赤羽は東北線経由11.3km・
// 埼京線経由5.5km）は正解を一意に決められないので捨てる。
export function buildSections(
  rows: Record<string, string>[],
  operator: string,
  names: Set<string>,
): KmSection[] {
  const byPair = new Map<string, KmSection[]>();
  for (const r of rows) {
    if ((r["事業者名"] ?? "") !== operator) continue;
    const from = r["起点駅"] ?? "";
    const to = r["終点駅"] ?? "";
    if (!names.has(from) || !names.has(to)) continue;
    const officialKm = Number(r["営業キロ"]);
    if (!Number.isFinite(officialKm) || officialKm <= 0) continue;
    const key = [from, to].sort().join("\u0000");
    byPair.set(key, [...(byPair.get(key) ?? []), { from, to, officialKm }]);
  }
  const sections: KmSection[] = [];
  for (const found of byPair.values()) {
    const first = found[0];
    if (first === undefined) continue;
    if (found.some((s) => s.officialKm !== first.officialKm)) continue;
    sections.push(first);
  }
  return sections;
}

// 通称と正式名が別物で、事業者名の置き換えでは辿りつけない路線。
// 熊本電鉄の「本線」は正式には菊池線、「上熊本線」は藤崎線。
const LINE_ALIASES: Record<string, string> = {
  熊本電鉄本線: "熊本電気鉄道菊池線",
  熊本電鉄上熊本線: "熊本電気鉄道藤崎線",
};

// 記事名の候補を、試す順に返す。
//
// 1つに決められない。記事名は正式路線名（富山地方鉄道本線）だが graph の
// lineName は運転系統の略称表記（富山地鉄本線）で、しかも JR のように
// 略称を落とすだけで当たる事業者と、正式な事業者名に置き換えないと
// 当たらない事業者が混在している。
export function articleTitles(
  lineName: string,
  operator: string,
  prefix: string,
): string[] {
  const base = lineName.replace(/[（(].*/, "").trim();
  const titles = [base];
  // JR は落とす前を先に試す。「JR京都線」「JR神戸線」「JR東西線」は記事名その
  // もので、落とした「京都線」「東西線」は駅一覧の無い曖昧さ回避ページに当たる。
  // 「JR山手線」「JR宝塚線」のように正式名へのリダイレクトなら、どちらでも同じ
  // 記事に着く。JR が付かない路線（函館本線など）はここを通らない
  const stripped = base.replace(/^JR/, "");
  if (stripped !== base && stripped !== "") titles.push(stripped);
  else if (prefix !== "" && prefix !== operator && base.startsWith(prefix)) {
    titles.push(operator + base.slice(prefix.length));
  }
  const alias = LINE_ALIASES[base];
  if (alias !== undefined) titles.unshift(alias);
  return [...new Set(titles)];
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
  // 「記事が無い」も残す。候補を複数試すようになったので、存在しない候補
  // （JRおおさか東線・JR関西本線など）を毎回引き直すと1件2.5秒が積み上がる。
  // 記事が後から作られたら消せばよい（cacheDir は node_modules/.cache の下）
  const absent = `${cacheDir}/${encodeURIComponent(title)}.missing`;
  if (existsSync(absent)) return { kind: "missing" };
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
    if (body.error?.code === "missingtitle") {
      writeFileSync(absent, "");
      return { kind: "missing" };
    }
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

// 候補を順に試す。1つでも「弾かれた」があればそれを返す。記事が無いのと
// こちらが弾かれたのを混ぜると、レート制限のぶんを「記事なし」と誤読する
async function fetchArticle(
  titles: string[],
  cacheDir: string,
): Promise<{ outcome: FetchOutcome; title: string }> {
  let failed: { outcome: FetchOutcome; title: string } | undefined;
  for (const title of titles) {
    const outcome = await fetchArticleHtml(title, cacheDir);
    if (outcome.kind === "ok") return { outcome, title };
    if (outcome.kind === "failed" && failed === undefined)
      failed = { outcome, title };
  }
  return failed ?? { outcome: { kind: "missing" }, title: titles[0] ?? "" };
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

  // 正解に使う実営業キロの区間は事業者単位で作る（路線名では絞らない）
  // グラフ側は通称、実営業キロ側は登記上の社名なので、事業者名も直してから引く
  const aliases = operatorAliasesSchema.parse(
    JSON.parse(readFileSync("data/operator-aliases.json", "utf8")),
  ).aliases;
  const sectionsByOperator = new Map<string, KmSection[]>();
  for (const [operator, names] of namesByOperator) {
    sectionsByOperator.set(
      operator,
      buildSections(kmRows, csvOperatorOf(aliases, operator), names),
    );
  }

  // 路線ごとに記事を引く単位を作る
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
    .map((l) => ({
      ...l,
      titles: articleTitles(
        l.lineName,
        l.operator,
        prefixOf.get(l.operator) ?? "",
      ),
    }))
    .filter((l) => onlyLine === undefined || l.titles.includes(onlyLine))
    // 同じ記事を何度も引かないよう、記事名で重複を畳む
    .filter(
      (l, i, all) =>
        all.findIndex(
          (x) => x.titles[0] === l.titles[0] && x.operator === l.operator,
        ) === i,
    );

  const edges: OutputEdge[] = [];
  const report: string[] = [];
  let missingArticle = 0;
  let noSections = 0;

  for (const target of targets) {
    const sections =
      sectionsByOperator.get(target.operator) ?? ([] as KmSection[]);

    if (sections.length === 0) {
      noSections++;
      report.push(
        `- ${target.operator} ${target.titles[0]}: 正解に使える区間が無い`,
      );
      continue;
    }

    const { outcome, title } = await fetchArticle(target.titles, cacheDir);
    if (outcome.kind !== "ok") {
      missingArticle++;
      report.push(
        `- ${target.operator} ${title}: ` +
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
      `  ${target.operator} ${title}: 駅${target.names.size} 区間${sections.length} ` +
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

// テストや他のスクリプトから関数を import しただけで全件取得が始まらないよう、
// 直接実行されたときだけ走らせる
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
