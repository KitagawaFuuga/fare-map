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
  // 進行中区間が「加算額除外区間（isEastKmExcludedEdge）だけで構成されている」か
  // どうかの一方向ラチェット（true→falseのみ）。区間の起点が東京都区内・
  // 山手線内の駅かどうかは**含まない**（純粋にlineIdの連続性だけを見る）。
  // 起点・終端の適格性チェックは segmentEastKmContribution が別途行う
  // （レビュー指摘: 起点だけを見ると、上り方向で除外が発動しない非対称
  // バグになる。詳細は isEligibleExclusionName・segmentEastKmContribution
  // のコメント参照）。
  //
  // 除外区間でないエッジを1本でも通ると、この区間の残り全体にわたって
  // 恒久的に false になる。これは「除外区間の後に通常区間が混在する」場合、
  // 除外できるはずの先頭部分の距離も加算額に含めてしまう、という安全側
  // （絶対に過小評価しない）の近似である。正確な精算（除外区間の分だけを
  // 差し引く）には距離を連続値として保持する設計が必要だが、それは Pareto
  // 支配のための次元を1つ増やし、東京都心部のJR東日本ネットワーク
  // （山手線・中央線等が密に絡み合う）で組み合わせ爆発を起こすことを実測で
  // 確認した（budget=1500円のような小さな探索でも数十倍に悪化）。真偽値
  // としてバケットキーに畳み込む今の設計は、その爆発を避けつつ「絶対に
  // 安全側（過大評価はしても過小評価はしない）」を保つ。
  segmentOnlyExcludedLines: boolean;
  // 現在進行中区間の起点（segmentFromId）が、東京都区内・山手線内の駅
  // （isEligibleExclusionName の近似集合）に属するかどうか。区間の開始時に
  // 一度だけ計算し、区間が続く間は不変（isHonshuThrough と同じパターン）。
  // segmentEastKmContribution が「起点 or 終端のどちらかが適格なら除外が適用
  // される」判定に使う。isHonshuThrough・segmentOnlyExcludedLines と同様、大小
  // 比較に意味がない真偽値なので dominates() には混ぜず bucket キーに含める
  // （詳細は「上り方向の非対称バグ」修正のコメント参照）。
  segmentOriginInTokyoArea: boolean;
  // JR本州3社（東日本・東海・西日本）間の会社境界を1回以上跨いで通算中かどうか。
  // 跨いだ瞬間に true になり、confirmedFare の確定を止めて基準額＋加算額方式
  // （calc.estimateHonshuThrough）を使う。JR以外の事業者へ乗り継いで区間が
  // 確定したら false に戻る。
  //
  // honshuThroughKm（下記）が 0 であることをこのフラグの代わりに使ってはいけない
  // （レビュー指摘: 距離0のrailエッジで会社境界を跨いだ直後は honshuThroughKm===0 のまま
  // 通算中になり、「距離」と「通算中か否か」を honshuThroughKm 単体で表せなくなる）。
  isHonshuThrough: boolean;
  // 通算中の距離（まだ確定していない、進行中区間 segmentKm を含まない直前までの合計）。
  // isHonshuThrough が false の間は常に 0。
  honshuThroughKm: number;
  // 上記のうち加算額の対象になる距離。honshuThroughKm と同じく進行中区間 segmentKm 分は
  // 含まない。isHonshuThrough が false の間は常に 0。
  honshuThroughEastKm: number;
  fare: number; // confirmedFare + estimate(segmentOperator, segmentKm) を状態生成時に確定したもの
  // この状態が Pareto store に挿入された際のエントリへの参照。pop 時の生死判定
  // （stillLive）に使う。bucket をネスト Map から再探索する必要をなくすためのもの。
  entry: ParetoEntry;
}

