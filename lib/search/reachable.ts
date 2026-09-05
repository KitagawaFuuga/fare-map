import { HONSHU_OPERATORS, type FareCalculator } from "@/lib/fare/calculator";
import type { RailGraph } from "@/lib/graph/types";
import { MinHeap } from "@/lib/search/heap";

export interface ReachableStation {
  id: string;
  fare: number;
}

interface SearchState {
  stationId: string;
  doneFare: number; // 確定済み区間の運賃合計
  segOperator: string; // 進行中区間の事業者（"" = 未乗車）
  segFromId: string; // 進行中区間の開始駅（特定運賃は区間全体の駅ペアに適用するため必要）
  segKm: number; // 進行中区間の距離
  // 進行中区間が「加算額除外区間（isEastKmExcludedEdge）だけで構成されている」か
  // どうかの一方向ラチェット（true→falseのみ）。区間の起点が東京都区内・
  // 山手線内の駅かどうかは**含まない**（純粋にlineIdの連続性だけを見る）。
  // 起点・終端の適格性チェックは segEastKmContribution が別途行う
  // （レビュー指摘: 起点だけを見ると、上り方向で除外が発動しない非対称
  // バグになる。詳細は isEligibleExclusionName・segEastKmContribution
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
  segPureExcludedLine: boolean;
  // 現在進行中区間の起点（segFromId）が、東京都区内・山手線内の駅
  // （isEligibleExclusionName の近似集合）に属するかどうか。区間の開始時に
  // 一度だけ計算し、区間が続く間は不変（honshuThrough と同じパターン）。
  // segEastKmContribution が「起点 or 終端のどちらかが適格なら除外が適用
  // される」判定に使う。honshuThrough・segPureExcludedLine と同様、大小
  // 比較に意味がない真偽値なので dominates() には混ぜず bucket キーに含める
  // （詳細は「上り方向の非対称バグ」修正のコメント参照）。
  originEligible: boolean;
  // JR本州3社（東日本・東海・西日本）間の会社境界を1回以上跨いで通算中かどうか。
  // 跨いだ瞬間に true になり、doneFare の確定を止めて基準額＋加算額方式
  // （calc.estimateHonshuThrough）を使う。JR以外の事業者へ乗り継いで区間が
  // 確定したら false に戻る。
  //
  // honshuKm（下記）が 0 であることをこのフラグの代わりに使ってはいけない
  // （レビュー指摘: 距離0のrailエッジで会社境界を跨いだ直後は honshuKm===0 のまま
  // 通算中になり、「距離」と「通算中か否か」を honshuKm 単体で表せなくなる）。
  honshuThrough: boolean;
  // 通算中の距離（まだ確定していない、進行中区間 segKm を含まない直前までの合計）。
  // honshuThrough が false の間は常に 0。
  honshuKm: number;
  // 上記のうち加算額の対象になる距離。honshuKm と同じく進行中区間 segKm 分は
  // 含まない。honshuThrough が false の間は常に 0。
  honshuEastKm: number;
  fare: number; // doneFare + estimate(segOperator, segKm) を状態生成時に確定したもの
  // この状態が Pareto store に挿入された際のエントリへの参照。pop 時の生死判定
  // （stillLive）に使う。bucket をネスト Map から再探索する必要をなくすためのもの。
  entry: ParetoEntry;
}

