import { describe, expect, it } from "vitest";
import { createFareCalculator } from "@/lib/fare/calculator";
import { fareRuleSchema } from "@/lib/fare/types";
import jrHonshu from "@/data/fare-rules/jr-honshu.json";
import generic from "@/data/fare-rules/generic-private.json";

const rules = [fareRuleSchema.parse(jrHonshu), fareRuleSchema.parse(generic)];
const calc = createFareCalculator(rules);

describe("FareCalculator", () => {
  it("km=0 は 0 円", () => {
    expect(calc.estimate("JR東日本", 0)).toBe(0);
  });

  it("JR東日本 10.3km（新宿→東京 相当）が実運賃 210 円の ±20% 以内", () => {
    const fare = calc.estimate("JR東日本", 10.3);
    expect(fare).toBeGreaterThanOrEqual(168);
    expect(fare).toBeLessThanOrEqual(252);
  });

  it("JR東日本 53.1km（新宿→高尾 相当）が実運賃 990 円の ±20% 以内", () => {
    const fare = calc.estimate("JR東日本", 53.1);
    expect(fare).toBeGreaterThanOrEqual(792);
    expect(fare).toBeLessThanOrEqual(1188);
  });

  it("表を超える距離は賃率で外挿し 10 円単位に丸める", () => {
    const fare = calc.estimate("JR東日本", 150);
    expect(fare).toBe(Math.ceil((1690 + 50 * 16.2) / 10) * 10);
  });

  it("未知の事業者はフォールバック表を使う", () => {
    expect(calc.estimate("謎電鉄", 5)).toBe(200);
  });
});