// 枝刈り用ラベル。override により「今の運賃が安い方」を残すだけでは正しさを保てない
// ため、非支配集合（Pareto 集合）のみを残す。比較次元は4つ。
//
// 距離は segmentKm・honshuThroughKm を個別に持たず和（totalKm）に射影してある。
// 同一 bucket 内では加算額寄与が「0固定」か「segmentKm固定」のどちらかに定まり、
// 運賃計算も距離の和にしか依存しないため、内訳を分けても支配判定が弱くなるだけ。
// pendingEastKm は「今ラチェットが落ちたら加算される eastKm」で、0固定の bucket で
// 隠れている segmentKm を区別するための4次元目（それ以外では totalEastKm と一致する）。
// 導出と根拠は docs/search-design.md「1. Pareto 支配の次元をどう決めたか」。
export interface ParetoEntry {
  confirmedFare: number; // 小さいほうが有利
  totalKm: number; // honshuThroughKm + segmentKm。小さいほうが有利
  totalEastKm: number; // honshuThroughEastKm + セグメントの加算額対象キロ寄与。小さいほうが有利
  // ラチェットが今落ちたら加算されるはずの eastKm（= totalEastKm と、現在
  // 除外中で隠れている honshuThroughKm+segmentKm の合計のどちらか大きい方、
  // 実際には totalEastKm + 現在隠れている分）。小さいほうが有利。
  pendingEastKm: number;
  fare: number; // 今この駅で降りた場合の運賃
  // 支配されて bucket から取り除かれた（tryInsertPareto の splice 対象になった）
  // ら false にする。SearchState 側がこの entry への参照を直接持つことで、
  // pop 時に「まだ生きているか」を O(1) で判定できる（bucket をネスト Map から
  // 再探索してから線形走査で値一致を確認する必要がなくなる）。
  alive: boolean;
}

// 同一キー内では segmentFromId と stationId の駅名ペアが全エントリで共通になる。
// override はこの駅名ペアのみで判定され km に依存しないため、override が効く
// 場合は segmentKm の大小は今の運賃に影響しない。override が効かない場合は運賃表が
// km について単調非減少なので、segmentKm が小さいほど今の運賃・将来の運賃
// （このまま乗り続けた場合の総距離も相対的に小さくなる）のどちらも同等以上に
// 有利になる。よって「segmentKm は大きいほうが有利」ではなく「小さいほうが有利」。
// （この向きを逆にすると、同じ路線を往復するだけで segmentKm が単調増加する状態が
// 永遠に非支配のまま生成され続け、探索が停止しなくなる。）
//
// A が B を支配する: confirmedFare も segmentKm も同時に B 以下（同等以上に有利）で、
// どちらか一方は真に有利。両方等しい場合は重複として扱う
// （dominates は非 strict な <= のため、既存が新規を支配し新規は挿入されない＝先着ち）。
function dominates(a: ParetoEntry, b: ParetoEntry): boolean {
  return (
    a.confirmedFare <= b.confirmedFare &&
    a.totalKm <= b.totalKm &&
    a.totalEastKm <= b.totalEastKm &&
    a.pendingEastKm <= b.pendingEastKm
  );
}

// SearchState.entry の一時的なプレースホルダ。Pareto store への挿入が成功する
// までは本物の entry が決まらないが、next オブジェクトは最初から entry
// フィールドを持たせておきたい（後から spread で足すと V8 の隠れクラスが
// 変わり、余分なオブジェクト生成コストもかかる）。挿入成功後に必ず本物の
// entry で上書きするので、この値自体が bucket や heap に混入することはない。
// Object.freeze しておくことで、万一 bucket や heap にこの値が誤って
// 混入し書き込まれた場合に TypeError で即座に露見するようにする（コストゼロ）。
const PENDING_ENTRY: ParetoEntry = Object.freeze({
  confirmedFare: 0,
  totalKm: 0,
  totalEastKm: 0,
  pendingEastKm: 0,
  fare: 0,
  alive: false,
});

// 「東京都区内・山手線内から東海道方面へ通し運賃で乗る場合、東京(品川)〜熱海間は
// 新幹線(JR東海)経由として計算されるため JR東日本分の加算額が発生しない」規則の目印。
// グラフに新幹線データが無いので、対応する在来線の lineId（東海道本線 東京〜熱海=11301、
// 山手線=11302）で代用する。除外するのは加算額の対象キロだけで、総営業キロは変えない。
//
// この lineId だけでは不十分で、区間の起点または終端が東京都区内・山手線内の駅である
// ことも必要（isEligibleExclusionName）。起点だけを見ると上り方向で除外が発動しない
// 非対称バグになる。規則の出典・過去2件のバグ・既知の限界（横浜市内発の未対応など）は
// docs/search-design.md「2. 加算額の除外区間（東京〜熱海）」。
// ※ lineId はグラフ再生成で振り直されうるため、再生成時はこの値を要確認。
const EAST_KM_EXCLUDED_LINE_IDS = new Set(["11301", "11302"]);

function isEastKmExcludedEdge(
  graph: RailGraph,
  edge: { from: string; to: string; operator: string },
): boolean {
  if (edge.operator !== "JR東日本") return false;
  const fromLine = graph.nodes[edge.from]?.lineId;
  const toLine = graph.nodes[edge.to]?.lineId;
  return (
    fromLine !== undefined &&
    toLine !== undefined &&
    EAST_KM_EXCLUDED_LINE_IDS.has(fromLine) &&
    EAST_KM_EXCLUDED_LINE_IDS.has(toLine)
  );
}

