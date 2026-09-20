"use client";

import { useCallback, useRef, useState } from "react";
import type { ReachableResult } from "@/lib/server/api-service";

export interface UseReachable {
  data: ReachableResult | null;
  loading: boolean;
  error: string | null;
  // 成功したら true。失敗した場合と、後発の検索に追い越されて結果を破棄した場合は false。
  // 呼び出し側が「成功したときだけ画面を切り替える」判断に使う。
  search(fromId: string, budget: number): Promise<boolean>;
}

export function useReachable(): UseReachable {
  const [data, setData] = useState<ReachableResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 連続呼び出し時、後発より先発のレスポンスが遅れて届いても古い結果で上書きしないための世代カウンタ
  const requestIdRef = useRef(0);

  const search = useCallback(async (fromId: string, budget: number) => {
    const requestId = ++requestIdRef.current;
    // 自分が最新の検索でなければ、結果もエラーも反映せず false を返す
    const isStale = () => requestId !== requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/reachable?from=${encodeURIComponent(fromId)}&budget=${budget}`,
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as ReachableResult;
      if (isStale()) return false;
      setData(result);
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
  }, []);

  return { data, loading, error, search };
}
