import { describe, expect, it } from "vitest";
import { sheetNext } from "@/lib/sheet";

describe("sheetNext", () => {
  it("collapsed → up → half → up → full", () => {
    expect(sheetNext("collapsed", "up")).toBe("half");
    expect(sheetNext("half", "up")).toBe("full");
  });
  it("full → down → half → down → collapsed", () => {
    expect(sheetNext("full", "down")).toBe("half");
    expect(sheetNext("half", "down")).toBe("collapsed");
  });
  it("端では変化しない", () => {
    expect(sheetNext("full", "up")).toBe("full");
    expect(sheetNext("collapsed", "down")).toBe("collapsed");
  });
});
