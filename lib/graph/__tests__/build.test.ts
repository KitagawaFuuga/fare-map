import { describe, expect, it } from "vitest";
import {
  applyStationCorrections,
  buildGraph,
  mergeExtraStations,
} from "@/lib/graph/build";

const input = {
  companies: [{ company_cd: "1", company_name: "テスト鉄道" }],
  lines: [{ line_cd: "L1", company_cd: "1", line_name: "テスト線" }],
  stations: [
    {
      station_cd: "S1",
      station_g_cd: "G1",
      station_name: "あ駅",
      line_cd: "L1",
      lon: "139.70",
      lat: "35.69",
    },
    {
      station_cd: "S2",
      station_g_cd: "G2",
      station_name: "い駅",
      line_cd: "L1",
      lon: "139.75",
      lat: "35.69",
    },
    // S3 は S1 と同一グループ（同名駅の別路線ノード想定）
    {
      station_cd: "S3",
      station_g_cd: "G1",
      station_name: "あ駅",
      line_cd: "L1",
      lon: "139.701",
      lat: "35.69",
    },
  ],
  joins: [{ line_cd: "L1", station_cd1: "S1", station_cd2: "S2" }],
};

describe("buildGraph", () => {
  it("join から rail エッジを距離付きで作る", () => {
    const g = buildGraph(input);
    const rail = g.edges.filter((e) => e.kind === "rail");
    expect(rail).toHaveLength(1);
    expect(rail[0]?.operator).toBe("テスト鉄道");
    expect(rail[0]?.km).toBeGreaterThan(3);
    expect(rail[0]?.km).toBeLessThan(6);
  });

  it("同一グループの駅間に transfer エッジを作る", () => {
    const g = buildGraph(input);
    const tr = g.edges.filter((e) => e.kind === "transfer");
    const pair = tr.find(
      (e) =>
        (e.from === "S1" && e.to === "S3") ||
        (e.from === "S3" && e.to === "S1"),
    );
    expect(pair).toBeDefined();
    expect(pair?.km).toBe(0);
  });

  it("ノードに事業者名・路線名が入る", () => {
    const g = buildGraph(input);
    expect(g.nodes["S1"]?.operator).toBe("テスト鉄道");
    expect(g.nodes["S1"]?.lineName).toBe("テスト線");
  });

  it("座標が欠損した駅（空文字/キー欠落）はノードにもエッジにも現れない", () => {
    const brokenInput = {
      companies: input.companies,
      lines: input.lines,
      stations: [
        ...input.stations,
        // lat が空文字 → Number("") = 0 になってしまう不正データ
        {
          station_cd: "S4",
          station_g_cd: "G4",
          station_name: "う駅",
          line_cd: "L1",
          lon: "139.80",
          lat: "",
        },
        // lon キー自体が欠落 → Number(undefined) = NaN になる不正データ
        {
          station_cd: "S5",
          station_g_cd: "G5",
          station_name: "え駅",
          line_cd: "L1",
          lat: "35.70",
        },
      ],
      joins: [
        ...input.joins,
        { line_cd: "L1", station_cd1: "S4", station_cd2: "S5" },
      ],
    };
    const g = buildGraph(brokenInput);
    expect(g.nodes["S4"]).toBeUndefined();
    expect(g.nodes["S5"]).toBeUndefined();
    const touchesBroken = g.edges.some(
      (e) =>
        e.from === "S4" || e.to === "S4" || e.from === "S5" || e.to === "S5",
    );
    expect(touchesBroken).toBe(false);
  });
});

