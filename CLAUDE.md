@AGENTS.md

# TDD

`lib/` `app/` `components/` の変更は必ず TDD で行う。実装前に `superpowers:test-driven-development` スキルを使い、
失敗するテストを1つ書いて赤を確認してから最小の実装を書く。
PreToolUse フックの Probity（`probity.config.ts`）が、赤のテストがない実装・テストの同時複数追加・過剰実装をブロックする。
ブロックされたら理由に従ってテストから書き直す。フックを外したり対象外のパスに逃がしたりしない。
