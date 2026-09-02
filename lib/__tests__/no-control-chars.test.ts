import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// このプロジェクトではソースファイルへの NUL バイト等の制御文字混入が過去に
// 4 回起きており、そのたびに git がファイルをバイナリ扱いしてレビューで
// 差分が読めなくなった。原因の作業自体を止めることはできないので、
// 混入を機械的に検出する回帰テストとして固定する。
//
// 対象拡張子: .ts / .tsx / .json / .mjs
// 除外ディレクトリ: node_modules / .next / .git / data
//   （data 配下は運賃表など巨大な JSON が大量にあり、キロ程・地理データに
//   由来する非制御文字のマルチバイト文字を誤検出する意図はないため対象外。
//   このテストが検出したいのは「意図せず混入した制御文字」であり、
//   data 配下のファイルはレビュー時に個別に確認されている運賃表データ）
// 許容する制御文字: タブ(\t, 0x09) / 改行(\n, 0x0A) / 復帰(\r, 0x0D)
// 検出対象: 上記以外の C0 制御文字 (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F) と DEL (0x7F)
const TARGET_EXTENSIONS = new Set([".ts", ".tsx", ".json", ".mjs"]);
const EXCLUDED_DIRS = new Set(["node_modules", ".next", ".git", "data"]);
const FORBIDDEN_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

function collectTargetFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectTargetFiles(fullPath));
    } else if (TARGET_EXTENSIONS.has(path.extname(entry))) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("制御文字混入の回帰テスト", () => {
  it("リポジトリ内の .ts/.tsx/.json/.mjs にタブ・改行・復帰以外の制御文字が混入していない", () => {
    const root = process.cwd();
    const files = collectTargetFiles(root);
    expect(files.length).toBeGreaterThan(0); // このテスト自体が空振りしていないことを確認

    const offenders: { file: string; index: number; code: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const match = FORBIDDEN_CONTROL_CHARS.exec(content);
      if (match !== null && match.index !== undefined) {
        const code = content.charCodeAt(match.index);
        offenders.push({
          file: path.relative(root, file),
          index: match.index,
          code: `0x${code.toString(16).padStart(2, "0")}`,
        });
      }
    }

    expect(offenders).toEqual([]);
  });
});
