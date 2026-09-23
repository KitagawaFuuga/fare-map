export interface RateLimiterOptions {
  /** バケットが保持できるトークン数 = 瞬間的に許すリクエスト数 */
  capacity: number;
  /** 1秒あたりに回復するトークン数 = 定常的に許すレート */
  refillPerSec: number;
  /** 同時に追跡するキーの上限。超えたら最も長く使われていないキーを捨てる */
  maxKeys?: number;
}

export interface RateLimiter {
  /** トークンを1つ消費する。残っていなければ false */
  take(key: string, now: number): boolean;
  size(): number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { capacity, refillPerSec } = opts;
  const maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
  // Map の反復順は挿入順なので、参照のたびに delete → set で末尾へ送れば
  // 先頭が「最も長く使われていないキー」になる。
  const buckets = new Map<string, Bucket>();

  return {
    take(key, now) {
      const existing = buckets.get(key);
      const bucket: Bucket = existing ?? { tokens: capacity, updatedAt: now };
      if (existing) {
        buckets.delete(key);
        const elapsedSec = (now - bucket.updatedAt) / 1000;
        // 回復は容量で頭打ちにする。放置したぶんだけ溜めて一気に使えると
        // レート制限の意味が無くなる。
        bucket.tokens = Math.min(
          capacity,
          bucket.tokens + elapsedSec * refillPerSec,
        );
        bucket.updatedAt = now;
      }

      const allowed = bucket.tokens >= 1;
      if (allowed) bucket.tokens -= 1;

      buckets.set(key, bucket);
      // IP を変えながら叩かれてもメモリが無限に増えないよう、上限で打ち切る。
      // 捨てるのは最も長く使われていないキーなので、連打中のキーは残る。
      while (buckets.size > maxKeys) {
        const oldest = buckets.keys().next();
        if (oldest.done) break;
        buckets.delete(oldest.value);
      }
      return allowed;
    },
    size: () => buckets.size,
  };
}
