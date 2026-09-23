import { HONSHU_OPERATORS, type FareCalculator } from "@/lib/fare/calculator";
import type { RailGraph } from "@/lib/graph/types";
import { MinHeap } from "@/lib/search/heap";

export interface ReachableStation {
  id: string;
  fare: number;
}

interface SearchState {
  stationId: string;
  confirmedFare: number; // 確定済み区間の運賃合計
  segmentOperator: string; // 進行中区間の事業者（"" = 未乗車）
  segmentFromId: string; // 進行中区間の開始駅（特定運賃は区間全体の駅ペアに適用するため必要）
  segmentKm: number; // 進行中区間の距離
  // 進行中区間が加算額除外区間だけで構成されているかの一方向ラチェット
  // （true→falseのみ）。lineId の連続性だけを見て、起点・終端の適格性は
  // segmentEastKmContribution が別に見る。過大評価はしても過小評価はしない近似。
  segmentOnlyExcludedLines: boolean;
  // 区間の起点が東京都区内・山手線内の駅か。区間の開始時に一度だけ計算する。
  segmentOriginInTokyoArea: boolean;
  // JR本州3社間の会社境界を1回以上跨いで通算中か。true の間は confirmedFare を
  // 確定させず、基準額＋加算額方式で計算する。
  // honshuThroughKm===0 を代わりに使ってはいけない（距離0のrailエッジで境界を
  // 跨いだ直後は通算中なのに 0 のままになる）。
  isHonshuThrough: boolean;
  honshuThroughKm: number; // 通算中の距離。segmentKm は含まない。非通算中は 0
  honshuThroughEastKm: number; // うち加算額の対象になる距離
  fare: number; // confirmedFare + 進行中区間の運賃。状態生成時に確定する
  entry: ParetoEntry; // pop 時の生死判定を O(1) にするための挿入先への参照
}

// 枝刈り用ラベル。override があるため「今の運賃が安い方」を残すだけでは正しさを
// 保てず、4次元の非支配集合（Pareto 集合）を保持する。
// 次元の導出は docs/search-design.md「1. Pareto 支配の次元をどう決めたか」。
export interface ParetoEntry {
  confirmedFare: number; // 小さいほうが有利
  totalKm: number; // honshuThroughKm + segmentKm。小さいほうが有利
  totalEastKm: number; // honshuThroughEastKm + セグメントの加算額対象キロ寄与。小さいほうが有利
  pendingEastKm: number; // ラチェットが今落ちたら加算される eastKm。小さいほうが有利
  fare: number; // 今この駅で降りた場合の運賃
  alive: boolean; // 支配されて bucket から取り除かれたら false
}

// 各次元とも「小さいほうが有利」。距離の向きを逆にすると、同じ路線を往復して
// segmentKm が増え続ける状態が非支配のまま生成され、探索が停止しなくなる。
// 非 strict な <= なので、全次元が等しい場合は既存が勝つ（＝先着優先）。
function dominates(a: ParetoEntry, b: ParetoEntry): boolean {
  return (
    a.confirmedFare <= b.confirmedFare &&
    a.totalKm <= b.totalKm &&
    a.totalEastKm <= b.totalEastKm &&
    a.pendingEastKm <= b.pendingEastKm
  );
}

// SearchState.entry のプレースホルダ。挿入成功後に本物へ差し替える。freeze は
// 万一 bucket や heap に漏れて書き込まれたときに TypeError で気づくため。
const PENDING_ENTRY: ParetoEntry = Object.freeze({
  confirmedFare: 0,
  totalKm: 0,
  totalEastKm: 0,
  pendingEastKm: 0,
  fare: 0,
  alive: false,
});

// 「東京都区内・山手線内から東海道方面へ通しで乗る場合、東京〜熱海は新幹線経由
// として計算され JR東日本分の加算額が発生しない」規則の目印。グラフに新幹線が
// 無いので在来線の lineId で代用する。出典・既知の限界は
// docs/search-design.md「2. 加算額の除外区間（東京〜熱海）」。
//
// lineId はグラフ再生成で振り直されうる。振り直されると規則が静かに無効化される
// （または無関係な路線に適用される）ため、期待する路線名を値に持たせて
// lib/graph/__tests__/data-integrity.test.ts が graph.json と突き合わせる。
export const EAST_KM_EXCLUDED_LINES = {
  "11301": "JR東海道本線(東京～熱海)",
  "11302": "JR山手線",
} as const;

// 加算額の対象になる事業者。除外規則も eastKm の集計もこの事業者の区間だけが対象。
export const EAST_KM_OPERATOR = "JR東日本";
export const YAMANOTE_LINE_ID =
  "11302" satisfies keyof typeof EAST_KM_EXCLUDED_LINES;

