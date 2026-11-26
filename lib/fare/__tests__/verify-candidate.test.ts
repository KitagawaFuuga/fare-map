import { describe, expect, it } from "vitest";
import {
  verifyFareCandidate,
  type CandidatePair,
  type Finding,
} from "@/lib/fare/verify-candidate";

// 距離を返さない文脈。距離に依存しない検査だけを見たいとき用。
const noKm = { kmBetween: () => null };

const errors = (findings: Finding[], check: string) =>
  findings.filter((f) => f.severity === "error" && f.check === check);

describe("対称性", () => {
  it("同じ駅ペアが違う運賃で二度現れたらエラーにする", () => {
    const findings = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: [
          { from: "A", to: "B", fare: 200 },
          { from: "B", to: "A", fare: 250 },
        ],
      },
      noKm,
    );
    expect(errors(findings, "symmetry")).toHaveLength(1);
    expect(errors(findings, "symmetry")[0]?.samples.join()).toContain("A");
  });

  it("同じ駅ペアが同じ運賃なら所見を出さない", () => {
    const findings = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: [
          { from: "A", to: "B", fare: 200 },
          { from: "B", to: "A", fare: 200 },
        ],
      },
      noKm,
    );
    expect(errors(findings, "symmetry")).toHaveLength(0);
  });
});

describe("欠落ペア", () => {
  it("全組み合わせに満たない場合は警告する", () => {
    // 3駅なら C(3,2)=3 ペアあるはずだが 2 ペアしかない
    const findings = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: [
          { from: "A", to: "B", fare: 200 },
          { from: "B", to: "C", fare: 200 },
        ],
      },
      noKm,
    );
    const f = findings.filter((x) => x.check === "missing-pairs");
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("warn");
    expect(f[0]?.samples.join()).toContain("C");
  });

  it("全組み合わせが揃っていれば所見を出さない", () => {
    const findings = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: [
          { from: "A", to: "B", fare: 200 },
          { from: "B", to: "C", fare: 200 },
          { from: "A", to: "C", fare: 300 },
        ],
      },
      noKm,
    );
    expect(findings.filter((x) => x.check === "missing-pairs")).toHaveLength(0);
  });
});

describe("運賃額の所属", () => {
  it("公式の運賃額一覧に無い値はエラーにする", () => {
    const findings = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: [
          { from: "A", to: "B", fare: 200 },
          { from: "A", to: "C", fare: 237 },
          { from: "B", to: "C", fare: 300 },
        ],
      },
      { ...noKm, allowedFares: [200, 300, 400] },
    );
    const f = errors(findings, "fare-not-allowed");
    expect(f).toHaveLength(1);
    expect(f[0]?.samples.join()).toContain("237");
  });

  it("一覧を渡さなければこの検査は行わない", () => {
    const findings = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: [{ from: "A", to: "B", fare: 237 }],
      },
      noKm,
    );
    expect(findings.filter((x) => x.check === "fare-not-allowed")).toHaveLength(
      0,
    );
  });
});

