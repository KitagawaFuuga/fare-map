// 探索の優先度付きキュー。lib/search/reachable.ts が「今の運賃が安い状態から順に
// 展開する」ために使う。ライブラリを入れず自前なのは、pop が数十万回走る
// ホットパスで比較関数をインライン化したいため。
export class MinHeap<T> {
  private items: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  // 入れる要素は最後まで手に持ち、親（push）や子（pop）を穴へずらしてから
  // 最後に1回だけ置く。添字はすべて配列の範囲内なので `!` で読む
  // （元実装は sift-down の 1 反復ごとにクロージャを作っていて、約18万回の pop で
  // 数百万個の割当になっていた。ここはホットパス）
  push(item: T): void {
    // 末尾（items.length）を穴として始める。最後の代入か親のずらしで埋まる
    let i = this.items.length;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = this.items[parent]!;
      // Stryker disable next-line EqualityOperator: 同じ優先度どうしの順は決めていない
      if (this.compare(p, item) <= 0) break;
      this.items[i] = p;
      i = parent;
    }
    this.items[i] = item;
  }

  pop(): T | undefined {
    // 空か1件だけなら、並べ直すものが無い
    if (this.items.length <= 1) return this.items.pop();
    const last = this.items.pop()!;
    const top = this.items[0]!;
    const n = this.items.length;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      if (l >= n) break;
      const r = l + 1;
      const child =
        // Stryker disable next-line EqualityOperator: r === n なら範囲外を読んで比較が偽になり左を選ぶのと同じ。同じ優先度の左右はどちらを上げても順は崩れない
        r < n && this.compare(this.items[r]!, this.items[l]!) < 0 ? r : l;
      const c = this.items[child]!;
      // Stryker disable next-line EqualityOperator: 同じ優先度どうしの順は決めていない
      if (this.compare(c, last) >= 0) break;
      this.items[i] = c;
      i = child;
    }
    this.items[i] = last;
    return top;
  }
}
