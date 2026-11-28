import { describe, expect, it } from "vitest";
import { MinHeap } from "@/lib/search/heap";

const numCompare = (a: number, b: number): number => a - b;

describe("MinHeap", () => {
  it("空のヒープで pop() は undefined を返す", () => {
    const heap = new MinHeap<number>(numCompare);
    expect(heap.pop()).toBeUndefined();
    expect(heap.size).toBe(0);
  });

  it("要素が1つのとき push して pop するとその要素が返る", () => {
    const heap = new MinHeap<number>(numCompare);
    heap.push(42);
    expect(heap.size).toBe(1);
    expect(heap.pop()).toBe(42);
    expect(heap.size).toBe(0);
    expect(heap.pop()).toBeUndefined();
  });

  it("同じ優先度の要素が複数あっても全件取り出せる", () => {
    const heap = new MinHeap<number>(numCompare);
    for (const v of [5, 5, 5, 5]) heap.push(v);
    expect(heap.size).toBe(4);
    const out: number[] = [];
    let v: number | undefined;
    while ((v = heap.pop()) !== undefined) out.push(v);
    expect(out).toEqual([5, 5, 5, 5]);
  });

  it("ランダムな数列を push して pop し続けると昇順ソートと一致する（sift-down が発火する規模）", () => {
    const n = 500;
    const input: number[] = [];
    for (let i = 0; i < n; i++) {
      input.push(Math.floor(Math.random() * 100000));
    }
    const heap = new MinHeap<number>(numCompare);
    for (const v of input) heap.push(v);
    expect(heap.size).toBe(n);

    const out: number[] = [];
    let v: number | undefined;
    while ((v = heap.pop()) !== undefined) out.push(v);

    const expected = [...input].sort((a, b) => a - b);
    expect(out).toEqual(expected);
  });

  it("push と pop を交互に行っても、その時点の最小を返す", () => {
    const heap = new MinHeap<number>(numCompare);
    const out: (number | undefined)[] = [];
    for (const v of [5, 3, 8]) heap.push(v);
    out.push(heap.pop()); // 3
    for (const v of [1, 9, 4]) heap.push(v);
    out.push(heap.pop(), heap.pop()); // 1, 4
    heap.push(2);
    while (heap.size > 0) out.push(heap.pop());
    expect(out).toEqual([3, 1, 4, 2, 5, 8, 9]);
  });

  it("比較関数の向きに従う（大きい順にもできる）", () => {
    const heap = new MinHeap<[string, number]>((a, b) => b[1] - a[1]);
    for (const item of [
      ["a", 2],
      ["b", 7],
      ["c", 4],
      ["d", 9],
    ] as [string, number][])
      heap.push(item);
    const out: string[] = [];
    for (let v = heap.pop(); v !== undefined; v = heap.pop()) out.push(v[0]);
    expect(out).toEqual(["d", "b", "c", "a"]);
  });

  // 1〜7 件のすべての並びで、取り出しが昇順になる（木の形の場合分けを全部通す）
  it("小さい件数のすべての並びで昇順に取り出せる", () => {
    const permutations = (xs: number[]): number[][] =>
      xs.length <= 1
        ? [xs]
        : xs.flatMap((x, i) =>
            permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map(
              (rest) => [x, ...rest],
            ),
          );
    for (let n = 1; n <= 7; n++) {
      const sorted = Array.from({ length: n }, (_, i) => i);
      for (const order of permutations(sorted)) {
        const heap = new MinHeap<number>(numCompare);
        for (const v of order) heap.push(v);
        const out: number[] = [];
        for (let v = heap.pop(); v !== undefined; v = heap.pop()) out.push(v);
        expect(out).toEqual(sorted);
        expect(heap.size).toBe(0);
      }
    }
  });
});
