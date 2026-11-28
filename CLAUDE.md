@AGENTS.md

# コマンド

新しい worktree では最初に `npm i`。終わったと言う前に、変えた範囲に合わせて次を流し、出力を確かめる。

- 単体テスト: `npm test`、1ファイルだけなら `npx vitest run lib/fare/__tests__/calculator.test.ts`
  （Windows ではパスを大文字の `C:` から始める。小文字の `c:` だと全ファイルが 0 test で落ちる）
- 型検査: `npm run typecheck`、lint: `npm run lint`、整形: `npm run format:check`
- E2E: `npm run e2e`

構成・技術の選び方・手順を変える前に `docs/DEVELOPMENT.md` を読み、変えたら更新する。

# TDD

`lib/` `app/` `components/` `hooks/` の変更は必ず TDD で行う。実装前に `superpowers:test-driven-development` スキルを使い、
失敗するテストを1つ書いて赤を確認してから最小の実装を書く。
PreToolUse フックの Probity（`probity.config.ts`）が、赤のテストがない実装・テストの同時複数追加・過剰実装をブロックする。
ブロックされたら理由に従ってテストから書き直す。フックを外したり対象外のパスに逃がしたりしない。
Probity は Edit・Write しか見ないので、これらのディレクトリを Bash・PowerShell（sed -i、リダイレクト、cp など）で
書き換えない。`scripts/hooks/guard-shell-writes.ts` がそうしたコマンドを止める。

全国の路線網（`data/graph.json`）を読むテストと、1件が数秒かかるテスト（リポジトリ全体を読むなど）は
`*.slow.test.ts` の名前にする。ミューテーションテストはこの名前で除外している（`vitest.stryker.config.ts`）。
路線網を読むほうは `lib/__tests__/slow-test-naming.test.ts` が検査し、計測中に readFileSync・fs/promises・JSON の import で読むと `vitest.stryker.setup.ts` が落とす。単体テストは小さな路線網を自分で組む。

# 記録

開発の経緯をコードの外に残す。どれも作業のついでに書き、ユーザーに書かせない。

- 設計判断: 選択肢が2つ以上あった決定は `docs/decisions/` に1件1ファイルで残す（書式は `docs/decisions/README.md`）。
  次のどれかに当たる決定は、案を並べてユーザーに選んでもらってから記録する: 使うデータやその出典が変わる、
  デプロイや CI の流れが変わる、公開される範囲や外部に送る情報が変わる。迷ったら当たるものとして扱う。
  記録の「決めた人」には、ユーザーが選んだか AI が決めたかを書く。
- AI の誤り: フック・テスト・CI・レビューが AI の書いた誤りを止めたら、`docs/ai-incidents.md` に1行足す。
  止められずに後から見つかったものも同じ表に書く。
- PR: 説明に変更の理由を書く。精度・速度・件数が変わる変更は、変更前後の数字を載せる。
