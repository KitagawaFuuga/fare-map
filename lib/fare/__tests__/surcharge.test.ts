import { describe, expect, it } from "vitest";
import {
  surchargeAmount,
  surchargePairAmount,
  surchargeSchema,
  type Surcharge,
} from "@/lib/fare/surcharge";

// 近鉄鳥羽線の実表
const toba: Surcharge = {
  id: "toba",
  operator: "近畿日本鉄道",
  lines: ["近鉄鳥羽線"],
  table: [
    [6, 10],
    [12, 20],
    [14, 30],
  ],
  beyond: 30,
};

describe("surchargeAmount", () => {
  it("帯の中の距離に対応する額を返す", () => {
    expect(surchargeAmount(toba, 5)).toBe(10);
    expect(surchargeAmount(toba, 8)).toBe(20);
    expect(surchargeAmount(toba, 13.2)).toBe(30);
  });

  it("帯の上限を足し算の誤差でわずかに超えただけなら、その帯の額", () => {
    // 駅間キロを足す順番で 6 が 6.000000000000001 になる
    expect(surchargeAmount(toba, 6.000000000000001)).toBe(10);
  });

  it("帯の上限ちょうどは その帯の額", () => {
    expect(surchargeAmount(toba, 6)).toBe(10);
    expect(surchargeAmount(toba, 12)).toBe(20);
  });

  it("表を超える距離は beyond", () => {
    expect(surchargeAmount(toba, 20)).toBe(30);
  });

  // 加算対象の線に1mも乗っていなければ加算は起きない。
  // ここを 0 にしないと、対象外の区間にまで加算が乗る
  it("距離が0なら加算しない", () => {
    expect(surchargeAmount(toba, 0)).toBe(0);
  });

  it("負の距離も加算しない", () => {
    expect(surchargeAmount(toba, -1)).toBe(0);
  });

  it("端数は切り上げずそのまま帯に当てる（0.1kmは最初の帯）", () => {
    expect(surchargeAmount(toba, 0.1)).toBe(10);
  });
});

// 名鉄の加算運賃は距離の関数になっていない（知多新線は富貴→野間 7.0km が60円、
// 上野間→内海 11.5km が50円で、長いほうが安い）。駅間表で引く。
const chita: Surcharge = {
  id: "chita",
  operator: "名古屋鉄道",
  lines: ["名鉄知多新線"],
  pairs: [
    { from: "富貴", to: "野間", amount: 60 },
    { from: "上野間", to: "内海", amount: 50 },
  ],
};

describe("surchargePairAmount", () => {
  it("乗り入れ駅と降りた駅の組で引く", () => {
    expect(surchargePairAmount(chita, "富貴", "野間")).toBe(60);
  });

  it("方向が逆でも同じ額", () => {
    expect(surchargePairAmount(chita, "野間", "富貴")).toBe(60);
  });

  it("距離が長いほうが安い組も表どおりに引ける", () => {
    expect(surchargePairAmount(chita, "上野間", "内海")).toBe(50);
  });

  it("表に無い組は加算しない", () => {
    expect(surchargePairAmount(chita, "富貴", "内海")).toBe(0);
  });

  it("その路線に乗っていなければ加算しない", () => {
    expect(surchargePairAmount(chita, undefined, undefined)).toBe(0);
    expect(surchargePairAmount(chita, "富貴", undefined)).toBe(0);
  });

  it("同じ駅で乗り降りしていれば加算しない", () => {
    expect(surchargePairAmount(chita, "富貴", "富貴")).toBe(0);
  });
});

describe("surchargeAmount（距離帯の表が無い定義）", () => {
  it("駅間表式の定義に距離で聞いても加算しない", () => {
    expect(surchargeAmount(chita, 5)).toBe(0);
  });
});

describe("surchargePairAmount（組の突き合わせ）", () => {
  // 野間は富貴→野間の降りる側、内海は上野間→内海の降りる側。
  // 片方の駅だけ合う組を拾うと 60 か 50 が乗る
  it("片方の駅だけ合う組は引かない", () => {
    expect(surchargePairAmount(chita, "野間", "内海")).toBe(0);
    // 降りた富貴は富貴→野間の乗る側。内海と富貴の組は表に無い
    expect(surchargePairAmount(chita, "内海", "富貴")).toBe(0);
  });

  it("同じ駅の組が表にあっても、同じ駅での乗り降りは加算しない", () => {
    const withSelf: Surcharge = {
      ...chita,
      pairs: [{ from: "富貴", to: "富貴", amount: 99 }],
    };
    expect(surchargePairAmount(withSelf, "富貴", "富貴")).toBe(0);
  });

  it("距離帯式の定義に駅の組で聞いても加算しない", () => {
    expect(surchargePairAmount(toba, "鳥羽", "五十鈴川")).toBe(0);
  });
});

function issuesOf(
  input: unknown,
): { code: string; path: PropertyKey[]; message: string }[] {
  const result = surchargeSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((i) => ({
    code: i.code,
    path: i.path,
    message: i.message,
  }));
}

const eitherMessage = (id: string) =>
  `surchargeSchema: table+beyond か pairs のどちらか一方が必要です (id="${id}")`;
const ascendingMessage = (id: string) =>
  `surchargeSchema: table は昇順である必要があります (id="${id}")`;

describe("surchargeSchema", () => {
  it("距離帯式の定義は、書いた項目をすべて残して通す", () => {
    const keihanna = {
      ...toba,
      id: "keihanna",
      lines: ["近鉄けいはんな線"],
      stations: ["長田", "生駒"],
      pending: true,
      source: {
        url: "https://example.com",
        fetchedAt: "2026-01-01",
        note: "n",
      },
    };
    expect(surchargeSchema.parse(keihanna)).toEqual(keihanna);
  });

  it("駅間表式の定義は、組の中身も残して通す", () => {
    expect(surchargeSchema.parse(chita)).toEqual(chita);
  });

  it("table+beyond も pairs も無いと通さない", () => {
    expect(issuesOf({ id: "x", operator: "o", lines: [] })).toEqual([
      { code: "custom", path: [], message: eitherMessage("x") },
    ]);
  });

  it("table+beyond と pairs の両方があると通さない", () => {
    expect(issuesOf({ ...toba, pairs: chita.pairs })).toEqual([
      { code: "custom", path: [], message: eitherMessage("toba") },
    ]);
  });

  it("table だけで beyond が無いと通さない", () => {
    const noBeyond = { ...toba, beyond: undefined };
    expect(issuesOf(noBeyond)).toEqual([
      { code: "custom", path: [], message: eitherMessage("toba") },
    ]);
  });

  it("beyond だけで table が無いと通さない", () => {
    const noTable = { ...toba, table: undefined };
    expect(issuesOf(noTable)).toEqual([
      { code: "custom", path: [], message: eitherMessage("toba") },
    ]);
  });

  // 同じ上限が2つ並ぶと、後ろの帯に当たる距離が無くなる
  it("上限が前の帯と同じか小さい帯を、その位置で指摘する", () => {
    const table: [number, number][] = [
      [6, 10],
      [12, 20],
      [12, 30],
      [10, 40],
    ];
    expect(issuesOf({ ...toba, table })).toEqual([
      {
        code: "custom",
        path: ["table", 2, 0],
        message: ascendingMessage("toba"),
      },
      {
        code: "custom",
        path: ["table", 3, 0],
        message: ascendingMessage("toba"),
      },
    ]);
  });

  it("帯が1つだけの表は通す", () => {
    expect(issuesOf({ ...toba, table: [[6, 10]] })).toEqual([]);
  });
});
