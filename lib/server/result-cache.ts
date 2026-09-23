export interface ResultCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  size(): number;
}

/**
 * 件数上限つきの LRU キャッシュ。
 * Map の反復順が挿入順であることを使い、参照・更新のたびに delete → set で
 * 末尾へ送る。先頭が「最も長く使われていないエントリ」になる。
 */
export function createResultCache<T>(maxEntries: number): ResultCache<T> {
  const entries = new Map<string, T>();

  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key) as T;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    size: () => entries.size,
  };
}
