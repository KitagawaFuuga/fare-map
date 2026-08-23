import { describe, expect, it } from "vitest";
import {
  BRACKETS,
  BRACKET_COLORS,
  bracketLabel,
  bracketOf,
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
  it("ラベルが生成される", () => {
    expect(bracketLabel(0)).toBe("〜500円");
    expect(bracketLabel(BRACKETS.length)).toBe("5000円超");
  });
});
