import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readZipEntries } from "@/scripts/fare/ingest/zip";

// fixtures/sample.zip は Python の zipfile で作ってある（独立した実装を正解に使う）。
// 中身は stored.txt（非圧縮）、deflated.txt（deflate）、feed/駅.txt（日本語名）。
const zip = readFileSync("scripts/fare/ingest/__tests__/fixtures/sample.zip");

describe("readZipEntries", () => {
  it("全エントリを名前で引ける", () => {
    const entries = readZipEntries(zip);
    expect([...entries.keys()].sort()).toEqual([
      "deflated.txt",
      "feed/駅.txt",
      "stored.txt",
    ]);
  });

  it("非圧縮のエントリを読める", () => {
    expect(readZipEntries(zip).get("stored.txt")?.toString("utf8")).toBe(
      "a,b\n1,2\n",
    );
  });

  it("deflate されたエントリを展開できる", () => {
    const text = readZipEntries(zip).get("deflated.txt")?.toString("utf8");
    expect(text?.startsWith("name\n高松築港\n")).toBe(true);
    expect(text?.split("\n").filter((l) => l === "高松築港")).toHaveLength(200);
  });

  it("日本語のファイル名を UTF-8 として読む", () => {
    expect(readZipEntries(zip).get("feed/駅.txt")?.toString("utf8")).toBe(
      "こんにちは",
    );
  });

  it("zip でないバイト列は例外にする", () => {
    expect(() => readZipEntries(Buffer.from("not a zip"))).toThrow();
  });
});
