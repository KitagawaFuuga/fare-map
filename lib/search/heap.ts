// 探索の優先度付きキュー。lib/search/reachable.ts が「今の運賃が安い状態から順に
// 展開する」ために使う。ライブラリを入れず自前なのは、pop が数十万回走る
// ホットパスで比較関数をインライン化したいため。
export class MinHeap<T> {
  private items: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const p = this.items[parent];
      const c = this.items[i];
      if (p === undefined || c === undefined || this.compare(p, c) <= 0) break;
      this.items[parent] = c;
      this.items[i] = p;
      i = parent;
    }
  }

  pop(): T | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      let i = 0;
      // 元実装は sift-down のループ 1 反復ごとに `at` クロージャを生成していた
      // （pop 1 回あたり最大ヒープ高さ分、約18万回の pop で数百万個のクロージャ割当に
      // なる）。挙動を変えずに this.items[k] への直接アクセスへ置き換える。
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        const cur = this.items[smallest];
        if (l < this.items.length && cur !== undefined) {
          const lv = this.items[l];
          if (lv !== undefined && this.compare(lv, cur) < 0) smallest = l;
        }
        const cur2 = this.items[smallest];
        if (r < this.items.length && cur2 !== undefined) {
          const rv = this.items[r];
          if (rv !== undefined && this.compare(rv, cur2) < 0) smallest = r;
        }
        if (smallest === i) break;
        const a = this.items[i];
        const b = this.items[smallest];
        if (a === undefined || b === undefined) break;
        this.items[i] = b;
        this.items[smallest] = a;
        i = smallest;
      }
    }
    return top;
  }
}
