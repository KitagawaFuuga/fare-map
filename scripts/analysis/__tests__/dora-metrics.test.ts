import { describe, expect, it } from "vitest";
import {
  computeMetrics,
  needMorePages,
  orderRuns,
  parseDays,
  toMarkdown,
  type Deploy,
} from "@/scripts/analysis/dora-metrics";

const H = 3_600_000;
const t0 = Date.parse("2026-11-01T00:00:00Z");
const at = (hours: number) => new Date(t0 + hours * H).toISOString();

const commit = (sha: string, hours: number, message = `feat: ${sha}`) => ({
  sha,
  committedAt: at(hours),
  message,
});

const deploy = (
  sha: string,
  hours: number,
  commits: Deploy["commits"],
): Deploy => ({ sha, finishedAt: at(hours), commits });

const period = { from: at(0), to: at(24 * 7) };

describe("computeMetrics", () => {
  it("期間内の成功したデプロイの数と、1週間あたりの回数を出す", () => {
    const m = computeMetrics(
      [
        deploy("d1", 10, [commit("a", 8)]),
        deploy("d2", 50, [commit("b", 40)]),
        deploy("old", -5, [commit("z", -6)]),
      ],
      period,
    );
    expect(m.deployments).toBe(2);
    expect(m.deploysPerWeek).toBeCloseTo(2);
  });

  it("リードタイムは、デプロイに含まれる各コミットからデプロイ完了までの時間の中央値", () => {
    const m = computeMetrics(
      [
        deploy("d1", 10, [commit("a", 9), commit("b", 7)]),
        deploy("d2", 30, [commit("c", 20)]),
      ],
      period,
    );
    // 1h・3h・10h の中央値
    expect(m.leadTimeHours.median).toBeCloseTo(3);
    expect(m.leadTimeHours.count).toBe(3);
  });

  it("revert されたコミットを含むデプロイを失敗とし、revert を含むデプロイまでを復旧時間とする", () => {
    const m = computeMetrics(
      [
        deploy("d1", 10, [commit("a", 9)]),
        deploy("d2", 20, [commit("badbad0", 19)]),
        deploy("d3", 26, [
          commit(
            "rev",
            25,
            'Revert "feat: bad"\n\nThis reverts commit badbad0.',
          ),
        ]),
        deploy("d4", 40, [commit("c", 39)]),
      ],
      period,
    );
    expect(m.failedDeployments).toBe(1);
    expect(m.changeFailRate).toBeCloseTo(1 / 4);
    expect(m.recoveryHours).toEqual([6]);
    expect(m.reworkDeployments).toBe(1);
    expect(m.reworkRate).toBeCloseTo(1 / 4);
  });

  it("revert の対象を短いハッシュで書いていても、前方一致で失敗のデプロイを見つける", () => {
    const m = computeMetrics(
      [
        deploy("d1", 10, [commit("abcdef1234567890", 9)]),
        deploy("d2", 12, [
          commit("rev", 11, "Revert\n\nThis reverts commit abcdef1."),
        ]),
      ],
      period,
    );
    expect(m.failedDeployments).toBe(1);
    expect(m.recoveryHours).toEqual([2]);
  });

  it("[incident] の印が付いたコミットを含むデプロイは手戻りに数えるが、失敗のデプロイは特定しない", () => {
    const m = computeMetrics(
      [
        deploy("d1", 10, [commit("a", 9)]),
        deploy("d2", 12, [commit("fix", 11, "fix: 運賃が出ない [incident]")]),
      ],
      period,
    );
    expect(m.reworkDeployments).toBe(1);
    expect(m.failedDeployments).toBe(0);
  });

  it("デプロイが無ければ割合とリードタイムは null（0% と出すと測れたように見える）", () => {
    const m = computeMetrics([], period);
    expect(m.deployments).toBe(0);
    expect(m.changeFailRate).toBeNull();
    expect(m.reworkRate).toBeNull();
    expect(m.leadTimeHours.median).toBeNull();
  });
});

describe("toMarkdown", () => {
  it("5つの指標を、速さと不安定さに分けて表に出す", () => {
    const md = toMarkdown(
      computeMetrics([deploy("d1", 10, [commit("a", 8)])], period),
      period,
    );
    expect(md).toContain("| デプロイの頻度 | 1 回（1.0 回/週） |");
    expect(md).toContain("| 変更のリードタイム | 中央値 2.0 時間");
    expect(md).toContain("| 変更の失敗率 | 0.0%（0 / 1） |");
    expect(md).toContain("| 失敗したデプロイの復旧時間 | 該当なし |");
    expect(md).toContain("| デプロイの手戻り率 | 0.0%（0 / 1） |");
  });
});

describe("レビューの指摘（2026-11-25）", () => {
  it("GitHub の Revert ボタンが指す merge コミットも、失敗したデプロイとして見つける", () => {
    // merge コミットはリードタイムから外すが、revert の対象としては探せるように mergeShas に持つ
    const m = computeMetrics(
      [
        { ...deploy("d1", 10, [commit("abc1234", 9)]), mergeShas: ["fe12345"] },
        deploy("d2", 13, [
          commit(
            "rev",
            12,
            'Revert "Merge pull request #20"\n\nThis reverts commit fe12345.',
          ),
        ]),
      ],
      period,
    );
    expect(m.failedDeployments).toBe(1);
    expect(m.recoveryHours).toEqual([3]);
    // merge コミットはリードタイムに数えない
    expect(m.leadTimeHours.count).toBe(2);
  });

  it("本番に出る前に同じデプロイの中で戻したものは、失敗に数えない", () => {
    const m = computeMetrics(
      [
        deploy("d1", 10, [
          commit("badbad0", 8),
          commit("rev", 9, "Revert\n\nThis reverts commit badbad0."),
        ]),
      ],
      period,
    );
    expect(m.failedDeployments).toBe(0);
    expect(m.recoveryHours).toEqual([]);
  });

  it("デプロイの順番は完了の時刻ではなく作られた順（再実行で後ろに回らない）", () => {
    expect(
      orderRuns([
        { head_sha: "b", created_at: at(2), updated_at: at(3) },
        { head_sha: "a", created_at: at(1), updated_at: at(9) },
      ]).map((r) => r.head_sha),
    ).toEqual(["a", "b"]);
  });

  it("ページは、期間より前を振り返る分まで取ってから止める", () => {
    const from = Date.parse(at(100));
    const lookback = 30 * 24 * H;
    expect(needMorePages(at(100 - 24), from, lookback)).toBe(true);
    expect(needMorePages(at(100 - 31 * 24), from, lookback)).toBe(false);
  });

  it("集計する日数が正の数でなければ、何が悪いかを言って落ちる", () => {
    expect(parseDays(undefined)).toBe(30);
    expect(parseDays("14")).toBe(14);
    expect(() => parseDays("30日")).toThrow(/日数/);
    expect(() => parseDays("0")).toThrow(/日数/);
  });
});