// 「東京都区内・山手線内の駅か」の判定に使う駅名集合。実データでは同じ物理駅
// （例: 東京・品川）が路線ごとに別ノード（lineId違い）として存在するため、
// 駅名で照合する（node id では駅の同一性を判定できない）。グラフごとに
// キャッシュする（同一 graph オブジェクトに対して runSearch が何度も
// 呼ばれても再計算しないため）。
const yamanoteStationNamesCache = new WeakMap<RailGraph, Set<string>>();

function getYamanoteStationNames(graph: RailGraph): Set<string> {
  let cached = yamanoteStationNamesCache.get(graph);
  if (cached === undefined) {
    cached = new Set();
    for (const n of Object.values(graph.nodes)) {
      if (n.lineId === "11302") cached.add(n.name);
    }
    yamanoteStationNamesCache.set(graph, cached);
  }
  return cached;
}

// name が「東京都区内・山手線内の駅」（の近似集合）に属するかどうか。
// isEastKmExcludedEdge が見る lineId とは独立に、区間の起点・終端の駅名が
// この規則の適用対象になりうるかを判定する。stationId ではなく既に解決済みの
// 駅名を受け取る（呼び出し側はほぼ常に nameOf() 済みの値を持っているため、
// 二重に stationId→name のルックアップをする必要がない）。
function isEligibleExclusionName(
  graph: RailGraph,
  name: string | undefined,
): boolean {
  return name !== undefined && getYamanoteStationNames(graph).has(name);
}

// 区間を継続する次のエッジを踏まえた segmentOnlyExcludedLines の更新。
// 一方向ラチェット（true→falseのみ）: 除外区間でないエッジに一度でも当たったら
// その区間の残り全体にわたって恒久的に false になる。起点・終端の適格性は
// 一切見ない（純粋に lineId の連続性だけを見るラチェット）。
function nextSegmentOnlyExcludedLines(
  graph: RailGraph,
  currentlyOnlyExcluded: boolean,
  edge: { from: string; to: string; operator: string },
): boolean {
  return currentlyOnlyExcluded && isEastKmExcludedEdge(graph, edge);
}

// 区間が加算額の対象キロ（eastKm）にいくら寄与するかを返す。
// segmentOperator が JR東日本 以外なら常に0。
//
// segmentOnlyExcludedLines（除外対象lineIdだけで構成された区間かのラチェット）が
// true でも、区間の起点(fromName)・終端(toName)のどちらかが東京都区内・
// 山手線内の駅として適格でなければ寄与は0にならない（=通常どおり segmentKm を
// 加算する）。終端も見るのは、上り方向（例: 名古屋→東京）で起点（会社境界の
// 熱海）が適格でなくても、終端（東京）が適格なら規則が適用されるべきという
// 対称性のため（レビュー指摘1）。findReachable は経路上の全通過駅で「ここで
// 降りたら」の運賃を評価するため、toName は「区間が確定する真の終端」だけで
// なく「現時点で候補になっている停止点」も含む。
function segmentEastKmContribution(
  graph: RailGraph,
  segmentOperator: string,
  segmentKm: number,
  segmentOnlyExcludedLines: boolean,
  fromName: string | undefined,
  toName: string | undefined,
): number {
  if (segmentOperator !== "JR東日本") return 0;
  if (!segmentOnlyExcludedLines) return segmentKm;
  const exempt =
    isEligibleExclusionName(graph, fromName) ||
    isEligibleExclusionName(graph, toName);
  return exempt ? 0 : segmentKm;
}

// 進行中区間を「今この駅で降りた場合の運賃」として評価する。isHonshuThrough
// （＝ JR本州3社間の会社境界を既に1回以上跨いでいる）なら、進行中区間も含めた
// 通算距離・通算加算額対象キロで基準額＋加算額方式を使う。跨いでいなければ
// 通常どおり単一事業者の運賃表（override 込み）を使う。
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