// 枝刈り用ラベル。(doneFare, segKm) の組み合わせ次第で将来の運賃（override 込み）
// が変わりうるため、単純な「今の運賃が安い方を残す」では正しさを保てない。
// 状態爆発は Pareto 支配（非支配集合のみ残す）で抑える。
//
// 【性能改善(b): 3次元への射影】honshuKm・segKm を別々の次元として持つ代わりに、
// 両者の和である totalKm（総距離）と totalEastKm（加算額対象キロの総和）だけを
// 保持する。この2つに落とせる理由:
//
// - 同一 bucket 内では segOperator・segPureExcludedLine・originEligible
//   （すべて bucket キーの一部。getBucket の segOperator 引数・flagsKey
//   参照）が全エントリで共通なので、segEastKmContribution(segOperator, segKm,
//   segPureExcludedLine, originEligible, toName) は「その bucket の stationId
//   （＝全エントリ共通の終端）と segKm」だけの関数になり、bucket 内では常に
//   「0固定」または「segKm固定」のどちらかに定まる。よって totalEastKm は
//   totalKm・honshuEastKm から一意に決まり、segKm・honshuKm を個別に
//   持たなくても運賃計算（estimateHonshuThrough・honshuThroughBaseFare は
//   どちらも totalKm・eastKm の和にしか依存しない）にも下界計算にも
//   影響しない。
// - honshuThrough === false の bucket では honshuKm・honshuEastKm は常に0
//   （SearchState参照）なので totalKm = segKm・totalEastKm = 従来の
//   eastKm寄与そのものであり、比較結果は変わらない。
// - honshuThrough === true の bucket では、以前の実装（segKm <= segKm' かつ
//   honshuKm <= honshuKm' をそれぞれ要求）より、和だけを比較する今の実装の
//   ほうが真に強い支配になる（例: segKm=0,honshuKm=10 と segKm=10,honshuKm=0
//   は総距離が同じ10kmで運賃が完全に同一になるはずなのに、以前の実装では
//   どちらの内訳が優れているかを比較できず互いに非支配のまま残ってしまう。
//   和だけを見る今の実装ならこの2つは同値として1本にまとまる）。
//
// 【レビュー指摘2の修正: pendingEastKm】上記の「bucket内では0固定またはsegKm固定」
// という主張は "今、この瞬間の" totalEastKm については正しいが、「0固定」の
// bucket（segPureExcludedLine=true かつ 起点/終端のどちらかが適格）では、
// segKm がラチェットの落下（同一事業者の非除外エッジに当たる）によって
// **将来** 突然「segKm固定」に切り替わりうる。このとき実際に加算されるのは
// 隠れていた segKm の値そのものなので、totalKm（=honshuKm+segKm の和）だけ
// では「将来ラチェットが落ちたときにどれだけ加算額が乗るか」を区別できず、
// segKm が大きい（将来不利な）状態と小さい（将来有利な）状態が
// (doneFare, totalKm, totalEastKm) だけを見ると完全に同一に見えてしまう
// （実測では現在のデータ上は当該 bucket が空で到達しないことを確認済みだが、
// グラフ再生成で新幹線データが加わる等の変更で容易に到達しうる、
// 潜在的な不健全性）。
//
// pendingEastKm = totalEastKm + (現在「0固定」で隠れている場合の segKm) を
// 4次元目として追加し、非 strict に比較する。「segKm固定」の bucket
// （honshuThrough===false を含む）では pendingEastKm は totalEastKm と
// 常に一致する冗長次元になり、比較結果にも性能にも影響しない
// （実データの96%以上を占める）。
export interface ParetoEntry {
  doneFare: number; // 小さいほうが有利
  totalKm: number; // honshuKm + segKm。小さいほうが有利
  totalEastKm: number; // honshuEastKm + セグメントの加算額対象キロ寄与。小さいほうが有利
  // ラチェットが今落ちたら加算されるはずの eastKm（= totalEastKm と、現在
  // 除外中で隠れている honshuKm+segKm の合計のどちらか大きい方、
  // 実際には totalEastKm + 現在隠れている分）。小さいほうが有利。
  pendingEastKm: number;
  fare: number; // 今この駅で降りた場合の運賃
  // 支配されて bucket から取り除かれた（tryInsertPareto の splice 対象になった）
  // ら false にする。SearchState 側がこの entry への参照を直接持つことで、
  // pop 時に「まだ生きているか」を O(1) で判定できる（bucket をネスト Map から
  // 再探索してから線形走査で値一致を確認する必要がなくなる）。
  alive: boolean;
}

