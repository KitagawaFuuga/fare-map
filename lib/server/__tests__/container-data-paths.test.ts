import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// graph-store.ts は process.cwd() からの相対パスで data/ 以下を読む。
//
// 実際には Next.js のファイルトレースが data/ を .next/standalone に取り込むので、
// Dockerfile に個別の COPY が無くてもイメージは動く（修正前の Dockerfile でビルドして
// 確認済み）。ただし公式ドキュメント (05-config/01-next-config-js/output.md) が
// 「Next.js might fail to include required files」と明記しているとおり、これは
// ベストエフォートの静的解析であって保証ではない。ここは動的に組んだパスを
// readdirSync でディレクトリ列挙する形なので、解析が外れる条件が揃っている。
// 外れてもローカルでは再現せず、コンテナを起動して初めて ENOENT になる。
//
// そのため COPY を明示したうえで、読む側と配る側の対応が崩れないようここで突き合わせる。
const source = readFileSync("lib/server/graph-store.ts", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");

// path.join(process.cwd(), "data/xxx") の第2引数を集める
const readPaths = [...source.matchAll(/process\.cwd\(\),\s*"([^"]+)"/g)].map(
  (m) => m[1] ?? "",
);

// COPY の転送先。`./`（standalone 一式の展開先）は「何が入っているか分からない」行なので
// 除く。これを数に入れると、暗黙の取り込みに頼ったままでも緑になってしまう。
const copied = [...dockerfile.matchAll(/^COPY\s+.*?\s+(\S+)\s*$/gm)]
  .map((m) => (m[1] ?? "").replace(/^\.\//, ""))
  .filter((p) => p !== "");

describe("Dockerfile と graph-store.ts の整合", () => {
  it("読み取りパスを1つ以上検出できている（正規表現が空振りしていない）", () => {
    expect(readPaths.length).toBeGreaterThan(0);
    expect(copied.length).toBeGreaterThan(0);
  });

  it("サーバーが読む data/ のパスがすべて Docker イメージにコピーされる", () => {
    const missing = readPaths.filter(
      (p) => !copied.some((c) => c === p || p.startsWith(`${c}/`)),
    );
    expect(missing).toEqual([]);
  });
});