const EAST_KM_EXCLUDED_LINE_IDS = new Set<string>(
  Object.keys(EAST_KM_EXCLUDED_LINES),
);

function isEastKmExcludedEdge(
  graph: RailGraph,
  edge: { from: string; to: string; operator: string },
): boolean {
  if (edge.operator !== EAST_KM_OPERATOR) return false;
  const fromLine = graph.nodes[edge.from]?.lineId;
  const toLine = graph.nodes[edge.to]?.lineId;
  return (
    fromLine !== undefined &&
    toLine !== undefined &&
    EAST_KM_EXCLUDED_LINE_IDS.has(fromLine) &&
    EAST_KM_EXCLUDED_LINE_IDS.has(toLine)
  );
}

// 「東京都区内・山手線内の駅か」の判定に使う駅名集合。同じ物理駅が路線ごとに
// 別ノードになるため、node id ではなく駅名で照合する。
const yamanoteStationNamesCache = new WeakMap<RailGraph, Set<string>>();

function getYamanoteStationNames(graph: RailGraph): Set<string> {
  let cached = yamanoteStationNamesCache.get(graph);
  if (cached === undefined) {
    cached = new Set();
    for (const n of Object.values(graph.nodes)) {
      if (n.lineId === YAMANOTE_LINE_ID) cached.add(n.name);
    }
    yamanoteStationNamesCache.set(graph, cached);
  }
  return cached;
}

// 区間の起点・終端がこの規則の適用対象になりうるか。lineId とは独立の判定。
function isEligibleExclusionName(
  graph: RailGraph,
  name: string | undefined,
): boolean {
  return name !== undefined && getYamanoteStationNames(graph).has(name);
}

// 除外区間でないエッジに一度でも当たったら、その区間の残り全体で false になる。
function nextSegmentOnlyExcludedLines(
  graph: RailGraph,
  currentlyOnlyExcluded: boolean,
  edge: { from: string; to: string; operator: string },
): boolean {
  return currentlyOnlyExcluded && isEastKmExcludedEdge(graph, edge);
}

// 区間が加算額の対象キロ（eastKm）にいくら寄与するかを返す。起点だけでなく終端も
// 見るのは、上り方向（名古屋→東京）で起点の熱海が適格でなくても終端の東京が適格
// なら規則が適用されるため。起点しか見ないと上りで除外が発動しない（過去に発生）。
function segmentEastKmContribution(
  graph: RailGraph,
  segmentOperator: string,
  segmentKm: number,
  segmentOnlyExcludedLines: boolean,
  fromName: string | undefined,
  toName: string | undefined,
): number {
  if (segmentOperator !== EAST_KM_OPERATOR) return 0;
  if (!segmentOnlyExcludedLines) return segmentKm;
  const exempt =
    isEligibleExclusionName(graph, fromName) ||
    isEligibleExclusionName(graph, toName);
  return exempt ? 0 : segmentKm;
}

// 進行中区間を「今この駅で降りた場合の運賃」として評価する。
function evaluateSegmentFare(
  calc: FareCalculator,
  graph: RailGraph,
  segmentOperator: string,
  segmentKm: number,
  segmentOnlyExcludedLines: boolean,
  isHonshuThrough: boolean,
  honshuThroughKm: number,
  honshuThroughEastKm: number,
  fromName: string | undefined,
  toName: string | undefined,
): number {
  if (isHonshuThrough) {
    const totalKm = honshuThroughKm + segmentKm;
    const eastKm =
      honshuThroughEastKm +
      segmentEastKmContribution(
        graph,
        segmentOperator,
        segmentKm,
        segmentOnlyExcludedLines,
        fromName,
        toName,
      );
    return calc.estimateHonshuThrough(totalKm, eastKm);
  }
  return calc.estimate(segmentOperator, segmentKm, fromName, toName);
}

// bucket の非支配集合へ挿入する。既存に支配されていれば false を返す。呼び出し側が
// 完全な ParetoEntry を渡すのは、dominates に渡るオブジェクトの形を揃えるため。
export function tryInsertPareto(
  bucket: ParetoEntry[],
  entry: ParetoEntry,
): boolean {
  for (const existing of bucket) {
    if (dominates(existing, entry)) return false;
  }
  for (let i = bucket.length - 1; i >= 0; i--) {
    const existing = bucket[i];
    if (existing !== undefined && dominates(entry, existing)) {
      existing.alive = false;
      bucket.splice(i, 1);
    }
  }
  bucket.push(entry);
  return true;
}

