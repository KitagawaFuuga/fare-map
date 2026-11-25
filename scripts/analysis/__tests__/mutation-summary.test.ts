import { describe, expect, it } from "vitest";
import {
  parseReport,
  summarize,
  toMarkdown,
} from "@/scripts/analysis/mutation-summary";

describe("summarize", () => {
  it("捕まえた割合を、捕まえた数と時間切れの数を見逃しと未実行を含めた数で割って出す", () => {
    const report = {
      files: {
        "lib/a.ts": {
          mutants: [
            { status: "Killed" },
            { status: "Killed" },
            { status: "Timeout" },
            { status: "Survived" },
            { status: "NoCoverage" },
            { status: "CompileError" },
          ],
        },
      },
    };
    const s = summarize(report);
    expect(s.total.score).toBeCloseTo(60);
    expect(s.total.survived).toBe(1);
    expect(s.total.noCoverage).toBe(1);
  });

  it("ファイルは、見逃しと未実行を合わせた数の多い順に並ぶ", () => {
    const report = {
      files: {
        "lib/few.ts": {
          mutants: [{ status: "Survived" }, { status: "Killed" }],
        },
        "lib/many.ts": {
          mutants: [
            { status: "Survived" },
            { status: "NoCoverage" },
            { status: "Survived" },
          ],
        },
        "lib/none.ts": { mutants: [{ status: "Killed" }] },
      },
    };
    expect(summarize(report).files.map((f) => f.path)).toEqual([
      "lib/many.ts",
      "lib/few.ts",
      "lib/none.ts",
    ]);
  });
});

describe("toMarkdown", () => {
  it("全体のスコアと、見逃しのあるファイルだけを上位から指定件数まで表にする", () => {
    const md = toMarkdown(
      summarize({
        files: {
          "lib/a.ts": {
            mutants: [
              { status: "Survived" },
              { status: "Survived" },
              { status: "Killed" },
              { status: "Killed" },
            ],
          },
          "lib/b.ts": {
            mutants: [
              { status: "Survived" },
              { status: "Survived" },
              { status: "Survived" },
            ],
          },
          "lib/c.ts": { mutants: [{ status: "NoCoverage" }] },
          "lib/ok.ts": { mutants: [{ status: "Killed" }] },
        },
      }),
      2,
    );
    expect(md).toContain("スコア: 33.3%");
    expect(md).toContain("| lib/b.ts | 0.0% | 3 | 0 |");
    expect(md).toContain("| lib/a.ts | 50.0% | 2 | 0 |");
    expect(md).not.toContain("lib/c.ts");
    expect(md).not.toContain("lib/ok.ts");
  });

  it("件数の上限に余裕があっても、見逃しの無いファイルは表に載らず、見出しは実際の件数になる", () => {
    const md = toMarkdown(
      summarize({
        files: {
          "lib/a.ts": { mutants: [{ status: "Survived" }] },
          "lib/ok.ts": { mutants: [{ status: "Killed" }] },
        },
      }),
      15,
    );
    expect(md).toContain("| lib/a.ts |");
    expect(md).not.toContain("lib/ok.ts");
    expect(md).toContain("上位 1 件");
  });

  it("見逃しが1件も無ければ、空の表ではなくその旨を出す", () => {
    const md = toMarkdown(
      summarize({
        files: { "lib/ok.ts": { mutants: [{ status: "Killed" }] } },
      }),
      15,
    );
    expect(md).toContain("見逃しはありません");
    expect(md).not.toContain("| ファイル |");
  });

  it("有効な壊し方が0件の実行は、スコアを 100% ではなく N/A と出す", () => {
    const md = toMarkdown(
      summarize({
        files: { "lib/a.ts": { mutants: [{ status: "CompileError" }] } },
      }),
      15,
    );
    expect(md).toContain("スコア: N/A");
  });
});

describe("parseReport", () => {
  it("files が無い JSON は、何が欠けているかを言って落ちる", () => {
    expect(() => parseReport({ schemaVersion: "2" })).toThrow(/files/);
  });

  it("mutants の status が文字列でないファイルがあれば落ちる", () => {
    expect(() =>
      parseReport({ files: { "lib/a.ts": { mutants: [{ status: 1 }] } } }),
    ).toThrow(/lib\/a\.ts/);
  });

  it("正しい形ならそのまま返す", () => {
    const r = { files: { "lib/a.ts": { mutants: [{ status: "Killed" }] } } };
    expect(parseReport(r)).toEqual(r);
  });
});
