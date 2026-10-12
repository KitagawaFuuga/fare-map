"use client";

import { useCallback, useRef, useState } from "react";
import type { ReachableResult, WalkResult } from "@/lib/server/api-service";

// 画面に出す駅。viaWalk（運賃が徒歩連絡を前提にしているか）は運賃より後に
// 別の API（/api/reachable/walk）で届くので、届くまでは undefined（印を出さない）
export type ReachableStation = ReachableResult["stations"][number] & {
  viaWalk?: boolean;
};
export interface ReachableView {
  stations: ReachableStation[];
  meta: ReachableResult["meta"];
}

export interface UseReachable {
  data: ReachableView | null;
  loading: boolean;
  error: string | null;
  // 成功したら true。失敗した場合と、後発の検索に追い越されて結果を破棄した場合は false。
  // 呼び出し側が「成功したときだけ画面を切り替える」判断に使う。
  search(fromId: string, budget: number): Promise<boolean>;
}

// 前段のゲートウェイやプロキシは HTML のエラーページを返すことがある。
// JSON として読めなければ、解析エラーの文ではなく状態コードで伝える
async function errorMessageOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // JSON でない応答。下の汎用の文言にする
  }
  return `サーバーに接続できませんでした（HTTP ${res.status}）`;
}

export function useReachable(): UseReachable {
  const [data, setData] = useState<ReachableView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 連続呼び出し時、後発より先発のレスポンスが遅れて届いても古い結果で上書きしないための世代カウンタ
  const requestIdRef = useRef(0);

  // 「徒歩あり」の印を後から付ける。判定には徒歩連絡を抜いたグラフでもう1回の
  // 探索が要るので、運賃を先に表示してから取りに行く。印は補助情報なので、
  // 取れなくても運賃の表示はそのまま続ける。後の検索に追い越されたら捨てる
  const loadWalkMarks = useCallback(
    async (fromId: string, budget: number, isStale: () => boolean) => {
      try {
        const res = await fetch(
          `/api/reachable/walk?from=${encodeURIComponent(fromId)}&budget=${budget}`,
        );
        if (!res.ok) return;
        const walk = (await res.json()) as WalkResult;
        if (isStale()) return;
        const ids = new Set(walk.viaWalkIds);
        setData(
          (d) =>
            d && {
              ...d,
              stations: d.stations.map((s) => ({
                ...s,
                viaWalk: ids.has(s.id),
              })),
            },
        );
      } catch {
        // 通信の失敗。印を出さないだけにする
      }
    },
    [],
  );

  const search = useCallback(
    async (fromId: string, budget: number) => {
      const requestId = ++requestIdRef.current;
      // 自分が最新の検索でなければ、結果もエラーも反映せず false を返す
      const isStale = () => requestId !== requestIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/reachable?from=${encodeURIComponent(fromId)}&budget=${budget}`,
        );
        if (!res.ok) throw new Error(await errorMessageOf(res));
        const result = (await res.json()) as ReachableResult;
        if (isStale()) return false;
        setData(result);
        void loadWalkMarks(fromId, budget, isStale);
        return true;
      } catch (e) {
        if (isStale()) return false;
        setError(e instanceof Error ? e.message : "検索に失敗しました");
        return false;
      } finally {
        // ここも世代チェックが要る。無条件に false にすると、古いレスポンスが
        // 新しいリクエストの実行中スピナーを消してしまう。
        if (!isStale()) setLoading(false);
      }
    },
    [loadWalkMarks],
  );

  return { data, loading, error, search };
}
