import { describe, expect, it } from "vitest";
import {
  parseManifest,
  summarize,
  toMarkdown,
} from "@/scripts/analysis/lighthouse-summary";

const lhr = (lcp: number, cls: number, tbt: number) => ({
  audits: {
    "largest-contentful-paint": { numericValue: lcp },
    "cumulative-layout-shift": { numericValue: cls },
    "total-blocking-time": { numericValue: tbt },
  },
});

const entry = (jsonPath: string, representative: boolean, perf: number) => ({
  url: "http://127.0.0.1:3200/",
  isRepresentativeRun: representative,
  jsonPath,
  summary: { performance: perf },
});

describe("summarize", () => {
  it("代表の回（中央値の回）の値を使い、ほかの回は使わない", () => {
    const manifest = [
      entry("a.json", false, 0.5),
      entry("b.json", true, 0.92),
      entry("c.json", false, 0.99),
    ];
    const reports: Record<string, unknown> = {
      "a.json": lhr(9000, 0.5, 900),
      "b.json": lhr(2100, 0.02, 150),
      "c.json": lhr(1000, 0, 0),
    };
    const rows = summarize(manifest, (p) => reports[p]);
    expect(rows).toEqual([
      {
        url: "http://127.0.0.1:3200/",
        performance: 92,
        lcpMs: 2100,
        cls: 0.02,
        tbtMs: 150,
      },
    ]);
  });

  it("代表の回が無い URL があれば落ちる（測れていないのに表が空で通らないように）", () => {
    expect(() =>
      summarize([entry("a.json", false, 0.9)], () => lhr(1, 0, 0)),
    ).toThrow(/代表の回/);
  });
});

describe("parseManifest", () => {
  it("jsonPath が無い形なら、どこが違うかを言って落ちる", () => {
    expect(() =>
      parseManifest([{ url: "x", isRepresentativeRun: true, summary: {} }]),
    ).toThrow(/jsonPath/);
  });

  it("空の配列なら落ちる（1回も測れていない）", () => {
    expect(() => parseManifest([])).toThrow(/1件も/);
  });
});

describe("toMarkdown", () => {
  it("基準を外れた値に印を付ける（LCP 2.5秒・CLS 0.1・TBT 200ms・スコア 90）", () => {
    const md = toMarkdown([
      {
        url: "http://127.0.0.1:3200/",
        performance: 85,
        lcpMs: 3100,
        cls: 0.05,
        tbtMs: 250,
      },
    ]);
    expect(md).toContain(
      "| http://127.0.0.1:3200/ | 85 ⚠ | 3.10 s ⚠ | 0.050 | 250 ms ⚠ |",
    );
  });

  it("基準内の値には印を付けない", () => {
    const md = toMarkdown([
      { url: "/", performance: 95, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
    ]);
    expect(md).toContain("| / | 95 | 2.50 s | 0.100 | 200 ms |");
    const row = md.split("\n").find((l) => l.startsWith("| / |"));
    expect(row).not.toContain("⚠");
  });
});

describe("レビューの指摘（2026-11-25）", () => {
  it("代表の回のスコアが無い（Lighthouse の失敗）なら、0 と出さずに落ちる", () => {
    const manifest = [
      {
        url: "http://127.0.0.1:3200/",
        isRepresentativeRun: true,
        jsonPath: "a.json",
        summary: { performance: null },
      },
    ];
    expect(() =>
      summarize(parseManifest(manifest), () => lhr(1000, 0, 0)),
    ).toThrow(/スコア/);
  });
});
