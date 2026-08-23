import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/graph/csv";

describe("parseCsv", () => {
  it("ヘッダ行をキーにしてパースする", () => {
    const rows = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
    expect(rows).toEqual([
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "6" },
    ]);
  });

  it("e_status が 0 以外の行（廃止駅等）を除外する", () => {
    const rows = parseCsv("id,e_status\nx,0\ny,2\n");
    expect(rows).toEqual([{ id: "x", e_status: "0" }]);
  });

  it("空行を無視する", () => {
    expect(parseCsv("a\n1\n\n")).toEqual([{ a: "1" }]);
  });
});