// 1事業者が運賃体系の異なる路線群を持つ場合の分割（札幌市電と地下鉄など）。
// lineId は station.csv 由来の内部IDで再生成時に振り直されうるため、
// 定義が実データと合わないときは黙って無効化されず例外になることを確認する。
describe("buildGraph の事業者分割 (operator-splits)", () => {
  const twoLines = {
    companies: [{ company_cd: "1", company_name: "テスト市交通局" }],
    lines: [
      { line_cd: "L1", company_cd: "1", line_name: "テスト地下鉄" },
      { line_cd: "L2", company_cd: "1", line_name: "テスト市電" },
    ],
    stations: [
      {
        station_cd: "S1",
        station_g_cd: "G1",
        station_name: "あ駅",
        line_cd: "L1",
        lon: "139.70",
        lat: "35.69",
      },
      {
        station_cd: "S2",
        station_g_cd: "G2",
        station_name: "い駅",
        line_cd: "L2",
        lon: "139.75",
        lat: "35.69",
      },
    ],
    joins: [],
  };

  it("指定した lineId のノードだけ事業者名が置き換わる", () => {
    const g = buildGraph(twoLines, [
      { lineId: "L2", from: "テスト市交通局", to: "テスト市交通局(市電)" },
    ]);
    expect(g.nodes["S1"]?.operator).toBe("テスト市交通局");
    expect(g.nodes["S2"]?.operator).toBe("テスト市交通局(市電)");
  });

  it("分割後の事業者名は rail エッジにも伝播する", () => {
    const withJoin = {
      ...twoLines,
      stations: [
        twoLines.stations[0]!,
        { ...twoLines.stations[1]!, station_cd: "S2" },
        {
          station_cd: "S3",
          station_g_cd: "G3",
          station_name: "う駅",
          line_cd: "L2",
          lon: "139.76",
          lat: "35.69",
        },
      ],
      joins: [{ line_cd: "L2", station_cd1: "S2", station_cd2: "S3" }],
    };
    const g = buildGraph(withJoin, [
      { lineId: "L2", from: "テスト市交通局", to: "テスト市交通局(市電)" },
    ]);
    const rail = g.edges.filter((e) => e.kind === "rail");
    expect(rail).toHaveLength(1);
    expect(rail[0]?.operator).toBe("テスト市交通局(市電)");
  });

  it("実データに存在しない lineId を指定したら例外（振り直しの検出）", () => {
    expect(() =>
      buildGraph(twoLines, [
        { lineId: "L99", from: "テスト市交通局", to: "テスト市交通局(市電)" },
        { lineId: "L98", from: "テスト市交通局", to: "テスト市交通局(バス)" },
      ]),
    ).toThrow(
      /存在しない lineId があります \(L99→テスト市交通局\(市電\), L98→テスト市交通局\(バス\)\)。.*data\/operator-splits\.json を確認/,
    );
  });

  it("lineId は実在するが事業者が想定と違う場合も例外", () => {
    expect(() =>
      buildGraph(twoLines, [
        { lineId: "L2", from: "別の会社", to: "テスト市交通局(市電)" },
      ]),
    ).toThrow(
      /lineId=L2 の事業者が想定と違います \(定義: "別の会社" \/ 実データ: "テスト市交通局"\)。.*data\/operator-splits\.json を確認/,
    );
  });

  // 駅データ.jp の2026年版は相鉄・JR直通線を、JRの区間（新宿〜武蔵小杉〜羽沢横浜国大）まで
  // 含めて全部相鉄の駅として持つ。JRの区間の駅だけをJRに分ける
  describe("駅を指定した分割（stations）", () => {
    const through = {
      companies: [{ company_cd: "1", company_name: "甲鉄道" }],
      lines: [{ line_cd: "L1", company_cd: "1", line_name: "直通線" }],
      stations: ["あ", "い", "う"].map((name, i) => ({
        station_cd: `S${i + 1}`,
        station_g_cd: `G${i + 1}`,
        station_name: name,
        line_cd: "L1",
        lon: String(139.7 + i * 0.05),
        lat: "35.69",
      })),
      joins: [
        { line_cd: "L1", station_cd1: "S1", station_cd2: "S2" },
        { line_cd: "L1", station_cd1: "S2", station_cd2: "S3" },
      ],
    };
    const split = {
      lineId: "L1",
      from: "甲鉄道",
      to: "乙鉄道",
      stations: ["あ", "い"],
    };

    it("指定した駅だけ事業者が置き換わる", () => {
      const g = buildGraph(through, [split]);
      expect(g.nodes["S1"]?.operator).toBe("乙鉄道");
      expect(g.nodes["S2"]?.operator).toBe("乙鉄道");
      expect(g.nodes["S3"]?.operator).toBe("甲鉄道");
    });

    it("事業者がまたがる駅間には線路を張らない（どちらの運賃か決まらない）", () => {
      const rail = buildGraph(through, [split]).edges.filter(
        (e) => e.kind === "rail",
      );
      expect(rail).toHaveLength(1);
      expect(rail[0]?.operator).toBe("乙鉄道");
    });

    it("指定した駅がその路線に無ければ例外", () => {
      expect(() =>
        buildGraph(through, [{ ...split, stations: ["あ", "ん", "を"] }]),
      ).toThrow(
        /lineId=L1 の路線に無い駅が指定されています \(ん, を\)。data\/operator-splits\.json を確認/,
      );
    });
  });

  it("分割定義が空なら従来どおり（既存の挙動を変えない）", () => {
    const g = buildGraph(twoLines);
    expect(g.nodes["S1"]?.operator).toBe("テスト市交通局");
    expect(g.nodes["S2"]?.operator).toBe("テスト市交通局");
  });
});