// 4階層のネスト Map でキーを表現する（文字列結合による区切り文字衝突を避けるため）。
// 4階層目のフラグ3種はエッジ緩和のたびに文字列を確保しないよう、8本（2^3）の
// 固定リテラルから選ぶ。
export type __internalParetoStore = Map<
  string,
  Map<string, Map<string, Map<string, ParetoEntry[]>>>
>;
type ParetoStore = __internalParetoStore;

// インデックス = (isHonshuThrough<<2) | (segmentOnlyExcludedLines<<1) | segmentOriginInTokyoArea
const FLAG_KEYS = [
  "000",
  "001",
  "010",
  "011",
  "100",
  "101",
  "110",
  "111",
] as const;

function flagsKey(
  isHonshuThrough: boolean,
  segmentOnlyExcludedLines: boolean,
  segmentOriginInTokyoArea: boolean,
): string {
  const index =
    (isHonshuThrough ? 4 : 0) |
    (segmentOnlyExcludedLines ? 2 : 0) |
    (segmentOriginInTokyoArea ? 1 : 0);
  const key = FLAG_KEYS[index];
  // FLAG_KEYS は長さ8の固定配列で index は 0-7 の範囲に収まるため必ず存在する。
  if (key === undefined)
    throw new Error(`unreachable: flagsKey index ${index}`);
  return key;
}

function getBucket(
  store: ParetoStore,
  stationId: string,
  segmentOperator: string,
  originBucketKey: string,
  flags: string,
): ParetoEntry[] {
  let byOperator = store.get(stationId);
  if (byOperator === undefined) {
    byOperator = new Map();
    store.set(stationId, byOperator);
  }
  let byFrom = byOperator.get(segmentOperator);
  if (byFrom === undefined) {
    byFrom = new Map();
    byOperator.set(segmentOperator, byFrom);
  }
  let byFlags = byFrom.get(originBucketKey);
  if (byFlags === undefined) {
    byFlags = new Map();
    byFrom.set(originBucketKey, byFlags);
  }
  let bucket = byFlags.get(flags);
  if (bucket === undefined) {
    bucket = [];
    byFlags.set(flags, bucket);
  }
  return bucket;
}