describe("距離単調性", () => {
  // 一直線に並ぶ駅。駅間隔は不均一にする。等間隔かつ運賃が距離に完全比例する表は
  // 駅を1つずらしても単調性が保たれてしまい（運賃が1区間ぶん平行移動するだけ）、
  // 実在の路線から乖離する。
  const line = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const cumulative = [0, 1.2, 3.5, 4.1, 7.8, 9.0, 13.4, 14.2, 19.6, 21.0];
  const pos = new Map(line.map((n, i) => [n, cumulative[i] as number]));
  const kmBetween = (a: string, b: string) => {
    const x = pos.get(a);
    const y = pos.get(b);
    return x === undefined || y === undefined ? null : Math.abs(x - y);
  };
  const allPairs = (fare: (km: number) => number) => {
    const pairs = [];
    for (let i = 0; i < line.length; i++)
      for (let j = i + 1; j < line.length; j++)
        pairs.push({
          from: line[i] as string,
          to: line[j] as string,
          fare: fare((cumulative[j] as number) - (cumulative[i] as number)),
        });
    return pairs;
  };

  it("距離に対して単調な運賃表では所見を出さない", () => {
    const findings = verifyFareCandidate(
      { operator: "テスト鉄道", pairs: allPairs((km) => 100 + km * 50) },
      { kmBetween },
    );
    expect(errors(findings, "distance-monotonicity")).toHaveLength(0);
  });

  it("運賃が距離をほとんど区別しない場合は「検査が無力」と警告する", () => {
    // 路面電車の均一運賃。距離を変えても運賃が動かないので、行がずれても
    // 距離単調性では見抜けない。所見なしを「検証できた」と誤読させないため、
    // 無力であること自体を所見として出す。
    const findings = verifyFareCandidate(
      { operator: "テスト軌道", pairs: allPairs(() => 200) },
      { kmBetween },
    );
    const f = findings.filter((x) => x.check === "distance-check-ineffective");
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("warn");
  });

  it("距離で運賃が動く表では「検査が無力」とは言わない", () => {
    const findings = verifyFareCandidate(
      { operator: "テスト鉄道", pairs: allPairs((km) => 100 + km * 50) },
      { kmBetween },
    );
    expect(
      findings.filter((x) => x.check === "distance-check-ineffective"),
    ).toHaveLength(0);
  });

  it("距離が離れるほど安くなる駅を検出する", () => {
    // D 発の運賃だけ距離に逆行させる
    const pairs = allPairs((km) => 100 + km * 50).map((p) =>
      p.from === "D" || p.to === "D"
        ? { ...p, fare: 1000 - (kmBetween(p.from, p.to) ?? 0) * 50 }
        : p,
    );
    const findings = verifyFareCandidate(
      { operator: "テスト鉄道", pairs },
      { kmBetween },
    );
    const f = errors(findings, "distance-monotonicity");
    expect(f.length).toBeGreaterThan(0);
    expect(f.map((x) => x.samples.join()).join()).toContain("D");
  });

  it("均一運賃の路線が混ざっていると、その駅を名指しして警告する", () => {
    // ODPT の都営で実際にあった構造。地下鉄4線(距離制)と都電荒川線(均一170円)が
    // 同じ事業者にあり、両者をまたぐ運賃ペアは存在しない。全体で見ると地下鉄の
    // ペアに薄められて、荒川線の870ペアが検証されないまま所見なしで通る。
    const tram = ["P", "Q", "R", "S", "T"];
    const tramPos = new Map(tram.map((n, i) => [n, i * 1.5]));
    const mixedKm = (a: string, b: string) => {
      const t1 = tramPos.get(a);
      const t2 = tramPos.get(b);
      if (t1 !== undefined && t2 !== undefined) return Math.abs(t1 - t2);
      if (t1 !== undefined || t2 !== undefined) return null; // 線をまたぐ運賃は無い
      return kmBetween(a, b);
    };
    const pairs = [...allPairs((km) => 100 + km * 50)];
    for (let i = 0; i < tram.length; i++)
      for (let j = i + 1; j < tram.length; j++)
        pairs.push({
          from: tram[i] as string,
          to: tram[j] as string,
          fare: 170,
        });

    const findings = verifyFareCandidate(
      { operator: "テスト交通局", pairs },
      { kmBetween: mixedKm },
    );
    const f = findings.filter((x) => x.check === "unverifiable-stations");
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("warn");
    expect(f[0]?.samples.join()).toMatch(/[PQRST]/);
  });

  it("全駅の運賃が距離で動くなら駅名指しの警告は出さない", () => {
    const findings = verifyFareCandidate(
      { operator: "テスト鉄道", pairs: allPairs((km) => 100 + km * 50) },
      { kmBetween },
    );
    expect(
      findings.filter((x) => x.check === "unverifiable-stations"),
    ).toHaveLength(0);
  });

  it("表全体が無力なら全体の警告だけ出し、駅名指しは重ねない", () => {
    const findings = verifyFareCandidate(
      { operator: "テスト軌道", pairs: allPairs(() => 200) },
      { kmBetween },
    );
    expect(
      findings.filter((x) => x.check === "distance-check-ineffective"),
    ).toHaveLength(1);
    expect(
      findings.filter((x) => x.check === "unverifiable-stations"),
    ).toHaveLength(0);
  });

  it("逆行の多い駅が多ければ、例は5駅までにする", () => {
    // 遠いほど安い表。10駅すべてが逆行する
    const [f] = verifyFareCandidate(
      { operator: "テスト鉄道", pairs: allPairs((km) => 1000 - km * 10) },
      { kmBetween },
    );
    expect(f?.message).toBe(
      "距離が離れるほど安くなる組が多い駅がある: 10 駅（閾値 20%）",
    );
    expect(f?.samples).toHaveLength(5);
  });

  describe("駅を1つずらした版との比較", () => {
    // D の運賃だけ距離に逆行させた表。ペアは E から並べ、ずらす起点（最初の駅）を
    // 端でない駅にする。距離の取れない Z も混ぜる。逆行は閾値 1 でエラーにしない
    const pairs = [
      ...allPairs((km) => 100 + km * 50).map((p) =>
        p.from === "D" || p.to === "D"
          ? { ...p, fare: 1000 - (kmBetween(p.from, p.to) ?? 0) * 50 }
          : p,
      ),
      { from: "A", to: "Z", fare: 300 },
    ].sort((a, b) => Number(b.from === "E") - Number(a.from === "E"));
    const ineffective = (sensitivityRatio: number) =>
      verifyFareCandidate(
        { operator: "テスト鉄道", pairs },
        { kmBetween, monotonicityThreshold: 1, sensitivityRatio },
      ).filter((f) => f.check === "distance-check-ineffective");

    it("起点からの距離の順にずらし、逆行の割合を示す", () => {
      // 割合は実装の出力を固定したもの（手では数えきれない）
      expect(ineffective(100)[0]?.samples).toEqual([
        "正データの逆行 100.00% / 駅を1つずらしても 75.00%",
        "運賃の種類 44 種",
      ]);
    });

    it("ずらした版の逆行が正データの倍率以下なら「無力」、超えれば出さない", () => {
      // 正データ 100%、ずらした版 75%
      expect(ineffective(1.5)).toHaveLength(1);
      expect(ineffective(0.75)).toHaveLength(1); // ちょうど倍率と同じ
      expect(ineffective(0.5)).toHaveLength(0);
    });
  });

  it("全駅の運賃が距離で動く表は、所見を1つも出さない", () => {
    expect(
      verifyFareCandidate(
        { operator: "テスト鉄道", pairs: allPairs((km) => 100 + km * 50) },
        { kmBetween },
      ),
    ).toEqual([]);
  });

  describe("均一運賃の駅の名指し", () => {
    // 路面電車の駅は距離制の駅との運賃ペアを持たない
    const mixed = (tram: string[], extra: CandidatePair[] = []) => {
      const tramPos = new Map(tram.map((n, i) => [n, i * 1.5]));
      tramPos.set("Z", tram.length * 1.5);
      const km = (a: string, b: string) => {
        const t1 = tramPos.get(a);
        const t2 = tramPos.get(b);
        if (t1 !== undefined && t2 !== undefined) return Math.abs(t1 - t2);
        if (t1 !== undefined || t2 !== undefined) return null;
        return kmBetween(a, b);
      };
      const pairs: CandidatePair[] = [...allPairs((k) => 100 + k * 50)];
      for (let i = 0; i < tram.length; i++)
        for (let j = i + 1; j < tram.length; j++)
          pairs.push({
            from: tram[i] as string,
            to: tram[j] as string,
            fare: 170,
          });
      return verifyFareCandidate(
        { operator: "テスト交通局", pairs: [...pairs, ...extra] },
        { kmBetween: km },
      ).filter((f) => f.check === "unverifiable-stations");
    };

    it("3ペア以上ある駅だけを、ペアの数と一緒に名指しする", () => {
      // Z は2ペアしかないので名指ししない
      expect(
        mixed(
          ["P", "Q", "R", "S"],
          [
            { from: "Z", to: "P", fare: 170 },
            { from: "Z", to: "Q", fare: 170 },
          ],
        ),
      ).toEqual([
        {
          check: "unverifiable-stations",
          severity: "warn",
          message: "運賃が1種類しかなく、距離では検証できない駅がある: 4 駅",
          samples: [
            "P: 4 ペアすべて同額",
            "Q: 4 ペアすべて同額",
            "R: 3 ペアすべて同額",
            "S: 3 ペアすべて同額",
          ],
        },
      ]);
    });

    it("名指しする駅が多ければ、例は5駅までにする", () => {
      const [f] = mixed(["P", "Q", "R", "S", "T", "U", "V"]);
      expect(f?.message).toBe(
        "運賃が1種類しかなく、距離では検証できない駅がある: 7 駅",
      );
      expect(f?.samples).toHaveLength(5);
    });
  });

  it("距離が取れないペアがあっても、残りが単調なら所見を出さない", () => {
    const pairs = [
      ...allPairs((km) => 100 + km * 50),
      { from: "A", to: "Z", fare: 9999 },
    ];
    // Z の距離は取れないので、A〜Z は距離の検査に入らない。欠落ペアの警告だけ出る
    expect(
      verifyFareCandidate({ operator: "テスト鉄道", pairs }, { kmBetween }).map(
        (f) => f.check,
      ),
    ).toEqual(["missing-pairs"]);
  });

  it("距離が取れないペアは距離の検査から除外する", () => {
    // 距離不明の駅 Z を足しても、既存の単調な表は落ちない
    const pairs = [
      ...allPairs((km) => 100 + km * 50),
      { from: "A", to: "Z", fare: 9999 },
    ];
    const findings = verifyFareCandidate(
      { operator: "テスト鉄道", pairs },
      { kmBetween },
    );
    expect(errors(findings, "distance-monotonicity")).toHaveLength(0);
  });
});

