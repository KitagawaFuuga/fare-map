import { describe, expect, it } from "vitest";
import { createResultCache } from "@/lib/server/result-cache";

describe("createResultCache", () => {
  it("入れた値を同じキーで取り出せる", () => {
    const cache = createResultCache<number>(2);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("入れていないキーは undefined を返す", () => {
    const cache = createResultCache<number>(2);
    expect(cache.get("a")).toBeUndefined();
  });

  it("上限を超えたら最も長く使われていないエントリを捨てる", () => {
    const cache = createResultCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size()).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("get したエントリは捨てられにくくなる", () => {
    const cache = createResultCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // "a" を使ったので、次に落ちるのは "b"
    cache.set("c", 3);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
  });

  it("同じキーへの再投入で件数は増えない", () => {
    const cache = createResultCache<number>(2);
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.size()).toBe(1);
    expect(cache.get("a")).toBe(2);
  });
});
