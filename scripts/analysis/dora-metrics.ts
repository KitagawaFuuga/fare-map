// DORA の5つの指標（https://dora.dev/guides/dora-metrics/ 、2026-01-05 更新）を、
// GitHub のデプロイの記録とコミットから集計する。月1回の集計（.github/workflows/dora.yml）で
// ジョブの要約欄に貼る表を出す。数字は目標にしない（同ページ: 目標にすると数字がゆがむ）。
//
//   npx tsx scripts/analysis/dora-metrics.ts [日数=30]
//
// このリポジトリでの定め方（dora.dev は始まりと終わりの時刻や集計のしかたまでは決めていない）:
// - デプロイ: main への push で動いた deploy.yml が成功した回（本番が切り替わった回）
// - 変更のリードタイム: そのデプロイで初めて本番に入ったコミット（merge コミットを除く）の
//   書いた時刻（author。rebase で変わらない）から、デプロイの完了まで。中央値
// - 変更の失敗率: 後のデプロイで revert されたコミット（merge コミットも。GitHub の Revert ボタンは
//   merge を戻す）を含むデプロイの割合。同じデプロイの中で入れて戻したものは本番に出ていないので数えない
// - 失敗したデプロイの復旧時間: 失敗したデプロイの完了から、その revert を含むデプロイの完了まで
// - デプロイの手戻り率: 本番に出たものを戻した revert か、メッセージに [incident] を含むコミットを含むデプロイの割合
//   （本番の障害を直すための計画外のデプロイ。revert でなく修正で直したときは [incident] を付ける）
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export interface Commit {
  sha: string;
  committedAt: string;
  message: string;
}

export interface Deploy {
  sha: string;
  finishedAt: string;
  // 1つ前の成功したデプロイから、このデプロイまでに入ったコミット（merge コミットを除く）
  commits: Commit[];
  // 同じ範囲の merge コミット。リードタイムには数えないが、GitHub の Revert ボタンは
  // merge コミットを戻す（This reverts commit <merge>）ので、失敗の特定には使う
  mergeShas?: string[];
}

export interface Period {
  from: string;
  to: string;
}

export interface Metrics {
  deployments: number;
  deploysPerWeek: number;
  leadTimeHours: { median: number | null; count: number };
  failedDeployments: number;
  changeFailRate: number | null;
  recoveryHours: number[];
  reworkDeployments: number;
  reworkRate: number | null;
}

const HOUR = 3_600_000;
const time = (iso: string) => Date.parse(iso);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// git revert が書く「This reverts commit <sha>.」から、戻した先のハッシュを取る
const revertedShas = (message: string) =>
  [...message.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)].map(
    (m) => m[1]!,
  );

export interface Run {
  head_sha: string;
  updated_at: string;
  created_at: string;
}

// デプロイの順番は作られた順。updated_at は再実行で変わり、古いデプロイが後ろに回って
// 前後のデプロイの比較（compare）が空になったり二重になったりする
export const orderRuns = <T extends Pick<Run, "created_at">>(runs: T[]): T[] =>
  [...runs].sort((a, b) => time(a.created_at) - time(b.created_at));

// 一番古い実行が「期間の始まり − 振り返る長さ」より新しければ、次のページも要る
export const needMorePages = (
  oldestCreatedAt: string,
  from: number,
  lookbackMs: number,
): boolean => time(oldestCreatedAt) >= from - lookbackMs;

export function parseDays(arg: string | undefined): number {
  if (arg === undefined || arg === "") return 30;
  const days = Number(arg);
  if (!Number.isInteger(days) || days <= 0)
    throw new Error(
      `集計する日数は正の整数で指定してください（受け取った値: ${arg}）`,
    );
  return days;
}

const isIncident = (c: Commit) => /\[incident\]/i.test(c.message);

export function computeMetrics(all: Deploy[], period: Period): Metrics {
  const from = time(period.from);
  const to = time(period.to);
  const deploys = all
    .filter((d) => time(d.finishedAt) >= from && time(d.finishedAt) < to)
    .sort((a, b) => time(a.finishedAt) - time(b.finishedAt));
  const n = deploys.length;
  const weeks = (to - from) / (7 * 24 * HOUR);

  const leadTimes = deploys.flatMap((d) =>
    d.commits.map((c) => (time(d.finishedAt) - time(c.committedAt)) / HOUR),
  );

  // revert された側のデプロイ（失敗）と、revert を含むデプロイ（復旧）を対にする。
  // 失敗したデプロイが期間の前でも、復旧が期間内なら復旧時間に入れる（記録を全部見る）
  const sorted = [...all].sort(
    (a, b) => time(a.finishedAt) - time(b.finishedAt),
  );
  const failed = new Map<string, Deploy>();
  const fixes = new Set<string>();
  const recoveryHours: number[] = [];
  const shasOf = (d: Deploy) => [
    ...d.commits.map((c) => c.sha),
    ...(d.mergeShas ?? []),
  ];
  for (const fix of deploys) {
    for (const target of fix.commits.flatMap((c) => revertedShas(c.message))) {
      const bad = sorted.find((d) =>
        shasOf(d).some((sha) => sha.startsWith(target)),
      );
      // 同じデプロイの中で入れて戻したもの（本番に出ていない）と、後のデプロイを戻すものは数えない
      if (!bad || time(bad.finishedAt) >= time(fix.finishedAt)) continue;
      fixes.add(fix.sha);
      if (failed.has(bad.sha)) continue;
      failed.set(bad.sha, bad);
      recoveryHours.push((time(fix.finishedAt) - time(bad.finishedAt)) / HOUR);
    }
  }
  const failedInPeriod = deploys.filter((d) => failed.has(d.sha)).length;
  // 手戻りは本番の障害を直すデプロイ: 本番に出たものを戻した revert か、[incident] の印
  const rework = deploys.filter(
    (d) => fixes.has(d.sha) || d.commits.some((c) => isIncident(c)),
  ).length;

  return {
    deployments: n,
    deploysPerWeek: n / weeks,
    leadTimeHours: { median: median(leadTimes), count: leadTimes.length },
    failedDeployments: failedInPeriod,
    changeFailRate: n === 0 ? null : failedInPeriod / n,
    recoveryHours,
    reworkDeployments: rework,
    reworkRate: n === 0 ? null : rework / n,
  };
}