// 同一キー内では segFromId と stationId の駅名ペアが全エントリで共通になる。
// override はこの駅名ペアのみで判定され km に依存しないため、override が効く
// 場合は segKm の大小は今の運賃に影響しない。override が効かない場合は運賃表が
// km について単調非減少なので、segKm が小さいほど今の運賃・将来の運賃
// （このまま乗り続けた場合の総距離も相対的に小さくなる）のどちらも同等以上に
// 有利になる。よって「segKm は大きいほうが有利」ではなく「小さいほうが有利」。
// （この向きを逆にすると、同じ路線を往復するだけで segKm が単調増加する状態が
// 永遠に非支配のまま生成され続け、探索が停止しなくなる。）
//
// A が B を支配する: doneFare も segKm も同時に B 以下（同等以上に有利）で、
// どちらか一方は真に有利。両方等しい場合は重複として扱う
// （dominates は非 strict な <= のため、既存が新規を支配し新規は挿入されない＝先着ち）。
function dominates(a: ParetoEntry, b: ParetoEntry): boolean {
  return (
    a.doneFare <= b.doneFare &&
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
  doneFare: 0,
  totalKm: 0,
  totalEastKm: 0,
  pendingEastKm: 0,
  fare: 0,
  alive: false,
});

// 「東京都区内・山手線内から東海道方面へ通し運賃で乗る場合、東京(品川)〜熱海間は
// 東海道新幹線（JR東海）経由として計算されるため、この区間のJR東日本分の加算額は
// 発生しない」という規則（出典:
// https://ameblo.jp/yyrapid/entry-12937999551.html）を、加算額の対象キロ
// （eastKm）を積む際に反映するための判定。
//
// グラフに新幹線データが無いため、対応する在来線区間（JR東海道本線 東京～熱海=
// lineId "11301"、JR山手線=lineId "11302"）を「加算額非対象」の目印として使う
// （data/graph.json の該当ノードで確認済み）。総営業キロ（totalKm）自体は
// 変える必要がない（実際の経路の距離のまま）ので、ここで除外するのは
// 加算額の対象キロ（eastKm）の積み上げだけであり、segKm/honshuKm には影響しない。
//
// 【過小評価バグの修正】この判定は当初、両端ノードの lineId が 11301/11302 かだけを
// 見ており、「乗車が東京都区内・山手線内発（着）か」を一切見ていなかった。lineId
// 11301（JR東海道本線 東京〜熱海、21ノード）には戸塚・大船・藤沢・平塚・小田原・
// 湯河原・横浜など、東京都区内でも山手線内でもない駅が多数含まれる。そのため
// 例えば「小田原→熱海(JR東日本)→(JR東海)」のような経路でも除外が発動し、
// JR東日本区間の加算額が丸ごと0円になる（過小評価）。isEligibleExclusionName
// で「区間の起点または終端が東京都区内・山手線内の駅か」を追加の必要条件に
// することで、除外の発動条件を規則の適用範囲まで絞った。
//
// 【上り方向の非対称バグの修正】当初は「区間の起点」だけを適格性の条件に
// していたが、上り（例: 名古屋→東京）では会社境界（熱海）で新しい区間が
// 始まるため区間の起点が熱海になり、山手線名集合に入らず除外が発動しない
// （実運賃は方向対称のはずなのに、上りだけ加算額が誤って上乗せされる過大
// 評価）。区間の「終端」（＝今この駅で降りた場合の候補停止点。found探索は
// 経路の全通過駅で「ここで降りたら」の運賃を評価するため、区間が閉じる前の
// 中間駅も終端候補になりうる）も適格性の判定対象に加えた
// （segEastKmContribution 参照）。
//
// 既知の限界（task-9-report.md にも明記）:
// - lineId は station.tsv 由来の内部IDであり、グラフ再生成でIDが振り直される
//   可能性がある。再生成時はこの Set の値を要確認。
// - isEligibleExclusionName は「東京都区内」を、実データに存在する
//   山手線（lineId 11302）の駅名集合で近似している。品川・東京は山手線の
//   物理ループ上にあるため、規則の文言「品川・東京〜山手線内の各駅」とも
//   自然に一致するが、東京都区内には山手線の物理ループ上にない駅
//   （中野・亀戸・金町など）も含まれており、それらはこの集合に含まれない。
//   つまりこの判定は本来の「東京都区内」より狭い（安全側＝過大評価にしか
//   ならない）。
// - 逆向きの不完全さ（東京都区内・山手線内の駅でも、11301/11302 以外の
//   路線経由で東海道方面へ入った場合、例えば京浜東北線の蒲田から乗ると
//   除外が効かない）は安全側（過大評価にしかならない）なので許容している。
// - 横浜市内発（新横浜〜熱海が新幹線経由扱いになる規則）はこの実装では
//   対応していない。横浜は東京都区内・山手線内のどちらの駅名集合にも
//   含まれないため、isEligibleExclusionName により除外が発動しなくなった
//   （修正前は逆に、誤って発動し加算額が丸ごと0円になっていた）。
//   横浜市内発の東海道方面（例: 横浜→名古屋）は規則が適用されず、
//   実運賃よりJR東日本分の加算額だけ高く見積もられる可能性がある
//   （安全側の未対応として許容）。
// - SearchState.segPureExcludedLine のコメントの通り、除外区間の後に通常
//   区間が混在する場合は除外区間分の距離も加算額に含めてしまう
//   （安全側の近似）。
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