// ekidata は他社の線路に乗り入れる区間を、駅としては登録するが駅間接続は
// 登録しない。そのままだと乗り入れ先の駅が線路を1本も持たない孤立点になり、
// 探索がその区間を通れず通し運賃が引けなくなる（実例: しなの鉄道線の篠ノ井〜長野）。
describe("buildGraph の駅間接続の補完 (extra-joins)", () => {
  it("元データに無い接続を rail エッジとして足す", () => {
    const g = buildGraph(input, [], [{ lineId: "L1", from: "S2", to: "S3" }]);
    const rail = g.edges.filter((e) => e.kind === "rail");
    expect(rail).toHaveLength(2);
    const added = rail.find((e) => e.from === "S2" && e.to === "S3");
    expect(added?.operator).toBe("テスト鉄道");
    expect(added?.km).toBeGreaterThan(0);
  });

  it("補完しなければ孤立したままであることを示す（対比）", () => {
    const g = buildGraph(input);
    const rail = g.edges.filter(
      (e) => e.kind === "rail" && (e.from === "S3" || e.to === "S3"),
    );
    expect(rail).toHaveLength(0);
  });

  it("駅が存在しなければ例外（station_cd の振り直しを検出する）", () => {
    expect(() =>
      buildGraph(input, [], [{ lineId: "L1", from: "S1", to: "S99" }]),
    ).toThrow(
      /extra-joins: lineId=L1 S1-S99 の駅が station.csv に存在しません。.*data\/extra-joins\.json を確認/,
    );
  });

  it("駅が指定した路線に属していなければ例外", () => {
    const twoLines = {
      ...input,
      lines: [
        ...input.lines,
        { line_cd: "L2", company_cd: "1", line_name: "別線" },
      ],
      stations: [
        ...input.stations,
        {
          station_cd: "S4",
          station_g_cd: "G4",
          station_name: "う駅",
          line_cd: "L2",
          lon: "139.80",
          lat: "35.69",
        },
      ],
    };
    expect(() =>
      buildGraph(twoLines, [], [{ lineId: "L1", from: "S1", to: "S4" }]),
    ).toThrow(
      /extra-joins: lineId=L1 S1-S4 の駅が指定の路線に属していません \(あ駅=L1 \/ う駅=L2\)/,
    );
    // 発駅の側が別の路線でも同じ
    expect(() =>
      buildGraph(twoLines, [], [{ lineId: "L1", from: "S4", to: "S1" }]),
    ).toThrow(/指定の路線に属していません/);
  });

  // 元データが更新されて接続が追加されたら、補完定義は不要になる。
  // 気づかず二重にエッジを張ると距離が狂うので例外にする。
  it("元データに既にある接続を重ねて定義したら例外", () => {
    expect(() =>
      buildGraph(input, [], [{ lineId: "L1", from: "S1", to: "S2" }]),
    ).toThrow(
      /extra-joins: lineId=L1 S1-S2 は join.csv に既に存在します。.*data\/extra-joins\.json から削除/,
    );
    // 向きを逆にして定義しても同じ接続
    expect(() =>
      buildGraph(input, [], [{ lineId: "L1", from: "S2", to: "S1" }]),
    ).toThrow(/join.csv に既に存在します/);
  });

  it("補完の定義に同じ接続が2回あれば例外", () => {
    const twice = { lineId: "L1", from: "S2", to: "S3" };
    expect(() => buildGraph(input, [], [twice, twice])).toThrow(
      /S2-S3 は join.csv に既に存在します/,
    );
  });
});

