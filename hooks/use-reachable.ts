"use client";

import { useCallback, useRef, useState } from "react";
import type { ReachableResult } from "@/lib/server/api-service";

export interface UseReachable {
  data: ReachableResult | null;
  loading: boolean;
  error: string | null;
  search(fromId: string, budget: number): Promise<void>;
}

export function useReachable(): UseReachable {
  const [data, setData] = useState<ReachableResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 連続呼び出し時、後発より先発のレスポンスが遅れて届いても古い結果で上書きしないための世代カウンタ
  const requestIdRef = useRef(0);

  const search = useCallback(async (fromId: string, budget: number) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reachable?from=${encodeURIComponent(fromId)}&budget=${budget}`);
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as ReachableResult;
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : "検索に失敗しました");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  return { data, loading, error, search };
}