// 所見の文言・件数・境目。採用の判断は所見の文面を見て人が下すので、中身まで確かめる
describe("所見の中身", () => {
  // 一直線の4駅 A 0km・B 1km・C 3km・D 6km。同じ駅どうしの距離は取れない（null）とする
  const pos: Record<string, number> = { A: 0, B: 1, C: 3, D: 6, E: 10 };
  const km = (a: string, b: string) => {
    const x = pos[a];
    const y = pos[b];
    return a === b || x === undefined || y === undefined
      ? null
      : Math.abs(x - y);
  };
  // "AB" のような2文字のキーで駅の組を書く
  const pairsOf = (fares: Record<string, number>): CandidatePair[] =>
    Object.entries(fares).map(([k, fare]) => ({
      from: k[0] as string,
      to: k[1] as string,
      fare,
    }));
  const verify = (fares: Record<string, number>, ctx = {}) =>
    verifyFareCandidate(
      { operator: "テスト鉄道", pairs: pairsOf(fares) },
      { kmBetween: km, ...ctx },
    );
  // 距離で単調な運賃
  const monotone = { AB: 100, AC: 300, AD: 600, BC: 200, BD: 500, CD: 300 };

  it("同じ駅ペアの運賃の食い違いは、駅名と両方の額を示す", () => {
    expect(
      verifyFareCandidate(
        {
          operator: "テスト鉄道",
          pairs: [
            { from: "東京", to: "上野", fare: 200 },
            { from: "上野", to: "東京", fare: 250 },
          ],
        },
        noKm,
      ),
    ).toEqual([
      {
        check: "symmetry",
        severity: "error",
        message: "同じ駅ペアに複数の運賃がある: 1 組",
        samples: ["上野–東京: 200 / 250円"],
      },
    ]);
  });

  it("食い違いが多ければ、例は5組までにする", () => {
    const pairs = [1, 2, 3, 4, 5, 6].flatMap((i) => [
      { from: "A", to: `X${i}`, fare: 100 },
      { from: `X${i}`, to: "A", fare: 200 },
    ]);
    const [f] = verifyFareCandidate({ operator: "テスト鉄道", pairs }, noKm);
    expect(f?.message).toBe("同じ駅ペアに複数の運賃がある: 6 組");
    expect(f?.samples).toHaveLength(5);
  });

  it("欠けたペアは、駅の数・あるはずの数・実際の数と、欠けた組を示す", () => {
    expect(verify({ AB: 100, BC: 200 }, { kmBetween: () => null })).toEqual([
      {
        check: "missing-pairs",
        severity: "warn",
        message: "3 駅なら 3 ペアのはずが 2 ペアしかない",
        samples: ["A–C"],
      },
    ]);
  });

  it("欠けたペアが多ければ、例は駅の順に5組までにする", () => {
    const [f] = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: pairsOf({ AB: 1, BC: 1, CD: 1, DE: 1, EF: 1 }),
      },
      noKm,
    );
    expect(f?.message).toBe("6 駅なら 15 ペアのはずが 5 ペアしかない");
    expect(f?.samples).toEqual(["A–C", "A–D", "A–E", "A–F", "B–D"]);
  });

  it("公式の一覧に無い運賃は、額の種類で数える", () => {
    expect(
      verifyFareCandidate(
        {
          operator: "テスト鉄道",
          pairs: pairsOf({ AB: 237, AC: 237, BC: 300 }),
        },
        { ...noKm, allowedFares: [200, 300] },
      ),
    ).toEqual([
      {
        check: "fare-not-allowed",
        severity: "error",
        message: "公式の運賃額一覧に無い値がある: 1 種",
        samples: ["237円"],
      },
    ]);
  });

  it("一覧に無い運賃が多ければ、例は5種までにする", () => {
    const [f] = verifyFareCandidate(
      {
        operator: "テスト鉄道",
        pairs: pairsOf({
          AB: 201,
          AC: 202,
          AD: 203,
          BC: 204,
          BD: 205,
          CD: 206,
        }),
      },
      { ...noKm, allowedFares: [100] },
    );
    expect(f?.message).toBe("公式の運賃額一覧に無い値がある: 6 種");
    expect(f?.samples).toHaveLength(5);
  });

  it("全部の運賃が一覧にあり、全部の組が揃っていれば所見を出さない", () => {
    expect(
      verifyFareCandidate(
        {
          operator: "テスト鉄道",
          pairs: pairsOf({ AB: 200, AC: 300, BC: 200 }),
        },
        { ...noKm, allowedFares: [200, 300] },
      ),
    ).toEqual([]);
    expect(
      verifyFareCandidate(
        {
          operator: "テスト鉄道",
          pairs: pairsOf({ AB: 200, AC: 300, BC: 200 }),
        },
        noKm,
      ),
    ).toEqual([]);
  });

  // A の組: 1km 100円・3km 300円・6km 250円 → 3組中1組が逆行（33.3%）
  // D の組: 3km 300円・5km 500円・6km 250円 → 3組中2組が逆行（66.7%）
  const reversed = { ...monotone, AD: 250 };

  it("逆行の多い駅を、逆行の多い順に割合とペアの数で示す", () => {
    expect(verify(reversed)).toEqual([
      {
        check: "distance-monotonicity",
        severity: "error",
        message: "距離が離れるほど安くなる組が多い駅がある: 2 駅（閾値 20%）",
        samples: ["D: 逆行 66.7% (3 ペア)", "A: 逆行 33.3% (3 ペア)"],
      },
    ]);
  });

  it("逆行の割合が閾値ちょうどの駅はエラーにしない", () => {
    expect(verify(reversed, { monotonicityThreshold: 1 / 3 })).toEqual([
      {
        check: "distance-monotonicity",
        severity: "error",
        message: "距離が離れるほど安くなる組が多い駅がある: 1 駅（閾値 33%）",
        samples: ["D: 逆行 66.7% (3 ペア)"],
      },
    ]);
  });

  it("距離が同じ組どうしは、運賃が違っても逆行に数えない", () => {
    // C から A と D はどちらも 3km。300円と 250円でも逆行ではない
    expect(
      errors(verify({ ...monotone, CD: 250 }), "distance-monotonicity"),
    ).toEqual([]);
  });

  it("ペアが2つしかない駅は逆行を数えない", () => {
    // E の組は 9km 2100円・10km 2000円で逆行するが、2組では判断しない
    expect(
      errors(
        verify({ ...monotone, AE: 2000, BE: 2100 }),
        "distance-monotonicity",
      ),
    ).toEqual([]);
  });

  it("どの駅もペアが3つに満たなければ、距離の検査はしない", () => {
    expect(verify({ AB: 100, CD: 300 })).toEqual([
      {
        check: "missing-pairs",
        severity: "warn",
        message: "4 駅なら 6 ペアのはずが 2 ペアしかない",
        samples: ["A–C", "A–D", "B–C", "B–D"],
      },
    ]);
  });

  it("「検査が無力」の警告は、逆行の割合と運賃の種類を示す", () => {
    // 閾値を上げて逆行をエラーにせず、倍率を大きくして必ず「無力」にする
    expect(
      verify(reversed, { monotonicityThreshold: 0.9, sensitivityRatio: 100 }),
    ).toEqual([
      {
        check: "distance-check-ineffective",
        severity: "warn",
        message:
          "運賃が距離をほとんど区別しないため、距離単調性では行ズレを検出できない。別の方法で検証すること",
        samples: [
          // ずらすと A→B・B→C… の発駅になり、自分自身との組は距離が取れないので
          // どの駅も2ペアしか残らず、逆行を数えない
          "正データの逆行 66.67% / 駅を1つずらしても 0.00%",
          "運賃の種類 5 種",
        ],
      },
    ]);
  });

  it("起点から距離の取れない駅を除くと4駅に満たなければ、ずらした版とは比べない", () => {
    // A〜D の距離が取れない。B と C だけが3ペアを持ち、どちらも同額
    const noAD = (a: string, b: string) =>
      (a === "A" && b === "D") || (a === "D" && b === "A") ? null : km(a, b);
    expect(
      verifyFareCandidate(
        {
          operator: "テスト軌道",
          pairs: pairsOf({
            AB: 200,
            AC: 200,
            AD: 200,
            BC: 200,
            BD: 200,
            CD: 200,
          }),
        },
        { kmBetween: noAD },
      ),
    ).toEqual([
      {
        check: "unverifiable-stations",
        severity: "warn",
        message: "運賃が1種類しかなく、距離では検証できない駅がある: 2 駅",
        samples: ["B: 3 ペアすべて同額", "C: 3 ペアすべて同額"],
      },
    ]);
  });
});