// Pareto 探索の本体。findReachable とテスト用の内部検査の両方から使う。
function runSearch(
  graph: RailGraph,
  calc: FareCalculator,
  fromId: string,
  budget: number,
): ParetoStore {
  const adjacency = new Map<
    string,
    { to: string; km: number; kind: "rail" | "transfer"; operator: string }[]
  >();
  const addAdj = (
    from: string,
    to: string,
    km: number,
    kind: "rail" | "transfer",
    operator: string,
  ) => {
    const arr = adjacency.get(from) ?? [];
    arr.push({ to, km, kind, operator });
    adjacency.set(from, arr);
  };
  for (const e of graph.edges) {
    addAdj(e.from, e.to, e.km, e.kind, e.operator);
    addAdj(e.to, e.from, e.km, e.kind, e.operator);
  }

  const nameOf = (id: string): string | undefined => graph.nodes[id]?.name;

  // bucket キーに使う segmentFromId 由来のキー。起点が override の駅ペアに
  // 登場しなければ将来の運賃に影響しないので、まとめて "" に潰してよい
  // （docs/search-design.md「isOverrideAnchor が探索を軽くする理屈」）。
  // 駅名をキーにするのは、同じ物理駅が路線ごとに別ノードIDを持つため。
  // 運賃計算は駅名しか見ないので情報は失われず、bucket 数だけが減る。
  const originBucketKey = (
    segmentOperator: string,
    segmentFromId: string,
  ): string => {
    const name = nameOf(segmentFromId);
    return name !== undefined && calc.isOverrideAnchor(segmentOperator, name)
      ? name
      : "";
  };

  const store: ParetoStore = new Map();
  const initialEntry: ParetoEntry = {
    confirmedFare: 0,
    totalKm: 0,
    totalEastKm: 0,
    pendingEastKm: 0,
    fare: 0,
    alive: true,
  };
  tryInsertPareto(
    getBucket(
      store,
      fromId,
      "",
      originBucketKey("", fromId),
      flagsKey(false, false, false),
    ),
    initialEntry,
  );
  const initial: SearchState = {
    stationId: fromId,
    confirmedFare: 0,
    segmentOperator: "",
    segmentFromId: fromId,
    segmentKm: 0,
    segmentOnlyExcludedLines: false,
    segmentOriginInTokyoArea: false,
    isHonshuThrough: false,
    honshuThroughKm: 0,
    honshuThroughEastKm: 0,
    fare: 0,
    entry: initialEntry,
  };
  const heap = new MinHeap<SearchState>((a, b) => a.fare - b.fare);
  heap.push(initial);

  while (heap.size > 0) {
    const state = heap.pop();
    if (state === undefined) break;

    // pop 時点で他状態に支配されて取り除かれていないか。参照を持っているので O(1)。
    if (!state.entry.alive) continue;

    for (const edge of adjacency.get(state.stationId) ?? []) {
      let next: SearchState;
      if (edge.kind === "transfer") {
        // stationId だけ差し替えて fare を引き継ぐと、override 判定に使う「現在駅名」
        // が乗り換え前のままになる。必ず再計算する。
        next = {
          stationId: edge.to,
          confirmedFare: state.confirmedFare,
          segmentOperator: state.segmentOperator,
          segmentFromId: state.segmentFromId,
          segmentKm: state.segmentKm,
          segmentOnlyExcludedLines: state.segmentOnlyExcludedLines,
          segmentOriginInTokyoArea: state.segmentOriginInTokyoArea,
          isHonshuThrough: state.isHonshuThrough,
          honshuThroughKm: state.honshuThroughKm,
          honshuThroughEastKm: state.honshuThroughEastKm,
          fare:
            state.confirmedFare +
            evaluateSegmentFare(
              calc,
              graph,
              state.segmentOperator,
              state.segmentKm,
              state.segmentOnlyExcludedLines,
              state.isHonshuThrough,
              state.honshuThroughKm,
              state.honshuThroughEastKm,
              nameOf(state.segmentFromId),
              nameOf(edge.to),
            ),
          entry: PENDING_ENTRY,
        };
      } else if (edge.operator === state.segmentOperator) {
        const segmentKm = state.segmentKm + edge.km;
        const segmentOnlyExcludedLines = nextSegmentOnlyExcludedLines(
          graph,
          state.segmentOnlyExcludedLines,
          { ...edge, from: state.stationId },
        );
        next = {
          stationId: edge.to,
          confirmedFare: state.confirmedFare,
          segmentOperator: state.segmentOperator,
          segmentFromId: state.segmentFromId,
          segmentKm,
          segmentOnlyExcludedLines,
          segmentOriginInTokyoArea: state.segmentOriginInTokyoArea,
          isHonshuThrough: state.isHonshuThrough,
          honshuThroughKm: state.honshuThroughKm,
          honshuThroughEastKm: state.honshuThroughEastKm,
          fare:
            state.confirmedFare +
            evaluateSegmentFare(
              calc,
              graph,
              state.segmentOperator,
              segmentKm,
              segmentOnlyExcludedLines,
              state.isHonshuThrough,
              state.honshuThroughKm,
              state.honshuThroughEastKm,
              nameOf(state.segmentFromId),
              nameOf(edge.to),
            ),
          entry: PENDING_ENTRY,
        };
      } else if (
        HONSHU_OPERATORS.has(state.segmentOperator) &&
        HONSHU_OPERATORS.has(edge.operator)
      ) {
        // JR本州3社どうしの会社境界。区間を確定せず通算距離を積み増して継続する
        // （＝ここではまだ運賃を払わない）。state.stationId は直前区間の真の終端。
        const honshuThroughKm = state.honshuThroughKm + state.segmentKm;
        const honshuThroughEastKm =
          state.honshuThroughEastKm +
          segmentEastKmContribution(
            graph,
            state.segmentOperator,
            state.segmentKm,
            state.segmentOnlyExcludedLines,
            nameOf(state.segmentFromId),
            nameOf(state.stationId),
          );
        const segmentKm = edge.km;
        const segmentOnlyExcludedLines = isEastKmExcludedEdge(graph, {
          ...edge,
          from: state.stationId,
        });
        const segmentOriginInTokyoArea = isEligibleExclusionName(
          graph,
          nameOf(state.stationId),
        );
        const eastKm =
          honshuThroughEastKm +
          segmentEastKmContribution(
            graph,
            edge.operator,
            segmentKm,
            segmentOnlyExcludedLines,
            nameOf(state.stationId),
            nameOf(edge.to),
          );
        next = {
          stationId: edge.to,
          confirmedFare: state.confirmedFare,
          segmentOperator: edge.operator,
          segmentFromId: state.stationId,
          segmentKm,
          segmentOnlyExcludedLines,
          segmentOriginInTokyoArea,
          isHonshuThrough: true,
          honshuThroughKm,
          honshuThroughEastKm,
          fare:
            state.confirmedFare +
            calc.estimateHonshuThrough(honshuThroughKm + segmentKm, eastKm),
          entry: PENDING_ENTRY,
        };
      } else {
        // 事業者切り替え。進行中区間をここで確定する。
        const confirmedFare =
          state.confirmedFare +
          evaluateSegmentFare(
            calc,
            graph,
            state.segmentOperator,
            state.segmentKm,
            state.segmentOnlyExcludedLines,
            state.isHonshuThrough,
            state.honshuThroughKm,
            state.honshuThroughEastKm,
            nameOf(state.segmentFromId),
            nameOf(state.stationId),
          );
        next = {
          stationId: edge.to,
          confirmedFare,
          segmentOperator: edge.operator,
          segmentFromId: state.stationId,
          segmentKm: edge.km,
          segmentOnlyExcludedLines: isEastKmExcludedEdge(graph, {
            ...edge,
            from: state.stationId,
          }),
          segmentOriginInTokyoArea: isEligibleExclusionName(
            graph,
            nameOf(state.stationId),
          ),
          isHonshuThrough: false,
          honshuThroughKm: 0,
          honshuThroughEastKm: 0,
          fare:
            confirmedFare +
            calc.estimate(
              edge.operator,
              edge.km,
              nameOf(state.stationId),
              nameOf(edge.to),
            ),
          entry: PENDING_ENTRY,
        };
      }
      // next.fare は override により非単調なので、これで刈ると「区間の途中は予算超過
      // だが override で安くなる終点」を取りこぼす。代わりに confirmedFare（経路に
      // 沿って非減少）に区間の下界を足した値で刈る。
      // 停止性の根拠は docs/search-design.md「3. 探索の停止性」。
      const segmentLowerBound = next.isHonshuThrough
        ? calc.honshuThroughBaseFare(next.honshuThroughKm + next.segmentKm)
        : calc.lowerBound(
            next.segmentOperator,
            next.segmentKm,
            nameOf(next.segmentFromId),
          );
      if (next.confirmedFare + segmentLowerBound > budget) continue;

      const nextBucket = getBucket(
        store,
        next.stationId,
        next.segmentOperator,
        originBucketKey(next.segmentOperator, next.segmentFromId),
        flagsKey(
          next.isHonshuThrough,
          next.segmentOnlyExcludedLines,
          next.segmentOriginInTokyoArea,
        ),
      );
      // 今ラチェットが false に落ちたら totalEastKm がいくらになるか。除外中で
      // totalEastKm に現れていない segmentKm を支配判定に残すための次元。
      const pendingEastKm =
        next.honshuThroughEastKm +
        (next.segmentOperator === EAST_KM_OPERATOR ? next.segmentKm : 0);
      const nextEntry: ParetoEntry = {
        confirmedFare: next.confirmedFare,
        totalKm: next.honshuThroughKm + next.segmentKm,
        totalEastKm:
          next.honshuThroughEastKm +
          segmentEastKmContribution(
            graph,
            next.segmentOperator,
            next.segmentKm,
            next.segmentOnlyExcludedLines,
            nameOf(next.segmentFromId),
            nameOf(next.stationId),
          ),
        pendingEastKm,
        fare: next.fare,
        alive: true,
      };
      const inserted = tryInsertPareto(nextBucket, nextEntry);
      if (inserted) {
        next.entry = nextEntry;
        heap.push(next);
      }
    }
  }

  return store;
}

