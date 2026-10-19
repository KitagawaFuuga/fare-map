import { describe, expect, it } from "vitest";
import { extractTables } from "@/scripts/fare/ingest/html-table";

describe("extractTables", () => {
  it("行と列を二次元配列にする", () => {
    const html =
      "<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>";
    expect(extractTables(html)).toEqual([
      [
        ["a", "b"],
        ["c", "d"],
      ],
    ]);
  });

  it("th も値として拾う", () => {
    expect(
      extractTables("<table><tr><th>見出し</th><td>値</td></tr></table>"),
    ).toEqual([[["見出し", "値"]]]);
  });

  it("colspan を同じ値で横に展開する", () => {
    const html =
      '<table><tr><td colspan="3">x</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>';
    expect(extractTables(html)[0]?.[0]).toEqual(["x", "x", "x"]);
  });

  it("rowspan を同じ値で縦に展開し、次の行の列位置をずらさない", () => {
    // 1列目が2行にまたがるので、2行目の "b" は2列目に来なければならない
    const html =
      '<table><tr><td rowspan="2">共有</td><td>a</td></tr><tr><td>b</td></tr></table>';
    expect(extractTables(html)).toEqual([
      [
        ["共有", "a"],
        ["共有", "b"],
      ],
    ]);
  });

  it("rowspan と colspan が同時にかかっても位置が崩れない", () => {
    const html =
      '<table><tr><td rowspan="2" colspan="2">大</td><td>a</td></tr><tr><td>b</td></tr></table>';
    expect(extractTables(html)).toEqual([
      [
        ["大", "大", "a"],
        ["大", "大", "b"],
      ],
    ]);
  });

  it("セルの中のタグを落として文字だけ返す", () => {
    const html =
      '<table><tr><td><a href="/wiki/x" title="千葉駅">千葉駅</a><sup>[1]</sup></td></tr></table>';
    expect(extractTables(html)[0]?.[0]?.[0]).toBe("千葉駅[1]");
  });

  it("実体参照を戻し、前後の空白を落とす", () => {
    expect(
      extractTables(
        "<table><tr><td> &amp;&nbsp;&lt;x&gt; </td></tr></table>",
      )[0]?.[0]?.[0],
    ).toBe("& <x>");
  });

  it("入れ子の表は外側と内側を別の表として返す", () => {
    const html =
      "<table><tr><td><table><tr><td>内</td></tr></table></td></tr></table>";
    const tables = extractTables(html);
    expect(tables.length).toBe(2);
    expect(tables.some((t) => t[0]?.[0] === "内")).toBe(true);
  });

  it("表が無ければ空配列", () => {
    expect(extractTables("<p>なし</p>")).toEqual([]);
  });
});