const hours = (h: number | null) =>
  h === null
    ? "該当なし"
    : h < 48
      ? `${h.toFixed(1)} 時間`
      : `${(h / 24).toFixed(1)} 日`;
const ratio = (r: number | null, k: number, n: number) =>
  r === null
    ? "該当なし（デプロイが無い）"
    : `${(r * 100).toFixed(1)}%（${k} / ${n}）`;

export function toMarkdown(m: Metrics, period: Period): string {
  const day = (iso: string) => iso.slice(0, 10);
  const lead =
    m.leadTimeHours.median === null
      ? "該当なし"
      : `中央値 ${hours(m.leadTimeHours.median)}（コミット ${m.leadTimeHours.count} 件）`;
  const recovery =
    m.recoveryHours.length === 0
      ? "該当なし"
      : `中央値 ${hours(median(m.recoveryHours))}（${m.recoveryHours.length} 件）`;
  return [
    "## DORA の指標",
    "",
    `期間: ${day(period.from)} 〜 ${day(period.to)}（定義は scripts/analysis/dora-metrics.ts の冒頭）`,
    "",
    "| 速さ | 値 |",
    "| --- | --- |",
    `| デプロイの頻度 | ${m.deployments} 回（${m.deploysPerWeek.toFixed(1)} 回/週） |`,
    `| 変更のリードタイム | ${lead} |`,
    `| 失敗したデプロイの復旧時間 | ${recovery} |`,
    "",
    "| 不安定さ | 値 |",
    "| --- | --- |",
    `| 変更の失敗率 | ${ratio(m.changeFailRate, m.failedDeployments, m.deployments)} |`,
    `| デプロイの手戻り率 | ${ratio(m.reworkRate, m.reworkDeployments, m.deployments)} |`,
    "",
    "数字は目標にせず、前の月との違いと、その理由を話す材料にする。",
    "",
  ].join("\n");
}

// --- ここから下は GitHub から記録を取る部分（テストしない） ---

function token(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}

function repository(): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  return execFileSync(
    "gh",
    ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
    {
      encoding: "utf8",
    },
  ).trim();
}

async function api(path: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${path}`);
  return res.json();
}

// 期間より前を振り返る長さ。期間内の revert が戻した、期間より前のデプロイを見つけるため
const LOOKBACK_MS = 30 * 24 * HOUR;

// 期間の最初のデプロイの「1つ前」と、振り返る分まで取る
async function fetchSuccessfulDeploys(
  repo: string,
  from: number,
): Promise<Run[]> {
  const runs: Run[] = [];
  for (let page = 1; page <= 10; page++) {
    const body = (await api(
      `repos/${repo}/actions/workflows/deploy.yml/runs?branch=main&event=push&status=success&per_page=100&page=${page}`,
    )) as { workflow_runs: Run[] };
    runs.push(...body.workflow_runs);
    const oldest = body.workflow_runs.at(-1);
    if (!oldest || !needMorePages(oldest.created_at, from, LOOKBACK_MS)) break;
  }
  return orderRuns(runs);
}

interface CompareCommit {
  sha: string;
  parents: unknown[];
  commit: { message: string; author: { date: string } };
}

async function main() {
  const days = parseDays(process.argv[2]);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * HOUR);
  const repo = repository();
  const runs = await fetchSuccessfulDeploys(repo, from.getTime());

  const deploys: Deploy[] = [];
  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1]!;
    const cur = runs[i]!;
    // 期間の前の組は失敗の特定にだけ使うので、振り返る分より古いものは取らない
    if (time(cur.created_at) < from.getTime() - LOOKBACK_MS) continue;
    const cmp = (await api(
      `repos/${repo}/compare/${prev.head_sha}...${cur.head_sha}`,
    )) as { commits: CompareCommit[] };
    deploys.push({
      sha: cur.head_sha,
      // 再実行されたデプロイは完了が遅く出る（jobs API を引けば正確になるが、そこまではしない）
      finishedAt: cur.updated_at,
      commits: cmp.commits
        .filter((c) => c.parents.length === 1)
        .map((c) => ({
          sha: c.sha,
          // committer の時刻は rebase で書き換わるので、書いた時刻（author）から測る
          committedAt: c.commit.author.date,
          message: c.commit.message,
        })),
      mergeShas: cmp.commits
        .filter((c) => c.parents.length > 1)
        .map((c) => c.sha),
    });
  }

  const period = { from: from.toISOString(), to: to.toISOString() };
  process.stdout.write(toMarkdown(computeMetrics(deploys, period), period));
}

// テストから import したときに取得が走らないよう、直接実行されたときだけ動かす
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
