import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// graph-store.ts は process.cwd() からの相対パスで data/ 以下を読む。Docker イメージは
// 必要なファイルだけを COPY する作りなので、新しいデータディレクトリを足したときに
// Dockerfile へ追記し忘れると、ローカルでは動くのにコンテナだけが最初の API
// リクエストで ENOENT になる。実際に data/fare-overrides でこれが1か月気づかれずに
// 残っていたため、読む側と配る側の対応をテストで突き合わせる。
const source = readFileSync("lib/server/graph-store.ts", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");

// path.join(process.cwd(), "data/xxx") の第2引数を集める
const readPaths = [...source.matchAll(/process\.cwd\(\),\s*"([^"]+)"/g)].map(
  (m) => m[1] ?? "",
);

const copied = [...dockerfile.matchAll(/^COPY\s+.*?\s+(\S+)\s*$/gm)].map((m) =>
  (m[1] ?? "").replace(/^\.\//, ""),
);

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