// 区間を継続する次のエッジを踏まえた segPureExcludedLine の更新。
// 一方向ラチェット（true→falseのみ）: 除外区間でないエッジに一度でも当たったら
// その区間の残り全体にわたって恒久的に false になる。起点・終端の適格性は
// 一切見ない（純粋に lineId の連続性だけを見るラチェット）。
function nextSegPureExcludedLine(
  graph: RailGraph,
  currentlyPure: boolean,
  edge: { from: string; to: string; operator: string },
): boolean {
  return currentlyPure && isEastKmExcludedEdge(graph, edge);
}

// 区間が加算額の対象キロ（eastKm）にいくら寄与するかを返す。
// segOperator が JR東日本 以外なら常に0。
//
// segPureExcludedLine（除外対象lineIdだけで構成された区間かのラチェット）が
// true でも、区間の起点(fromName)・終端(toName)のどちらかが東京都区内・
// 山手線内の駅として適格でなければ寄与は0にならない（=通常どおり segKm を
// 加算する）。終端も見るのは、上り方向（例: 名古屋→東京）で起点（会社境界の
// 熱海）が適格でなくても、終端（東京）が適格なら規則が適用されるべきという
// 対称性のため（レビュー指摘1）。findReachable は経路上の全通過駅で「ここで
// 降りたら」の運賃を評価するため、toName は「区間が確定する真の終端」だけで
// なく「現時点で候補になっている停止点」も含む。
function segEastKmContribution(
  graph: RailGraph,
  segOperator: string,
  segKm: number,
  segPureExcludedLine: boolean,
  fromName: string | undefined,
  toName: string | undefined,
): number {
  if (segOperator !== "JR東日本") return 0;
  if (!segPureExcludedLine) return segKm;
  const exempt =
    isEligibleExclusionName(graph, fromName) ||
    isEligibleExclusionName(graph, toName);
  return exempt ? 0 : segKm;
}

// 進行中区間を「今この駅で降りた場合の運賃」として評価する。honshuThrough
// （＝ JR本州3社間の会社境界を既に1回以上跨いでいる）なら、進行中区間も含めた
// 通算距離・通算加算額対象キロで基準額＋加算額方式を使う。跨いでいなければ
// 通常どおり単一事業者の運賃表（override 込み）を使う。
function segmentFare(
  calc: FareCalculator,
  graph: RailGraph,
  segOperator: string,
  segKm: number,
  segPureExcludedLine: boolean,
  honshuThrough: boolean,
  honshuKm: number,
  honshuEastKm: number,
  fromName: string | undefined,
  toName: string | undefined,
): number {
  if (honshuThrough) {
    const totalKm = honshuKm + segKm;
    const eastKm =
      honshuEastKm +
      segEastKmContribution(
        graph,
        segOperator,
        segKm,
        segPureExcludedLine,
        fromName,
        toName,
      );
    return calc.estimateHonshuThrough(totalKm, eastKm);
  }
  return calc.estimate(segOperator, segKm, fromName, toName);
}

// entry を bucket（同一 (stationId, segOperator, segFromId) の非支配集合）へ挿入する。
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
// 4階層目（honshuThrough・segPureExcludedLine・originEligible の組み合わせ）は、
// エッジを緩和するたびにテンプレートリテラルで新しい文字列を確保するのを
// 避けるため、あらかじめ8本（2^3）の固定文字列リテラルを用意し、それを
// 選んで返すだけにしている（性能改善(a)）。originEligible は「上り方向の
// 非対称バグ」修正（レビュー指摘1）で追加した次元（ParetoEntry のコメント
// 参照）。
export type __internalParetoStore = Map<
  string,
  Map<string, Map<string, Map<string, ParetoEntry[]>>>