export function findReachable(
  graph: RailGraph,
  calc: FareCalculator,
  fromId: string,
  budget: number,
): ReachableStation[] {
  const store = runSearch(graph, calc, fromId, budget);

  // 同じ駅に複数の状態（由来違い）が残りうるので、駅ごとに最安値へ集約する。
  // budget によるフィルタはここで行う（探索中の fare は非単調なため）。
  const byStation = new Map<string, number>();
  for (const [stationId, byOperator] of store) {
    for (const byFrom of byOperator.values()) {
      for (const byFlags of byFrom.values()) {
        for (const bucket of byFlags.values()) {
          for (const entry of bucket) {
            if (entry.fare > budget) continue;
            if (entry.fare < (byStation.get(stationId) ?? Infinity)) {
              byStation.set(stationId, entry.fare);
            }
          }
        }
      }
    }
  }

  return [...byStation.entries()]
    .map(([id, fare]) => ({ id, fare }))
    .sort((a, b) => a.fare - b.fare);
}

// テスト専用。bucket を直接検査するために ParetoStore をそのまま返す。
// アプリケーションコードから呼んではいけない。
export function __internalRunSearchForTest(
  graph: RailGraph,
  calc: FareCalculator,
  fromId: string,
  budget: number,
): ParetoStore {
  return runSearch(graph, calc, fromId, budget);
}
