import type { FareCalculator } from "@/lib/fare/calculator";
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
  fare: number; // doneFare + estimate(segOperator, segKm) を状態生成時に確定したもの
  // 分割乗車抑制（案B）: これまでに乗車した（進行中区間も含む）事業者の集合。
  // 事業者切替のたびに切替先を追加する。同じ事業者へ2回目以降乗ろうとする
  // 経路は「その事業者の切符を2枚買う」ことになるため、切替の分岐で禁止する。
  usedOperators: ReadonlySet<string>;
  // 案A（安全弁）: 事業者切替回数。理論上の状態空間を有界にするための保険で、
  // 実データでの切替回数は数個程度のため通常は効かない。
  switchCount: number;
}

// 状態空間を理論上も有界にするための安全弁（案A）。案Bで同一事業者の再乗車は
// 既に禁止されるため実データでは効かないが、極端な合成グラフで事業者切替が
// 際限なく連鎖するのを防ぐ保険として残す。現実の経路で必要になる事業者数
// （1〜3程度）を大きく上回る値にしてあるため、正当な経路を切り詰めない。
const MAX_OPERATOR_SWITCHES = 6;

// usedOperators を Pareto バケットキーに使うための正規化文字列。
// 集合の順序に依存しないよう事業者名でソートしてから連結する。区切り文字は
// 事業者名に空白を含むもの（例: Osaka Metro）があり単純なスペース区切りでは
// 異なる集合が同じ文字列に衝突しうるため、通常の事業者名には出現しない
// NUL 文字（String.fromCharCode(0)）を使う
// （lib/fare/calculator.ts の pairKey と同じ方針）。
const OPERATOR_KEY_SEPARATOR = String.fromCharCode(0);
function usedOperatorsKey(usedOperators: ReadonlySet<string>): string {
  return [...usedOperators].sort().join(OPERATOR_KEY_SEPARATOR);
}

// 枝刈り用ラベル。(doneFare, segKm) の組み合わせ次第で将来の運賃（override 込み）
// が変わりうるため、単純な「今の運賃が安い方を残す」では正しさを保てない。
// 状態爆発は Pareto 支配（非支配集合のみ残す）で抑える。
interface ParetoEntry {
  doneFare: number; // 小さいほうが有利
  segKm: number; // 小さいほうが有利
  fare: number; // 今この駅で降りた場合の運賃
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
  return a.doneFare <= b.doneFare && a.segKm <= b.segKm;
}

// entry を bucket（同一 (stationId, segOperator, segFromId) の非支配集合）へ挿入する。
// 既存のいずれかに支配されていれば挿入せず false を返す。
// 挿入する場合、entry に支配される既存エントリは取り除く。
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
      bucket.splice(i, 1);
    }
  }
  bucket.push(entry);
  return true;
}

// 4階層のネスト Map でキーを表現する（文字列結合による区切り文字衝突を避けるため）。
// 4段目の usedOperators は分割乗車抑制（案B）の状態。同じ (stationId, segOperator,
// segFromId) でも「今後どの事業者に再乗車できるか」は usedOperators 次第で変わる
// ため、これを分けずに (doneFare, segKm) だけで Pareto 支配すると、
// 「使用済み事業者が多く今は安い状態」が「使用済み事業者が少なく今は高い状態」を
// 誤って握り潰し、後者だけが持つ将来の乗車可能性（＝より安い到達）を消してしまう。
type ParetoStore = Map<
  string,
  Map<string, Map<string, Map<string, ParetoEntry[]>>>
>;

function getBucket(
  store: ParetoStore,
  stationId: string,
  segOperator: string,
  segFromId: string,
  usedOperators: string,
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
  let byUsed = byFrom.get(segFromId);
  if (byUsed === undefined) {
    byUsed = new Map();
    byFrom.set(segFromId, byUsed);
  }
  let bucket = byUsed.get(usedOperators);
  if (bucket === undefined) {
    bucket = [];
    byUsed.set(usedOperators, bucket);
  }
  return bucket;
}