// entry を bucket（同一 (stationId, segmentOperator, segmentFromId) の非支配集合）へ挿入する。
// 既存のいずれかに支配されていれば挿入せず false を返す。
// 挿入する場合、entry に支配される既存エントリは取り除く（alive を false にしてから
// splice する。SearchState 側が該当エントリへの参照を保持していれば、bucket を
// 再探索せずに alive フラグだけで生死判定できる）。
//
// 呼び出し側は alive: true を含む完全な ParetoEntry を渡す（bucket に積まれる
// 既存エントリと同じ形の値を渡すことで、内部でオブジェクトを作り直さずそのまま
// push できる。dominates の呼び出しも常に同じ形のオブジェクト同士になり、
// 呼び出しごとに形が変わる＝ V8 が dominates の呼び出しをモノモーフィックに
// 最適化できなくなる、という事態を避けられる）。
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
// テストから bucket を直接検査できるよう export するが、これは
// __internalRunSearchForTest 経由でのみ得られる内部表現であることを示すため
// 型名にも __internal を付けている。
//
// 4階層目（isHonshuThrough・segmentOnlyExcludedLines・segmentOriginInTokyoArea の組み合わせ）は、
// エッジを緩和するたびにテンプレートリテラルで新しい文字列を確保するのを
// 避けるため、あらかじめ8本（2^3）の固定文字列リテラルを用意し、それを
// 選んで返すだけにしている（性能改善(a)）。segmentOriginInTokyoArea は「上り方向の
// 非対称バグ」修正（レビュー指摘1）で追加した次元（ParetoEntry のコメント
// 参照）。
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