// 元データから消えた駅を補う定義。駅データ.jp の2026年版では、しなの鉄道線から
// JR線に乗り入れる篠ノ井〜長野の4駅が消えた。消えたままだと、しなの鉄道の通し運賃
// （上田→長野など、data/fare-overrides/shinano.json）が引けなくなる。
describe("mergeExtraStations (extra-stations)", () => {
  const extra = {
    station_cd: "S9",
    station_g_cd: "G9",
    station_name: "え駅",
    line_cd: "L1",
    lon: "139.80",
    lat: "35.69",
  };

  it("元データに無い駅を足す", () => {
    const merged = mergeExtraStations(input.stations, [extra]);
    expect(merged.map((s) => s.station_cd)).toEqual(["S1", "S2", "S3", "S9"]);
  });

  it("足した駅は extra-joins でつなげる", () => {
    const g = buildGraph(
      { ...input, stations: mergeExtraStations(input.stations, [extra]) },
      [],
      [{ lineId: "L1", from: "S2", to: "S9" }],
    );
    expect(g.nodes["S9"]?.name).toBe("え駅");
    expect(
      g.edges.some(
        (e) => e.kind === "rail" && e.from === "S2" && e.to === "S9",
      ),
    ).toBe(true);
  });

  it("元データに同じ駅コードがあれば例外（元データが直ったら定義を消すため）", () => {
    expect(() =>
      mergeExtraStations(input.stations, [{ ...extra, station_cd: "S1" }]),
    ).toThrow(
      /extra-stations: S1\(え駅\) は station.csv に既に存在します。.*data\/extra-stations\.json から削除/,
    );
  });
});

// 元データが改称・廃止に追いついていない駅を一次情報で直す定義。
// 駅データ.jp の2026年版でも、くま川鉄道の川村（現 相良十島）などが旧名のまま残る。
describe("applyStationCorrections (station-corrections)", () => {
  it("改称した駅の名前を新しい名前にする", () => {
    const corrected = applyStationCorrections(input.stations, {
      renames: [{ station_cd: "S2", from: "い駅", to: "新い駅" }],
      closures: [],
    });
    expect(corrected.find((s) => s.station_cd === "S2")?.station_name).toBe(
      "新い駅",
    );
  });

  it("廃止された駅を落とす", () => {
    const corrected = applyStationCorrections(input.stations, {
      renames: [],
      closures: [{ station_cd: "S2", name: "い駅" }],
    });
    expect(corrected.map((s) => s.station_cd)).toEqual(["S1", "S3"]);
  });

  it("元データの駅名が旧名と違えば例外（元データが直ったら定義を消すため）", () => {
    expect(() =>
      applyStationCorrections(input.stations, {
        renames: [{ station_cd: "S2", from: "う駅", to: "新い駅" }],
        closures: [],
      }),
    ).toThrow(
      /S2 は「う駅」のはずが「い駅」です。.*data\/station-corrections\.json を確認/,
    );
  });

  it("改称する駅が元データに無ければ例外", () => {
    expect(() =>
      applyStationCorrections(input.stations, {
        renames: [{ station_cd: "S9", from: "お駅", to: "新お駅" }],
        closures: [],
      }),
    ).toThrow(/S9 は「お駅」のはずが「（無し）」です/);
  });

  it("廃止駅が元データに無ければ例外（元データが廃止を反映したら定義を消すため）", () => {
    expect(() =>
      applyStationCorrections(input.stations, {
        renames: [],
        closures: [{ station_cd: "S9", name: "お駅" }],
      }),
    ).toThrow(
      /廃止駅 S9（お駅）が元データに見当たりません。.*data\/station-corrections\.json を確認/,
    );
  });
});

const station = (
  cd: string,
  groupCd: string,
  lat: number,
  lon: number,
  lineCd = "L1",
): Record<string, string> => ({
  station_cd: cd,
  station_g_cd: groupCd,
  station_name: `${cd}駅`,
  line_cd: lineCd,
  lat: String(lat),
  lon: String(lon),
});
const graphOf = (
  stations: Record<string, string>[],
  joins: Record<string, string>[] = [],
) =>
  buildGraph({
    companies: input.companies,
    lines: input.lines,
    stations,
    joins,
  });
// 乗換エッジを「小さい駅コード-大きい駅コード」の並びにする
const transfersOf = (g: ReturnType<typeof buildGraph>) =>
  g.edges
    .filter((e) => e.kind === "transfer")
    .map((e) => [e.from, e.to].sort().join("-"))
    .sort();