export function findReachable(
  graph: RailGraph,
  calc: FareCalculator,
  fromId: string,
  budget: number,
): ReachableStation[] {
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

  // bucket キーに使う segFromId。segFromId の駅名がその事業者の override 駅ペア
  // のどちらにも登場しない場合、この区間はどの駅で降りても override を引けない
  // （estimate は fromName が登録ペアのどちらかと一致しない限り override を見ない）。
  // そのため、このまま乗り続けた場合の将来の運賃は (doneFare, segKm) だけで
  // 決まり、segFromId の実際の駅IDが何であるかは無関係になる。よって
  // override 非対象の起点同士は安全にバケットをマージしてよく、
  // (doneFare, segKm) の Pareto 支配だけで正しさを保ったまま状態数を抑えられる。
  // ※ 以前のバグは「isOverrideAnchor による絞り込み」自体が原因ではなく、
  //   絞り込み後も単純に「今の運賃が安い方」だけを残し、(doneFare, segKm) の
  //   Pareto 集合を保持していなかったことが原因だった（C-1 相当の再現テスト参照）。
  const bucketFromId = (segOperator: string, segFromId: string): string =>
    calc.isOverrideAnchor(segOperator, nameOf(segFromId)) ? segFromId : "";

  const store: ParetoStore = new Map();
  const initial: SearchState = {
    stationId: fromId,
    doneFare: 0,
    segOperator: "",
    segFromId: fromId,
    segKm: 0,
    fare: 0,
    usedOperators: new Set(),
    switchCount: 0,
  };
  const heap = new MinHeap<SearchState>((a, b) => a.fare - b.fare);
  heap.push(initial);
  tryInsertPareto(
    getBucket(
      store,
      initial.stationId,
      initial.segOperator,
      bucketFromId(initial.segOperator, initial.segFromId),
      usedOperatorsKey(initial.usedOperators),
    ),
    {
      doneFare: initial.doneFare,
      segKm: initial.segKm,
      fare: initial.fare,
    },
  );

  while (heap.size > 0) {
    const state = heap.pop();
    if (state === undefined) break;

    // pop 時点で既に他状態に支配されて bucket から取り除かれていないか確認する。
    const bucket = getBucket(
      store,
      state.stationId,
      state.segOperator,
      bucketFromId(state.segOperator, state.segFromId),
      usedOperatorsKey(state.usedOperators),
    );
    const stillLive = bucket.some(
      (e) => e.doneFare === state.doneFare && e.segKm === state.segKm,
    );
    if (!stillLive) continue;

    for (const edge of adjacency.get(state.stationId) ?? []) {
      let next: SearchState;
      if (edge.kind === "transfer") {
        // fare の不変条件は doneFare + estimate(segOperator, segKm, 起点名, 現在駅名)。
        // stationId だけ差し替えて fare をそのまま引き継ぐと「現在駅名」に対応する
        // 部分が古いまま（乗り換え前の駅名）になり、override 判定が正しく行われない
        // stale な fare を持つ状態ができてしまう。Pareto 支配は (doneFare, segKm)
        // だけを見て fare を見ないため、この stale な fare が「本当は安い」正しい
        // 状態を誤って支配して消してしまう事故につながる。必ず再計算する。
        next = {
          ...state,
          stationId: edge.to,
          fare:
            state.doneFare +
            calc.estimate(
              state.segOperator,
              state.segKm,
              nameOf(state.segFromId),
              nameOf(edge.to),
            ),
        };
      } else if (edge.operator === state.segOperator) {
        const segKm = state.segKm + edge.km;
        next = {
          stationId: edge.to,
          doneFare: state.doneFare,
          segOperator: state.segOperator,
          segFromId: state.segFromId,
          segKm,
          usedOperators: state.usedOperators,
          switchCount: state.switchCount,
          fare:
            state.doneFare +
            calc.estimate(
              state.segOperator,
              segKm,
              nameOf(state.segFromId),
              nameOf(edge.to),
            ),
        };
      } else {
        // 事業者切替。分割乗車抑制（案B）: 既に乗車済み（乗り終えた区間・進行中
        // 区間のどちらでも）の事業者に再び乗ろうとする経路は、その事業者の切符を
        // 2枚買うことになるため禁止する。安全弁（案A）として切替回数にも上限を
        // 設ける（MAX_OPERATOR_SWITCHES のコメント参照）。
        if (state.usedOperators.has(edge.operator)) continue;
        if (state.switchCount >= MAX_OPERATOR_SWITCHES) continue;

        const doneFare =
          state.doneFare +
          calc.estimate(
            state.segOperator,
            state.segKm,
            nameOf(state.segFromId),
            nameOf(state.stationId),
          );
        const usedOperators = new Set(state.usedOperators);
        usedOperators.add(edge.operator);
        next = {
          stationId: edge.to,
          doneFare,
          segOperator: edge.operator,
          segFromId: state.stationId,
          segKm: edge.km,
          usedOperators,
          switchCount: state.switchCount + 1,
          fare:
            doneFare +
            calc.estimate(
              edge.operator,
              edge.km,
              nameOf(state.stationId),
              nameOf(edge.to),
            ),
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
      const segLowerBound = calc.lowerBound(
        next.segOperator,
        next.segKm,
        nameOf(next.segFromId),
      );
      if (next.doneFare + segLowerBound > budget) continue;

      const nextBucket = getBucket(
        store,
        next.stationId,
        next.segOperator,
        bucketFromId(next.segOperator, next.segFromId),
        usedOperatorsKey(next.usedOperators),
      );
      const inserted = tryInsertPareto(nextBucket, {
        doneFare: next.doneFare,
        segKm: next.segKm,
        fare: next.fare,
      });
      if (inserted) heap.push(next);
    }
  }

  // 同じ駅に複数の状態（由来違い）が残りうるので、駅ごとに最安値へ集約する。
  // budget によるフィルタはここで行う（探索中の fare は非単調なため）。
  const byStation = new Map<string, number>();
  for (const [stationId, byOperator] of store) {
    for (const byFrom of byOperator.values()) {
      for (const byUsed of byFrom.values()) {
        for (const bucket of byUsed.values()) {
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