>;
type ParetoStore = __internalParetoStore;

// インデックス = (honshuThrough<<2) | (segPureExcludedLine<<1) | originEligible
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
  honshuThrough: boolean,
  segPureExcludedLine: boolean,
  originEligible: boolean,
): string {
  const index =
    (honshuThrough ? 4 : 0) |
    (segPureExcludedLine ? 2 : 0) |
    (originEligible ? 1 : 0);
  const key = FLAG_KEYS[index];
  // FLAG_KEYS は長さ8の固定配列で index は 0-7 の範囲に収まるため必ず存在する。
  if (key === undefined) throw new Error(`unreachable: flagsKey index ${index}`);
  return key;
}

function getBucket(
  store: ParetoStore,
  stationId: string,
  segOperator: string,
  bucketFromId: string,
  flags: string,
): ParetoEntry[] {
  let byOperator = store.get(stationId);
  if (byOperator === undefined) {
    byOperator = new Map();
    store.set(stationId, byOperator);
  }
  let byFrom = byOperator.get(segOperator);
  if (byFrom === undefined) {
    byFrom = new Map();
    byOperator.set(segOperator, byFrom);
  }
  let byFlags = byFrom.get(bucketFromId);
  if (byFlags === undefined) {
    byFlags = new Map();
    byFrom.set(bucketFromId, byFlags);
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

  // bucket キーに使う segFromId 由来のキー。segFromId の駅名がその事業者の
  // override 駅ペアのどちらにも登場しない場合、この区間はどの駅で降りても
  // override を引けない（estimate は fromName が登録ペアのどちらかと一致しない
  // 限り override を見ない）。そのため、このまま乗り続けた場合の将来の運賃は
  // (doneFare, segKm) だけで決まり、segFromId の実際の駅IDが何であるかは
  // 無関係になる。よって override 非対象の起点同士は安全にバケットをマージ
  // してよく、(doneFare, segKm) の Pareto 支配だけで正しさを保ったまま状態数を
  // 抑えられる。
  // ※ 以前のバグは「isOverrideAnchor による絞り込み」自体が原因ではなく、
  //   絞り込み後も単純に「今の運賃が安い方」だけを残し、(doneFare, segKm) の
  //   Pareto 集合を保持していなかったことが原因だった（C-1 相当の再現テスト参照）。
  //
  const bucketFromId = (segOperator: string, segFromId: string): string =>
    calc.isOverrideAnchor(segOperator, nameOf(segFromId)) ? segFromId : "";

  // honshuThrough・segPureExcludedLine・originEligible はどれも true/false で
  // 運賃計算の実質的な式が変わる（または将来の加算額計算に影響する）ため、
  // 大小比較できる次元として dominates() に混ぜず、最初から別バケットに
  // 分離する（詳細は ParetoEntry のコメント参照）。flagsKey が8種類の固定
  // 文字列を返すので、ここでの組み合わせに新たな文字列確保は発生しない。

  const store: ParetoStore = new Map();
  const initialEntry: ParetoEntry = {
    doneFare: 0,
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
      bucketFromId("", fromId),
      flagsKey(false, false, false),
    ),
    initialEntry,
  );
  const initial: SearchState = {
    stationId: fromId,
    doneFare: 0,
    segOperator: "",
    segFromId: fromId,
    segKm: 0,
    segPureExcludedLine: false,
    originEligible: false,
    honshuThrough: false,
    honshuKm: 0,
    honshuEastKm: 0,
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
        // fare の不変条件は doneFare + estimate(segOperator, segKm, 起点名, 現在駅名)。
        // stationId だけ差し替えて fare をそのまま引き継ぐと「現在駅名」に対応する
        // 部分が古いまま（乗り換え前の駅名）になり、override 判定が正しく行われない
        // stale な fare を持つ状態ができてしまう。Pareto 支配は (doneFare, segKm)
        // だけを見て fare を見ないため、この stale な fare が「本当は安い」正しい
        // 状態を誤って支配して消してしまう事故につながる。必ず再計算する。
        next = {
          stationId: edge.to,
          doneFare: state.doneFare,
          segOperator: state.segOperator,
          segFromId: state.segFromId,
          segKm: state.segKm,
          segPureExcludedLine: state.segPureExcludedLine,
          originEligible: state.originEligible,
          honshuThrough: state.honshuThrough,
          honshuKm: state.honshuKm,
          honshuEastKm: state.honshuEastKm,
          fare:
            state.doneFare +
            segmentFare(
              calc,
              graph,
              state.segOperator,
              state.segKm,
              state.segPureExcludedLine,
              state.honshuThrough,
              state.honshuKm,
              state.honshuEastKm,
              nameOf(state.segFromId),
              nameOf(edge.to),
            ),
          entry: PENDING_ENTRY,
        };
      } else if (edge.operator === state.segOperator) {
        const segKm = state.segKm + edge.km;
        const segPureExcludedLine = nextSegPureExcludedLine(
          graph,
          state.segPureExcludedLine,
          { ...edge, from: state.stationId },
        );
        next = {
          stationId: edge.to,
          doneFare: state.doneFare,
          segOperator: state.segOperator,
          segFromId: state.segFromId,
          segKm,
          segPureExcludedLine,
          originEligible: state.originEligible,
          honshuThrough: state.honshuThrough,
          honshuKm: state.honshuKm,
          honshuEastKm: state.honshuEastKm,
          fare:
            state.doneFare +
            segmentFare(
              calc,
              graph,
              state.segOperator,
              segKm,
              segPureExcludedLine,
              state.honshuThrough,
              state.honshuKm,
              state.honshuEastKm,
              nameOf(state.segFromId),
              nameOf(edge.to),
            ),
          entry: PENDING_ENTRY,
        };
      } else if (
        HONSHU_OPERATORS.has(state.segOperator) &&
        HONSHU_OPERATORS.has(edge.operator)
      ) {
        // JR本州3社（東日本・東海・西日本）どうしの会社境界。区間を確定せず、
        // 通算距離（honshuKm）とそのうち加算額対象キロ（honshuEastKm）を
        // 積み増して継続する。doneFare は据え置き（＝ここではまだ運賃を払わない）。
        // ここでの state.stationId は「直前区間の真の終端（会社境界そのもの）」
        // なので、直前区間の適格性判定に nameOf(state.stationId) を終端として
        // 使ってよい（レビュー指摘1: 起点だけでなく終端も見る）。
        const honshuKm = state.honshuKm + state.segKm;
        const honshuEastKm =
          state.honshuEastKm +
          segEastKmContribution(
            graph,
            state.segOperator,
            state.segKm,
            state.segPureExcludedLine,
            nameOf(state.segFromId),
            nameOf(state.stationId),
          );
        const segKm = edge.km;
        // 新しく始まる区間の起点は state.stationId。純粋な lineId 連続性
        // ラチェットと、起点の適格性は別々に持つ（起点だけを条件にすると
        // 上り方向で除外が発動しない非対称バグになるため）。
        const segPureExcludedLine = isEastKmExcludedEdge(graph, {
          ...edge,
          from: state.stationId,
        });
        const originEligible = isEligibleExclusionName(
          graph,
          nameOf(state.stationId),
        );
        const eastKm =
          honshuEastKm +
          segEastKmContribution(
            graph,
            edge.operator,
            segKm,
            segPureExcludedLine,
            nameOf(state.stationId),
            nameOf(edge.to),
          );
        next = {
          stationId: edge.to,
          doneFare: state.doneFare,
          segOperator: edge.operator,
          segFromId: state.stationId,
          segKm,
          segPureExcludedLine,
          originEligible,
          honshuThrough: true,
          honshuKm,
          honshuEastKm,
          fare:
            state.doneFare + calc.estimateHonshuThrough(honshuKm + segKm, eastKm),
          entry: PENDING_ENTRY,
        };
      } else {
        // 事業者切り替え（「JR⇔私鉄」または「私鉄⇔私鉄」、あるいは JR本州3社の
        // 通算が終わって非対象の事業者に移る場合）。進行中区間を確定する。
        // 進行中区間が JR本州3社の通算中（honshuThrough）だった場合は
        // segmentFare が基準額＋加算額方式で確定額を計算する。state.stationId は
        // ここで真に確定する終端なので、そのまま toName として使う。
        const doneFare =
          state.doneFare +
          segmentFare(
            calc,
            graph,
            state.segOperator,
            state.segKm,
            state.segPureExcludedLine,
            state.honshuThrough,
            state.honshuKm,
            state.honshuEastKm,
            nameOf(state.segFromId),
            nameOf(state.stationId),
          );
        next = {
          stationId: edge.to,
          doneFare,
          segOperator: edge.operator,
          segFromId: state.stationId,
          segKm: edge.km,
          // 新しい区間の除外ラチェット・起点適格性。honshuThrough は false に
          // 戻すが、この新区間がのちに別の本州3社会社境界を跨いだ場合に備え、
          // 正しく計算しておく（honshuThrough=false の間は segmentFare からは
          // 参照されない）。
          segPureExcludedLine: isEastKmExcludedEdge(graph, {
            ...edge,
            from: state.stationId,
          }),
          originEligible: isEligibleExclusionName(graph, nameOf(state.stationId)),
          honshuThrough: false,
          honshuKm: 0,
          honshuEastKm: 0,
          fare:
            doneFare +
            calc.estimate(
              edge.operator,
              edge.km,
              nameOf(state.stationId),
              nameOf(edge.to),
            ),
          entry: PENDING_ENTRY,
        };
      }
      // next.fare（今降りた場合の運賃）は override により非単調なので、これで
      // 刈ると「区間の途中は予算超過だが override で安くなる終点」を取りこぼす。
      // 代わりに doneFare（確定済み区間の合計。経路に沿って非減少）に、
      // 進行中区間の「今後どう乗り継いでも絶対にこれを下回らない」下界を足した
      // 値で刈る。
      //
      // 停止性の根拠: この下界は常に 0 以上（lowerBound の実装参照）。よって
      // doneFare + lowerBound > budget でない限り doneFare <= budget が保つ。
      // doneFare は運賃（整数）の和であり budget も有限なので、doneFare が
      // 取りうる値は有限個しかない。したがって「区間を伸ばせば下界が単調に
      // 増加して budget を超える」ことに依らずとも、探索全体は必ず停止する
      // （下界自体は fromName が override anchor の場合に事業者単位の
      // override 最安値で頭打ちになり得るため、km について単調増加するとは
      // 限らない。isOverrideAnchor 非該当の起点では距離表運賃のみが下界になり
      // km について単調非減少になるため、そちらは実際に単調に効く）。
      // JR本州3社の通算中（honshuThrough）は、進行中区間もまとめた総距離の
      // 基準額（加算額抜き）が安全な下界になる。加算額は常に0以上なので、
      // どう乗り継いでも最終運賃がこれを下回ることはない。通常の
      // calc.lowerBound は override 込みの下界だが、通算中は override が
      // 適用されないため使わない。
      const segLowerBound =
        next.honshuThrough
          ? calc.honshuThroughBaseFare(next.honshuKm + next.segKm)
          : calc.lowerBound(next.segOperator, next.segKm, nameOf(next.segFromId));
      if (next.doneFare + segLowerBound > budget) continue;

      const nextBucket = getBucket(
        store,
        next.stationId,
        next.segOperator,
        bucketFromId(next.segOperator, next.segFromId),
        flagsKey(next.honshuThrough, next.segPureExcludedLine, next.originEligible),
      );
      // pendingEastKm: 「今この瞬間にラチェット(segPureExcludedLine)が false に
      // 落ちたら totalEastKm はいくらになるか」＝ segOperator が JR東日本 なら
      // honshuEastKm+segKm（除外が効いていない場合の totalEastKm と同じ式）、
      // それ以外の事業者ならそもそも寄与が常に0なので totalEastKm と同じ値。
      // レビュー指摘2対応: 現在「除外中」で totalEastKm には現れていない
      // segKm を、比較用の4次元目として保持する（詳細は ParetoEntry 参照）。
      const pendingEastKm =
        next.honshuEastKm + (next.segOperator === "JR東日本" ? next.segKm : 0);
      const nextEntry: ParetoEntry = {
        doneFare: next.doneFare,
        totalKm: next.honshuKm + next.segKm,
        totalEastKm:
          next.honshuEastKm +
          segEastKmContribution(
            graph,
            next.segOperator,
            next.segKm,
            next.segPureExcludedLine,
            nameOf(next.segFromId),
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
