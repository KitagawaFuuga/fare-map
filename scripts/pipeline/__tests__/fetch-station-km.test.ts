import { describe, expect, it } from "vitest";
import {
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
