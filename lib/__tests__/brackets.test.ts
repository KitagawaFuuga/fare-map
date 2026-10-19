import { describe, expect, it } from "vitest";
import {
  BRACKETS,
  BRACKET_COLORS,
  bracketLabel,
  bracketOf,
  groupByBracket,
} from "@/lib/brackets";

describe("brackets", () => {
  it("境界値: 500 円は bracket 0、501 円は bracket 1", () => {
    expect(bracketOf(500)).toBe(0);
    expect(bracketOf(501)).toBe(1);
  });
  it("最大段階を超えた運賃は最後の bracket", () => {
    expect(bracketOf(99999)).toBe(BRACKETS.length);
  });
  it("色は段階数 + 1 個ある", () => {
    expect(BRACKET_COLORS).toHaveLength(BRACKETS.length + 1);
  });
  it("運賃が高い段階ほど色が暗い（順序のある量なので、虹色ではなく1色の濃淡で表す）", () => {
    // sRGB の相対輝度（WCAG の定義）
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ls = BRACKET_COLORS.map(luminance);
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeLessThan(ls[i - 1]!);
  });
  it("どの段階も橙〜茶の暖色で、背景地図の水域（青）や公園（緑）と色相が重ならない", () => {
    for (const hex of BRACKET_COLORS) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(r).toBeGreaterThan(g!);
      expect(g).toBeGreaterThan(b!);
    }
  });
  it("駅を運賃の段階ごとにまとめ、安い段階から並べる（駅のない段階は出さず、段階内の順は保つ）", () => {
    const stations = [
      { name: "A", bracket: 2 },
      { name: "B", bracket: 0 },
      { name: "C", bracket: 2 },
      { name: "D", bracket: 0 },
    ];
    expect(groupByBracket(stations)).toEqual([
      { bracket: 0, stations: [stations[1], stations[3]] },
      { bracket: 2, stations: [stations[0], stations[2]] },
    ]);
  });
  it("ラベルが生成される", () => {
    expect(bracketLabel(0)).toBe("〜500円");
    expect(bracketLabel(BRACKETS.length)).toBe("5000円超");
  });
});