describe("buildGraph の駅の読み込み", () => {
  it("路線が分からない駅と、駅コードの無い駅は入れない", () => {
    const g = graphOf([
      station("S1", "G1", 35, 135),
      station("S2", "G2", 35, 135.1, "L9"),
      station("", "G3", 35, 135.2),
    ]);
    expect(Object.keys(g.nodes)).toEqual(["S1"]);
  });

  it("緯度か経度の片方だけが数でなくても入れない", () => {
    const g = graphOf([
      station("S1", "G1", 35, 135),
      { ...station("S2", "G2", 35, 135.1), lat: "abc" },
      { ...station("S3", "G3", 35, 135.2), lon: "abc" },
    ]);
    expect(Object.keys(g.nodes)).toEqual(["S1"]);
  });

  it("事業者の分からない路線の駅は、事業者名を空にする", () => {
    const g = buildGraph({
      companies: input.companies,
      lines: [{ line_cd: "L2", company_cd: "9", line_name: "不明線" }],
      stations: [station("S1", "G1", 35, 135, "L2")],
      joins: [],
    });
    expect(g.nodes["S1"]?.operator).toBe("");
  });

  it("グループコードが無ければ、駅コードをグループにする", () => {
    const noGroup = station("S1", "", 35, 135);
    delete noGroup.station_g_cd;
    expect(graphOf([noGroup]).nodes["S1"]?.groupId).toBe("S1");
  });

  it("元データに無い駅を指す接続は無視する", () => {
    const g = graphOf(
      [station("S1", "G1", 35, 135)],
      [{ line_cd: "L1", station_cd1: "S1", station_cd2: "S99" }],
    );
    expect(g.edges).toEqual([]);
  });
});

describe("buildGraph の乗換エッジ", () => {
  it("同じグループの駅は、離れていても全部の組を乗換でつなぐ", () => {
    // 互いに 4km 以上離れている
    const g = graphOf([
      station("A", "G1", 35, 135),
      station("B", "G1", 35, 135.05),
      station("C", "G1", 35.05, 135),
    ]);
    expect(transfersOf(g)).toEqual(["A-B", "A-C", "B-C"]);
    expect(g.edges).toHaveLength(3);
    // 乗換は距離0で、どの事業者の運賃にも入らない
    for (const e of g.edges) {
      expect(e.km).toBe(0);
      expect(e.operator).toBe("");
    }
  });

  it("グループが違っても、0.3km 以内の駅は乗換でつなぐ", () => {
    // 北緯35度で経度 0.001度 ≒ 0.091km。A〜B 0.27km、B〜C 0.32km
    const g = graphOf([
      station("A", "G1", 35, 135),
      station("B", "G2", 35, 135.003),
      station("C", "G3", 35, 135.0065),
    ]);
    expect(transfersOf(g)).toEqual(["A-B"]);
    expect(g.edges).toHaveLength(1);
  });

  it("同じセルに近い駅が3つあれば、全部の組を乗換でつなぐ", () => {
    // 互いに 0.2km 以内
    const g = graphOf([
      station("A", "G1", 35, 135),
      station("B", "G2", 35, 135.002),
      station("C", "G3", 35, 135.001),
    ]);
    expect(transfersOf(g)).toEqual(["A-B", "A-C", "B-C"]);
  });

  // 近い駅は 0.01度ごとのセルで探す。セルの境目（0.005度）をまたいだ駅どうしも見つける
  it.each([
    ["東へ", [35, 135.0049], [35, 135.0051]],
    ["西へ", [35, 135.0051], [35, 135.0049]],
    ["北へ", [35.0049, 135], [35.0051, 135]],
    ["南へ", [35.0051, 135], [35.0049, 135]],
  ] as const)(
    "セルの境目の%sにある駅も乗換でつなぐ",
    (_, [latA, lonA], [latB, lonB]) => {
      const g = graphOf([
        station("A", "G1", latA, lonA),
        station("B", "G2", latB, lonB),
      ]);
      expect(transfersOf(g)).toEqual(["A-B"]);
    },
  );

  it("同じグループで近い駅も、乗換は1本だけ", () => {
    // 並びを駅コードの逆にしても、グループと近さの両方から同じ組として数える
    const g = graphOf([
      station("B", "G1", 35, 135.001),
      station("A", "G1", 35, 135),
    ]);
    expect(transfersOf(g)).toEqual(["A-B"]);
    expect(g.edges).toHaveLength(1);
  });
});
