"use client";

import { useCallback, useState } from "react";
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

  const search = useCallback(async (fromId: string, budget: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reachable?from=${encodeURIComponent(fromId)}&budget=${budget}`);
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setData((await res.json()) as ReachableResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "検索に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, search };
}
