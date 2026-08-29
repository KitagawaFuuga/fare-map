# 運賃精度の改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** 概算運賃を実運賃に近づける。距離の系統誤差を実営業キロで補正し、駅数上位20社に専用運賃表を用意する。

**背景:** v1 は 161 事業者中 3 社（JR本州3社）にしか専用運賃表がなく、**66%の駅（6,909駅）が単一の汎用表**で計算されていた。加えて駅間距離を直線距離の積み上げで求めているため、実営業キロより短く出る（実測比 1.03〜1.72）。JR本州の運賃表自体は実運賃と最大 -3% で正確なので、誤差の主因はこの 2 点。

**Spec:** `docs/superpowers/specs/2026-08-23-fare-map-design.md`（v1 の設計。本計画はその「将来拡張: 有料 API による運賃精度向上」の代替として、無料データの範囲で精度を上げる）

## Global Constraints

- TypeScript strict / `any` 禁止 / Node 20 / Conventional Commits / `console.log` をコミットしない
- **運賃の数値は必ず公式の運賃表（各社サイトまたは公的資料）を出典として取得すること。記憶や推測で数値を書かない。** もっともらしい誤った数値は今回直そうとしている問題そのもの
- 各運賃表には出典 URL と取得日を JSON 内に記録する
- 既存の `FareRule` スキーマ（`lib/fare/types.ts`）を壊さない。拡張する場合は zod スキーマと既存 2 ファイルも合わせて更新する
- 既存テスト 50 件を壊さない

---

### Task 1: 実営業キロによる距離補正

**Files:**
- Create: `scripts/pipeline/fetch-kilometrage.ts`, `lib/graph/calibrate.ts`, `lib/graph/__tests__/calibrate.test.ts`, `data/calibration.json`（生成物・コミット対象）
- Modify: `scripts/pipeline/build-graph.ts`, `package.json`, `scripts/pipeline/README.md`

