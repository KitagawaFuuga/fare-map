import { describe, expect, it } from "vitest";
import {
  csvOperatorOf,
  operatorAliasesSchema,
} from "@/lib/graph/operator-alias";

const aliases = [
  { graph: "東京メトロ", csv: "東京地下鉄", sections: 180 },
  { graph: "京急電鉄", csv: "京浜急行電鉄", sections: 72 },
];

describe("csvOperatorOf", () => {
  it("対応表にあるグラフ側の名前は、実営業キロ側の名前に直す", () => {
    expect(csvOperatorOf(aliases, "京急電鉄")).toBe("京浜急行電鉄");
  });

  it("対応表に無い名前はそのまま返す", () => {
    expect(csvOperatorOf(aliases, "東武鉄道")).toBe("東武鉄道");
  });

  it("実営業キロ側の名前で引いても直さない", () => {
    expect(csvOperatorOf(aliases, "東京地下鉄")).toBe("東京地下鉄");
  });
});

describe("operatorAliasesSchema", () => {
  it("書いた項目をすべて残して通す", () => {
    const file = {
      aliases,
      source: {
        url: "https://example.com",
        fetchedAt: "2026-01-01",
        note: "n",
      },
    };
    expect(operatorAliasesSchema.parse(file)).toEqual(file);
  });

  it("裏取りの区間数が0の対応は通さない", () => {
    expect(
      operatorAliasesSchema.safeParse({
        aliases: [{ graph: "a", csv: "b", sections: 0 }],
        source: { url: "u", fetchedAt: "f", note: "n" },
      }).success,
    ).toBe(false);
  });
});
