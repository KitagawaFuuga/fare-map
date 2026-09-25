import { describe, expect, it } from "vitest";
import {
  articleTitles,
  csvLineKeys,
  normalizeLineKey,
  operatorLinePrefix,
} from "@/scripts/pipeline/fetch-station-km";

describe("operatorLinePrefix", () => {
  it("過半数の路線が持つ略称を返す", () => {
    expect(
      operatorLinePrefix([
        "近鉄名古屋線",
        "近鉄大阪線",
        "近鉄南大阪線",
        "近鉄奈良線",
        "生駒ケーブル",
      ]),
    ).toBe("近鉄");
  });

  it("空文字は全路線に前方一致するので選ばない", () => {
    expect(operatorLinePrefix(["東武伊勢崎線", "東武日光線"])).toBe("東武");
  });

  it("長い略称も拾う", () => {
    expect(
      operatorLinePrefix([
        "東京メトロ銀座線",
        "東京メトロ東西線",
        "東京メトロ南北線",
      ]),
    ).toBe("東京メトロ");
  });

  it("共通の略称が無ければ空を返す", () => {
    expect(operatorLinePrefix(["山手線", "内房線"])).toBe("");
  });

  it("路線が1本しかなければ空を返す（略称か路線名か決められない）", () => {
    expect(operatorLinePrefix(["万葉線"])).toBe("");
  });
});

describe("normalizeLineKey", () => {
  it("本線の有無を吸収する（JR北海道・JR東海は本を付けない）", () => {
    expect(normalizeLineKey("函館本線")).toBe(normalizeLineKey("函館線"));
  });

  it("括弧の区間表記を落とす", () => {
    expect(normalizeLineKey("函館本線（函館～長万部）")).toBe("函館線");
  });
});

describe("csvLineKeys", () => {
  it("束ねられた路線名を分解する", () => {
    expect(csvLineKeys("南大阪線・吉野線")).toEqual(["南大阪線", "吉野線"]);
  });

  it("単独の路線名はそのまま1つ返す", () => {
    expect(csvLineKeys("名古屋線")).toEqual(["名古屋線"]);
  });
});

describe("articleTitles", () => {
  it("略称を正式な事業者名に置き換えた候補も返す", () => {
    expect(articleTitles("富山地鉄本線", "富山地方鉄道", "富山地鉄")).toContain(
      "富山地方鉄道本線",
    );
  });

  it("JR は接頭辞を落とした1つだけ（正式名も路線名のみ）", () => {
    expect(articleTitles("JR山手線", "JR東日本", "JR")).toEqual(["山手線"]);
  });

  it("通称と正式名が別物の路線は別名を最初に試す", () => {
    expect(articleTitles("熊本電鉄本線", "熊本電気鉄道", "熊本電鉄")[0]).toBe(
      "熊本電気鉄道菊池線",
    );
  });

  it("括弧の区間表記は落とす", () => {
    expect(articleTitles("函館本線（函館～長万部）", "JR北海道", "JR")).toEqual(
      ["函館本線"],
    );
  });

  it("略称が無い事業者は候補1つ", () => {
    expect(articleTitles("万葉線", "万葉線", "")).toEqual(["万葉線"]);
  });
});
