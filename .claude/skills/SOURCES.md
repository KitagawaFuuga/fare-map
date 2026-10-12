# 外部から取り込んだスキル

2026-10-12 に取り込んだ。中身は確認済みで、外部への送信・秘密情報の読み出し・指示の上書きは無かった。
更新するときは、同じ確認をしてから差し替える。

| スキル | 取得元 | コミット | ライセンス |
|---|---|---|---|
| qa-manual-istqb | https://github.com/fugazi/test-automation-skills-agents （skills/qa-manual-istqb） | 65a72d5（2026-10-03） | MIT |
| grill-me-qa | https://github.com/fugazi/test-automation-skills-agents （skills/grill-me-qa） | 65a72d5（2026-10-03） | MIT |
| e2e-reviewer | https://github.com/voidmatcha/e2e-skills （skills/e2e-reviewer。evals/ は除外） | 6ded5e9（2026-10-10） | Apache-2.0 |

## 使うときの注意

- e2e-reviewer の `scripts/scan.sh` は、ローカルに ESLint が無いと、npx で npm から ESLint とプラグインを取得して実行する（隔離した一時ディレクトリで、install スクリプトは無効）。取得させないときは `E2E_SMELL_NO_ESLINT_DOWNLOAD=1` を付ける。ツールは Linux/macOS の固定パスで探すので、Windows の Git Bash では一部の段階が飛ばされる。
- grill-me-qa の HTML 出力テンプレートは Google Fonts を読み込む。
