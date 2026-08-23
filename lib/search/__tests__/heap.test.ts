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
});
