import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  fareOverrideSchema,
  fareRuleSchema,
  fareZoneSchema,
} from "@/lib/fare/types";

const source = {
  url: "https://example.com",
  fetchedAt: "2026-01-01",
  note: "n",
};
const beyond = { fromKm: 3, baseFare: 300, ratePerKm: 10 };

function issuesOf(
  result: { success: true } | { success: false; error: z.ZodError },
): { code: string; path: PropertyKey[]; message: string }[] {
  if (result.success) return [];
  return result.error.issues.map((i) => ({
    code: i.code,
    path: i.path,
    message: i.message,
  }));
}

describe("fareRuleSchema", () => {
  const rule = {
    id: "r",
    operators: ["甲鉄道"],
    table: [
      [1, 150],
      [3, 300],
    ],
    localTable: [
      [1, 160],
      [3, 310],
    ],
    beyond,
    source,
  };

  it("書いた項目をすべて残して通す", () => {
    expect(fareRuleSchema.parse(rule)).toEqual(rule);
  });

  it("table の上限が前の行と同じか小さければ、その行を指摘する", () => {
    const table = [
      [1, 150],
      [3, 300],
      [3, 310],
      [2, 320],
    ];
    expect(issuesOf(fareRuleSchema.safeParse({ ...rule, table }))).toEqual([
      {
        code: "custom",
        path: ["table", 2, 0],
        message:
          'fareRuleSchema: table は maxKm の厳密な昇順である必要があります (id="r"): table[1].maxKm=3 >= table[2].maxKm=3',
      },
      {
        code: "custom",
        path: ["table", 3, 0],
        message:
          'fareRuleSchema: table は maxKm の厳密な昇順である必要があります (id="r"): table[2].maxKm=3 >= table[3].maxKm=2',
      },
    ]);
  });

  it("localTable も同じく昇順を確かめる", () => {
    const localTable = [
      [5, 160],
      [4, 310],
    ];
    expect(issuesOf(fareRuleSchema.safeParse({ ...rule, localTable }))).toEqual(
      [
        {
          code: "custom",
          path: ["localTable", 1, 0],
          message:
            'fareRuleSchema: localTable は maxKm の厳密な昇順である必要があります (id="r"): localTable[0].maxKm=5 >= localTable[1].maxKm=4',
        },
      ],
    );
  });

  it("localTable が無くても通す", () => {
    const { localTable: _omit, ...withoutLocal } = rule;
    void _omit;
    expect(fareRuleSchema.safeParse(withoutLocal).success).toBe(true);
  });
});

describe("fareOverrideSchema", () => {
  const override = {
    operator: "甲鉄道",
    pairs: [{ from: "A", to: "B", fare: 200 }],
    source,
  };

  it("書いた項目をすべて残して通す", () => {
    expect(fareOverrideSchema.parse(override)).toEqual(override);
  });

  it("運賃が正の整数でなければ通さない", () => {
    for (const fare of [0, -10, 150.5]) {
      expect(
        fareOverrideSchema.safeParse({
          ...override,
          pairs: [{ from: "A", to: "B", fare }],
        }).success,
      ).toBe(false);
    }
  });
});

describe("fareZoneSchema", () => {
  const zone = {
    id: "z",
    operator: "甲鉄道",
    stations: ["A", "B"],
    table: [
      [1, 140],
      [3, 280],
    ],
    beyond,
    source,
  };

  it("書いた項目をすべて残して通す", () => {
    expect(fareZoneSchema.parse(zone)).toEqual(zone);
  });

  it("駅が1つも無い区間は通さない", () => {
    expect(fareZoneSchema.safeParse({ ...zone, stations: [] }).success).toBe(
      false,
    );
  });

  it("table の上限が前の行と同じか小さければ、その行を指摘する", () => {
    const table = [
      [1, 140],
      [3, 280],
      [3, 290],
      [2, 300],
    ];
    const message =
      'fareZoneSchema: table は maxKm の厳密な昇順である必要があります (id="z")';
    expect(issuesOf(fareZoneSchema.safeParse({ ...zone, table }))).toEqual([
      { code: "custom", path: ["table", 2, 0], message },
      { code: "custom", path: ["table", 3, 0], message },
    ]);
  });

  it("行が1つだけの table は通す", () => {
    expect(
      fareZoneSchema.safeParse({ ...zone, table: [[1, 140]] }).success,
    ).toBe(true);
  });
});