// Pareto 探索の本体。alive フラグの生死判定を含む枝刈りロジックはここに閉じ込め、
// 結果集約（findReachable）とテスト用の内部検査（__internalRunSearchForTest）の
// どちらからも同じ探索を再利用できるようにする。
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

  // bucket キーに使う segmentFromId 由来のキー。segmentFromId の駅名がその事業者の
  // override 駅ペアのどちらにも登場しない場合、この区間はどの駅で降りても
  // override を引けない（estimate は fromName が登録ペアのどちらかと一致しない
  // 限り override を見ない）。そのため、このまま乗り続けた場合の将来の運賃は
  // (confirmedFare, segmentKm) だけで決まり、segmentFromId の実際の駅IDが何であるかは
  // 無関係になる。よって override 非対象の起点同士は安全にバケットをマージ
  // してよく、(confirmedFare, segmentKm) の Pareto 支配だけで正しさを保ったまま状態数を
  // 抑えられる。
  // ※ 以前のバグは「isOverrideAnchor による絞り込み」自体が原因ではなく、
  //   絞り込み後も単純に「今の運賃が安い方」だけを残し、(confirmedFare, segmentKm) の
  //   Pareto 集合を保持していなかったことが原因だった（C-1 相当の再現テスト参照）。
  //
  // 【性能改善(1): ノードIDではなく駅名をキーにする】anchor 該当時のキーには
  // 以前 segmentFromId（ノードID）をそのまま使っていたが、探索全体で segmentFromId が
  // 実際に使われるのは nameOf(segmentFromId) を経由した先（evaluateSegmentFare /
  // calc.lowerBound / isOverrideAnchor はいずれも「駅名」だけを見て、
  // ノードIDそのものを見ない）のみ。実データでは同じ物理駅が路線ごとに別
  // ノードID を持つ（例: 東京10ノード・新宿11ノード・上野7ノード）ため、
  // ノードIDをそのままキーにすると同じ駅の別ノードが別バケットに分かれて
  // しまい、運賃計算上まったく区別できないのに bucket 数だけが増えていた。
  // 駅名をキーにすることで、同名の起点は運賃計算上も本当に区別不要な
  // ものだけがまとまる（情報は一切失われない）。
  const originBucketKey = (
    segmentOperator: string,
    segmentFromId: string,
  ): string => {
    const name = nameOf(segmentFromId);
    return name !== undefined && calc.isOverrideAnchor(segmentOperator, name)
      ? name
      : "";
  };

  // isHonshuThrough・segmentOnlyExcludedLines・segmentOriginInTokyoArea はどれも true/false で
  // 運賃計算の実質的な式が変わる（または将来の加算額計算に影響する）ため、
  // 大小比較できる次元として dominates() に混ぜず、最初から別バケットに
  // 分離する（詳細は ParetoEntry のコメント参照）。flagsKey が8種類の固定
  // 文字列を返すので、ここでの組み合わせに新たな文字列確保は発生しない。

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

    // pop 時点で既に他状態に支配されて bucket から取り除かれていないか確認する。
    // state.entry は挿入時の Pareto エントリそのものへの参照なので、bucket を
    // ネスト Map から再探索して線形走査する必要がない（tryInsertPareto が
    // 支配されたエントリを splice する際に alive=false にする）。
    if (!state.entry.alive) continue;

    for (const edge of adjacency.get(state.stationId) ?? []) {
      // entry はこの時点ではまだ確定していない（Pareto store への挿入が成功して
      // 初めて確定する）ので、いったんダミーの PENDING_ENTRY を積んでおき、
      // 挿入成功後に本物の entry で上書きする。next オブジェクト自体は最初から
      // entry フィールドを持った状態で作る（後から spread で entry を足すと、
      // その一手間だけ余分なオブジェクト生成とコピーが発生し、計測上は
      // pop 側の O(1) 化で節約した分より高くついた）。
      let next: SearchState;
      if (edge.kind === "transfer") {
        // fare の不変条件は confirmedFare + estimate(segmentOperator, segmentKm, 起点名, 現在駅名)。
        // stationId だけ差し替えて fare をそのまま引き継ぐと「現在駅名」に対応する
        // 部分が古いまま（乗り換え前の駅名）になり、override 判定が正しく行われない
        // stale な fare を持つ状態ができてしまう。Pareto 支配は (confirmedFare, segmentKm)
        // だけを見て fare を見ないため、この stale な fare が「本当は安い」正しい
        // 状態を誤って支配して消してしまう事故につながる。必ず再計算する。
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
        // JR本州3社（東日本・東海・西日本）どうしの会社境界。区間を確定せず、
        // 通算距離（honshuThroughKm）とそのうち加算額対象キロ（honshuThroughEastKm）を
        // 積み増して継続する。confirmedFare は据え置き（＝ここではまだ運賃を払わない）。
        // ここでの state.stationId は「直前区間の真の終端（会社境界そのもの）」
        // なので、直前区間の適格性判定に nameOf(state.stationId) を終端として
        // 使ってよい（レビュー指摘1: 起点だけでなく終端も見る）。
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
        // 新しく始まる区間の起点は state.stationId。純粋な lineId 連続性
        // ラチェットと、起点の適格性は別々に持つ（起点だけを条件にすると
        // 上り方向で除外が発動しない非対称バグになるため）。
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
        // 事業者切り替え（「JR⇔私鉄」または「私鉄⇔私鉄」、あるいは JR本州3社の
        // 通算が終わって非対象の事業者に移る場合）。進行中区間を確定する。
        // 進行中区間が JR本州3社の通算中（isHonshuThrough）だった場合は
        // evaluateSegmentFare が基準額＋加算額方式で確定額を計算する。state.stationId は
        // ここで真に確定する終端なので、そのまま toName として使う。
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
          // 新しい区間の除外ラチェット・起点適格性。isHonshuThrough は false に
          // 戻すが、この新区間がのちに別の本州3社会社境界を跨いだ場合に備え、
          // 正しく計算しておく（isHonshuThrough=false の間は evaluateSegmentFare からは
          // 参照されない）。
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
      // next.fare は override により非単調なので、これで刈ると「区間の途中は予算超過だが
      // override で安くなる終点」を取りこぼす。代わりに confirmedFare（経路に沿って非減少）
      // に区間の下界を足した値で刈る。通算中は加算額抜きの基準額が安全な下界になる。
      // 停止性は下界の単調性ではなく confirmedFare が有限個しか取りえないことに依る
      // （docs/search-design.md「3. 探索の停止性」）。
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
      // pendingEastKm: 「今この瞬間にラチェット(segmentOnlyExcludedLines)が false に
      // 落ちたら totalEastKm はいくらになるか」＝ segmentOperator が JR東日本 なら
      // honshuThroughEastKm+segmentKm（除外が効いていない場合の totalEastKm と同じ式）、
      // それ以外の事業者ならそもそも寄与が常に0なので totalEastKm と同じ値。
      // レビュー指摘2対応: 現在「除外中」で totalEastKm には現れていない
      // segmentKm を、比較用の4次元目として保持する（詳細は ParetoEntry 参照）。
      const pendingEastKm =
        next.honshuThroughEastKm +
        (next.segmentOperator === "JR東日本" ? next.segmentKm : 0);
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
        // PENDING_ENTRY を本物の entry に差し替える。既存のプロパティへの
        // 代入なので隠れクラスは変わらない（スプレッドで作り直すより安い）。
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

// テスト専用の内部エクスポート。alive フラグの「配線」（tryInsertPareto の外側、
// findReachable 本体での next.entry 差し替えや PENDING_ENTRY の扱い）を
// bucket 単位で直接検査するために ParetoStore をそのまま返す。
// アプリケーションコードから呼んではいけない。
export function __internalRunSearchForTest(
  graph: RailGraph,
  calc: FareCalculator,
  fromId: string,
  budget: number,
): ParetoStore {
  return runSearch(graph, calc, fromId, budget);
}
