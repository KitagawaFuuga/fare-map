import { describe, expect, it } from "vitest";
import { parseGtfsCsv } from "@/scripts/fare/ingest/csv";

describe("parseGtfsCsv", () => {
  it("ヘッダを見出しにして行を引ける", () => {
    expect(parseGtfsCsv("a,b\n1,2\n3,4\n")).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("引用符の中のカンマで区切らない", () => {
    expect(parseGtfsCsv('a,b\n"x,y",z\n')).toEqual([{ a: "x,y", b: "z" }]);
  });

  it("引用符の中の二重引用符を1つに戻す", () => {
    expect(parseGtfsCsv('a\n"say ""hi"""\n')).toEqual([{ a: 'say "hi"' }]);
  });

  it("引用符の中の改行を1つのセルとして扱う", () => {
    expect(parseGtfsCsv('a,b\n"1\n2",3\n')).toEqual([{ a: "1\n2", b: "3" }]);
  });

  it("CRLF と BOM を取り除く", () => {
    expect(parseGtfsCsv("﻿a,b\r\n1,2\r\n")).toEqual([{ a: "1", b: "2" }]);
  });

  it("列が足りない行は空文字で埋める", () => {
    expect(parseGtfsCsv("a,b,c\n1,2\n")).toEqual([{ a: "1", b: "2", c: "" }]);
  });

  it("末尾の空行は行にしない", () => {
    expect(parseGtfsCsv("a\n1\n\n")).toEqual([{ a: "1" }]);
  });
});
