function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 1 IP が瞬間的に出せるリクエスト数。スライダーを動かすと 1 操作 1 リクエストに
 * なるので、通常操作が引っかからない程度に取る。
 */
export const RATE_LIMIT_CAPACITY = envInt("RATE_LIMIT_CAPACITY", 20);

/**
 * 定常的に許すレート。reachable の探索は最大で秒単位の CPU を使うため、
 * 連続して投げられても 1 コンテナを埋めない値にする。
 */
export const RATE_LIMIT_REFILL_PER_SEC = 0.5;

/** 429 で返す Retry-After（秒）。1 トークン回復するまでの時間。 */
export const RETRY_AFTER_SEC = Math.ceil(1 / RATE_LIMIT_REFILL_PER_SEC);

/** 同じ (from, budget) の探索結果を使い回す件数。3MB のグラフとは別に載る。 */
export const RESULT_CACHE_ENTRIES = envInt("REACHABLE_CACHE_ENTRIES", 200);

export function reachableCacheKey(from: string, budget: number): string {
  return `${from}:${budget}`;
}
