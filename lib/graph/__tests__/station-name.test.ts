import { describe, expect, it } from "vitest";
import { buildNameLookup, matchKey } from "@/lib/graph/station-name";

describe("matchKey", () => {
  it("ヶ と ケ を同じに扱う（箱根ヶ崎 と 箱根ケ崎）", () => {
    expect(matchKey("箱根ヶ崎")).toBe(matchKey("箱根ケ崎"));
    expect(matchKey("霞ヶ関")).toBe(matchKey("霞ケ関"));
  });

  it("全角の英数字を半角に寄せる（ＪＲ松山駅前）", () => {
    expect(matchKey("ＪＲ松山駅前")).toBe(matchKey("JR松山駅前"));
    expect(matchKey("羽田空港第１・第２ターミナル")).toBe(
      matchKey("羽田空港第1・第2ターミナル"),
    );
  });

  it("かっこ書きの副名称を落とす（明治神宮前〈原宿〉）", () => {
    expect(matchKey("明治神宮前〈原宿〉")).toBe(matchKey("明治神宮前"));
    expect(matchKey("押上（スカイツリー前）")).toBe(matchKey("押上"));
  });

  it("末尾の駅を落とす（松山市駅）", () => {
    expect(matchKey("松山市駅")).toBe(matchKey("松山市"));
  });

  it("別の駅を同じ名前に潰さない", () => {
    expect(matchKey("新宿")).not.toBe(matchKey("新宿三丁目"));
    expect(matchKey("大阪")).not.toBe(matchKey("大阪難波"));
  });

  it("駅だけの名前を空にしない（丸ごと消すと全駅に一致してしまう）", () => {
    expect(matchKey("駅")).not.toBe("");
  });
});

describe("buildNameLookup", () => {
  it("資料側の表記からグラフ側の表記を引ける", () => {
    const lookup = buildNameLookup([
      "箱根ケ崎",
      "松山市",
      "押上（スカイツリー前）",
    ]);
    expect(lookup.get(matchKey("箱根ヶ崎"))).toBe("箱根ケ崎");
    expect(lookup.get(matchKey("松山市駅"))).toBe("松山市");
    expect(lookup.get(matchKey("押上"))).toBe("押上（スカイツリー前）");
  });

  it("同じ鍵に2駅以上が当たる場合はその鍵を捨てる", () => {
    // 万一潰れたときに、どちらか一方を黙って選ばない
    const lookup = buildNameLookup(["甲ヶ丘", "甲ケ丘"]);
    expect(lookup.has(matchKey("甲ヶ丘"))).toBe(false);
  });
});