**データ源:** [全国鉄道運行本数データ](https://gtfs-gis.jp/railway_honsu/) の
`https://gtfs-gis.jp/railway_honsu/data/unkohonsu2026_kukan_sjis.csv`
（Shift_JIS、2,152 行、160 事業者）。列: `ID,事業者コード,事業者名,路線コード,路線名,区間コード,起点駅,終点駅,距離,営業キロ,順方向運行本数2024,逆方向運行本数2024`

**方式:** 各区間の「起点駅→終点駅」について、我々のグラフ上で同一路線を辿った直線距離の積み上げを求め、実営業キロとの比を出す。これを路線単位で集約し補正係数とする。路線に該当区間が無ければ事業者単位、それも無ければ全国中央値をフォールバックとして使う。

**Interfaces:**
```ts
// lib/graph/calibrate.ts
export interface CalibrationTable {
  byLine: Record<string, number>;      // lineId → 係数
  byOperator: Record<string, number>;  // 事業者名 → 係数
  fallback: number;                    // 全国中央値
  meta: { source: string; fetchedAt: string; sections: number };
}
export function buildCalibration(
  graph: RailGraph,
  sections: { operator: string; line: string; from: string; to: string; officialKm: number }[],
): CalibrationTable;
export function calibratedKm(table: CalibrationTable, node: StationNode, rawKm: number): number;
```

- [ ] **Step 1: 実営業キロ CSV の取得スクリプトを書く**

`scripts/pipeline/fetch-kilometrage.ts` を作る。既存の `fetch-data.ts` と同じ原子性の方針（全件取得 → `.tmp` に書く → 全件成功後にリネーム → `finally` で `.tmp` を片付ける）に従うこと。Shift_JIS なので `new TextDecoder("shift-jis").decode(buf)` でデコードして UTF-8 で保存する。保存先は `data/raw/kilometrage.csv`。`package.json` に `pipeline:fetch-km` を追加し、`pipeline:fetch` からも呼ぶ。

- [ ] **Step 2: 補正係数の算出に失敗するテストを書く**

`lib/graph/__tests__/calibrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCalibration, calibratedKm } from "@/lib/graph/calibrate";
import type { RailGraph } from "@/lib/graph/types";

// A-B-C が一直線に並び、直線距離の合計が 10km、実営業キロが 12km の路線
const node = (id: string, lat: number, lineId = "L1", operator = "テスト鉄道") => ({
  id, groupId: id, name: id, lat, lng: 139, lineId, lineName: "テスト線", operator,
});
const graph: RailGraph = {
  nodes: { A: node("A", 35.0), B: node("B", 35.045), C: node("C", 35.09) },
  edges: [
    { from: "A", to: "B", km: 5, kind: "rail", operator: "テスト鉄道" },
    { from: "B", to: "C", km: 5, kind: "rail", operator: "テスト鉄道" },
  ],
};
const sections = [
  { operator: "テスト鉄道", line: "テスト線", from: "A", to: "C", officialKm: 12 },
];

describe("buildCalibration", () => {
  it("路線の補正係数を 実営業キロ / 直線距離合計 で算出する", () => {
    const t = buildCalibration(graph, sections);
    expect(t.byLine["L1"]).toBeCloseTo(1.2, 2);
  });

  it("事業者単位の係数も持つ", () => {
    const t = buildCalibration(graph, sections);
    expect(t.byOperator["テスト鉄道"]).toBeCloseTo(1.2, 2);
  });

  it("該当区間が無い路線は fallback（全国中央値）になる", () => {
    const t = buildCalibration(graph, sections);
    const other = node("X", 35.0, "L9", "別会社");
    expect(calibratedKm(t, other, 10)).toBeCloseTo(10 * t.fallback, 2);
  });

  it("補正係数が路線 → 事業者 → fallback の優先順で選ばれる", () => {
    const t = buildCalibration(graph, sections);
    expect(calibratedKm(t, graph.nodes["A"]!, 10)).toBeCloseTo(12, 2);
  });

  it("異常な係数（0以下、5超）は採用せず fallback にする", () => {
    const bad = [{ operator: "テスト鉄道", line: "テスト線", from: "A", to: "C", officialKm: 0 }];
    const t = buildCalibration(graph, bad);
    expect(t.byLine["L1"]).toBeUndefined();
  });
});
```

- [ ] **Step 3: 失敗確認** — `npx vitest run lib/graph/__tests__/calibrate.test.ts` → FAIL

- [ ] **Step 4: 実装**

`buildCalibration` の要件:
- 各 section について、グラフ上で `from` 駅と `to` 駅を名前で解決する（同名駅が複数ある場合は同一路線上のものを選ぶ）。解決できない section はスキップし、件数を `meta` に記録する
- 同一路線のみを辿る最短経路で直線距離合計を求める（transfer エッジは使わない）
- 比 = `officialKm / 直線距離合計`。比が 0 以下または 5 超の異常値は捨てる
- 路線単位・事業者単位はそれぞれ**中央値**で集約する（外れ値に強くするため。平均は使わない）
- `fallback` は全 section の比の中央値

`calibratedKm` は `byLine[node.lineId] ?? byOperator[node.operator] ?? fallback` を `rawKm` に掛ける。

- [ ] **Step 5: 成功確認** — PASS

- [ ] **Step 6: パイプラインに組み込む**

`scripts/pipeline/build-graph.ts` で、`buildGraph` の後に補正を適用する。rail エッジの `km` に係数を掛け、`data/calibration.json` も出力すること。transfer エッジ（km=0）には掛けない。

- [ ] **Step 7: 実データで実行し効果を測る**

`npm run pipeline:fetch && npm run pipeline:build && npm run pipeline:validate` を実行。そのうえで**補正前後の比較をレポートに記載**すること:

| 区間 | 公式営業キロ | 補正前 | 補正後 |
|---|---|---|---|
| 新宿→東京（JR中央線経由） | 10.3km | | |
| 新宿→高尾（JR中央線） | 42.8km | | |
| 東京→横浜（JR東海道線） | 28.8km | | |
| 大阪→京都（JR京都線） | 42.8km | | |

各区間について、同一事業者・同一路線を辿った距離を出すこと（他社経由の最短ルートではない）。補正後が公式営業キロに近づいていることを確認する。近づいていなければ実装かデータ解釈が誤っているので調査すること。

- [ ] **Step 8: Commit** — `feat: 実営業キロによる駅間距離の補正を追加`

---

### Task 2: 主要事業者の運賃表（第1陣: JR3社 + 大手私鉄）

**Files:**
- Create: `data/fare-rules/` に事業者ごとの JSON
- Modify: `lib/fare/types.ts`（出典メタデータを追加する場合）

**最優先: 既存 `jr-honshu.json` が改定前の運賃になっている問題を直す**

コントローラの調査で判明した事実:

- JR東日本は **2026年3月14日に運賃改定**を実施済み（今日は 2026-08-24 なので適用中）
- **初乗り（1〜3km）が きっぷ 150円 → 160円**（IC 147円 → 155円）に変更。現行 `jr-honshu.json` は 150 円のままで**改定前の表**
- 26〜30km は IC 506円 → 528円
- 割安だった **「電車特定区間」「山手線内」の運賃区分は廃止され「幹線」に統合**された。したがって首都圏内も幹線運賃で計算してよい（改定前は別表が必要だった）
- 改定率: 幹線 +4.4%、地方交通線 +5.2%、山手線内 +16.4%、電車特定区間 +10.4%

JR東日本だけで 1,865 駅（全体の 17.8%）を占めるため、ここのズレが最大の誤差源。**この修正を最初に行うこと。**

出典候補（PDF は 403 で直接取得できなかったので、別経路を探すこと）:
- https://www.jreast.co.jp/2026unchin-kaitei/ （公式）
- https://www.jreast.co.jp/2026unchin-kaitei/assets/pdf/pamphlet.pdf （公式パンフレット）
- 運賃検索ページが公式に用意されている旨の記載あり

**JR東海・JR西日本も同時期に改定していないか必ず確認すること。** 現行 `jr-honshu.json` は 3 社を同一表で扱っているが、改定内容が異なるなら**社ごとに表を分ける**こと（`operators` を分割して別ファイルにする）。

**対象（駅数順）:** JR東日本(1865・最優先) / JR西日本(1276) / JR九州(626) / JR東海(428) / JR北海道(403) / JR四国(272) / 近畿日本鉄道(310) / 名古屋鉄道(301) / 東武鉄道(218)

**手順（各社について）:**

1. 公式サイトまたは公的資料から**現行の普通運賃表（距離帯 → 運賃）**を確認する。WebSearch / WebFetch を使う
2. `data/fare-rules/<slug>.json` を作る。既存 `jr-honshu.json` と同じ形式:
   ```json
   {
     "id": "jr-kyushu",
     "operators": ["JR九州"],
     "table": [[3, 170], [6, 210], ...],
     "beyond": { "fromKm": 100, "baseFare": 0, "ratePerKm": 0 },
     "source": { "url": "https://...", "fetchedAt": "2026-08-24", "note": "幹線・普通運賃（きっぷ）" }
   }
   ```
   `operators` の文字列は `data/graph.json` の `operator` と**完全一致**させること（確認方法: `node -e "const g=require('./data/graph.json');console.log([...new Set(Object.values(g.nodes).map(n=>n.operator))].filter(o=>o.includes('九州')))"`）
3. **検証テストを書く。** `lib/fare/__tests__/` に、各社について**実在する区間の実運賃 3 件以上**と照合するテストを追加する。誤差は ±10% 以内を目標とし、外れる場合は表を見直す
4. `source` フィールドを受け付けるよう `fareRuleSchema` を拡張する（`z.object({url, fetchedAt, note}).optional()`）。既存 2 ファイルにも追加すること

**やってはいけないこと:**
- 記憶や推測で数値を書く。必ず出典を確認する
- 出典が見つからない事業者を「だいたいこれくらい」で埋める。見つからなければその事業者は汎用フォールバックのままにし、レポートにその旨を書く

- [ ] **Step 1: 各社の運賃表を調査・作成**（上記手順を 6 社ぶん）
- [ ] **Step 2: 検証テストを追加し `npm run test` が通ることを確認**
- [ ] **Step 3: 実データでの効果を確認** — 各社の代表駅から `findReachable` を実行し、補正前後で運賃がどう変わったかをレポートに記載
- [ ] **Step 4: Commit** — `feat: JR3社・近鉄・名鉄・東武の運賃表を追加`

---

### Task 3: 主要事業者の運賃表（第2陣: 地下鉄・関西私鉄ほか）

**対象:** 東京メトロ(185) / 広島電鉄(167) / 東京都交通局(149) / Osaka Metro(133) / 富山地方鉄道(121) / 東急電鉄(114) / 南海電鉄(112) / 西武鉄道(110) / 伊予鉄道(110) / 名古屋市交通局(100) / 阪急電鉄(99)

手順は Task 2 と同一。

**注意:** 広島電鉄・伊予鉄道は路面電車が主体で**均一運賃**の区間が多い。均一運賃は `table: [[9999, 220]]` のように 1 段で表現できる。ただし郊外線が別運賃の場合があるので、実態を確認したうえで、単一の表で表現できないなら**その事業者は対象外とし理由を記載する**こと（誤った表を入れるより、汎用フォールバックのままのほうがよい）。

- [ ] **Step 1: 各社の運賃表を調査・作成**
- [ ] **Step 2: 検証テストを追加**
- [ ] **Step 3: 実データでの効果を確認**
- [ ] **Step 4: Commit** — `feat: 地下鉄・関西私鉄ほかの運賃表を追加`

---

### Task 4: 汎用フォールバック表の再調整と全体検証

**Files:**
- Modify: `data/fare-rules/generic-private.json`
- Create: `scripts/pipeline/fare-report.ts`（任意）

- [ ] **Step 1: フォールバックに残った事業者の実態を調べる**

上位 20 社を入れてもなお約 32% の駅がフォールバックに残る。それらがどんな事業者か（中小私鉄・第三セクター・路面電車）を集計し、代表的な数社の実運賃を調べて、フォールバック表が実態に近いか確認する。現行の値（3km:160 / 6km:200 / 10km:250 / 15km:300 / 20km:360 / 30km:430 / 40km:510 / 50km:590）は根拠が弱いので、調査結果に基づいて調整する。

- [ ] **Step 2: README に精度の説明を追記**

どの事業者が専用表で、どこからがフォールバックなのか、精度の期待値はどの程度かをユーザーに分かる形で書く。UI にも「概算」であることの注記があるか確認する。

- [ ] **Step 3: 全体の効果測定**

代表的な区間 10 件以上について、改善前（v1）・改善後の概算と実運賃を並べた表をレポートに残す。

- [ ] **Step 4: Commit** — `feat: 汎用運賃表を実態に合わせて調整`

---

### Task 5: 特定運賃（駅ペア単位の割引運賃）への対応

**背景:** JR は私鉄と競合する区間に、距離に応じた通常運賃より安い「特定運賃」を設定している。現行のデータモデルは事業者ごとに 1 つの距離→運賃表しか持てないため表現できず、大阪→京都は実運賃 580 円に対し 770 円（+33%）と出る。首都圏・京阪神の主要区間に効くため、最も検索される場所の精度に直結する。

**Files:**
- Create: `data/fare-overrides/jr-east.json`, `data/fare-overrides/jr-west.json`（ほか判明した事業者）
- Modify: `lib/fare/types.ts`, `lib/fare/calculator.ts`, `lib/search/reachable.ts`, `lib/server/graph-store.ts`
- Test: `lib/fare/__tests__/calculator.test.ts`, `lib/search/__tests__/reachable.test.ts`

**Interfaces（変更あり。後続が依存するので厳密に）:**

```ts
// lib/fare/types.ts に追加
export const fareOverrideSchema = z.object({
  operator: z.string(),
  pairs: z.array(z.object({
    from: z.string(),   // 駅名（graph.json の name と一致させる）
    to: z.string(),
    fare: z.number().int().positive(),
  })),
  source: z.object({ url: z.string(), fetchedAt: z.string(), note: z.string() }),
});
export type FareOverride = z.infer<typeof fareOverrideSchema>;

// lib/fare/calculator.ts — 第4引数を追加（既存呼び出しを壊さないよう任意引数にする）
export interface FareCalculator {
  estimate(operator: string, km: number, fromName?: string, toName?: string): number;
}
export function createFareCalculator(rules: FareRule[], overrides?: FareOverride[]): FareCalculator;
```

- `estimate` は `fromName`/`toName` が与えられ、その事業者の override に該当ペアがあれば**その運賃を返す**（方向は問わない。`from`/`to` を入れ替えても一致させる）。無ければ従来どおり距離表を引く
- override は「その事業者の乗車区間全体」に対して適用される。区間の途中駅ペアには適用しない

**探索側の変更:** `SearchState` に `segFromId: string` を追加し、事業者区間の開始駅を保持する。区間を確定するとき（事業者変更時・最終評価時）に `estimate(operator, km, 開始駅名, 現在駅名)` を呼ぶ。

- [ ] **Step 1: 特定運賃の一覧を調査する**

JR東日本・JR西日本の公式サイトから特定区間運賃（特定運賃）の一覧を取得する。**必ず出典を確認すること。記憶で書かない。** 件数が多い場合は、駅数の多い主要区間から入れる。見つからない事業者は入れない。

調査結果（件数・出典 URL・代表例）をレポートに記載すること。

- [ ] **Step 2: 失敗するテストを書く**

`lib/fare/__tests__/calculator.test.ts` に、override が効くことを検証するテストを追加する:

```ts
it("特定運賃が設定された駅ペアは距離表ではなく特定運賃を返す", () => {
  // 大阪→京都: 営業キロ 42.8km。幹線表なら 770 円だが特定運賃 580 円
  expect(calc.estimate("JR西日本", 42.8, "大阪", "京都")).toBe(580);
});
it("方向を入れ替えても同じ特定運賃になる", () => {
  expect(calc.estimate("JR西日本", 42.8, "京都", "大阪")).toBe(580);
});
it("駅名を与えなければ従来どおり距離表を引く", () => {
  expect(calc.estimate("JR西日本", 42.8)).toBe(770);
});
it("特定運賃の無いペアは距離表を引く", () => {
  expect(calc.estimate("JR西日本", 42.8, "大阪", "存在しない駅")).toBe(770);
});
```

`lib/search/__tests__/reachable.test.ts` にも、**探索経由で特定運賃が適用されること**を検証するテストを追加する（合成グラフで、区間開始駅と終了駅のペアに override を設定し、その運賃が採用されることを確認する）。区間の途中駅には適用されないことも検証すること。

- [ ] **Step 3: 実装** — 上記 Interfaces のとおり。`getGraphStore` は `data/fare-overrides/*.json` を読み込んで `createFareCalculator` に渡す

- [ ] **Step 4: 効果測定** — 大阪→京都をはじめ、特定運賃を入れた区間について修正前後の概算と実運賃を並べた表をレポートに記載する

- [ ] **Step 5: Commit** — `feat: 特定運賃（駅ペア単位の割引運賃）に対応`

---

### Task 6: 上位20社の残り（地下鉄・関西私鉄ほか）

Task 3 と同じ内容。**対象:** 東京メトロ(185) / 広島電鉄(167) / 東京都交通局(149) / Osaka Metro(133) / 富山地方鉄道(121) / 東急電鉄(114) / 南海電鉄(112) / 西武鉄道(110) / 伊予鉄道(110) / 名古屋市交通局(100) / 阪急電鉄(99)

手順は Task 2 と同一（公式出典の確認 → JSON 作成 → `source` に出典記録 → **実運賃との完全一致テスト**を各社 3 件以上）。

**重要な注意:**
- テストに使う区間は**加算運賃・特定運賃の対象外**であることを確認すること（Task 2 で名鉄の空港線加算運賃を見落とした前例がある）
- 許容誤差は使わない。完全一致にできない区間はテストに使わない
- 広島電鉄・伊予鉄道は路面電車主体で**均一運賃**の区間が多い。均一なら `table: [[9999, 220]]` のように 1 段で表現できるが、郊外線が別運賃なら単一表で表現できない。その場合は**その事業者を対象外とし、理由を記載する**こと（誤った表を入れるより汎用フォールバックのままのほうがよい）
