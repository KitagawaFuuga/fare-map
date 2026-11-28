# 開発メモ

このアプリをどう作っているかの要約。作業するたびに同じ作り方で進めるための基準で、
構成・手順・参照資料が変わったら更新する。決めた経緯は [docs/decisions/](decisions/) に、
AI の誤りは [docs/ai-incidents.md](ai-incidents.md) に分けて残し、ここからはリンクだけ張る。

キーやトークンの値はここに書かない。環境変数の名前と置き場所だけを書く。

## 構成

| 層 | 使っているもの |
|----|----------------|
| 画面 | Next.js 16（App Router）、React 19、Tailwind CSS 4、地図は MapLibre GL 6 + OpenFreeMap のタイル |
| API | Next.js の Route Handler（`app/api/`）。入力の検証は zod 4 |
| 探索 | `lib/search/reachable.ts`。運賃と距離の Pareto 集合を持つ最良優先探索（設計は [search-design.md](search-design.md)） |
| 運賃 | `lib/fare/`。距離帯の運賃表、事業者ごとの特定運賃、加算額 |
| データ | `data/graph.json` などをコミットしておき、実行時は読むだけ。作り直しは `scripts/pipeline/` |
| 配信 | Docker イメージ（`node` ユーザーで実行）を Azure Container Apps へ。`main` への merge がそのままデプロイ |
| CI | GitHub Actions（`ci.yml`、`deploy.yml`、週1回の `mutation.yml`、月1回の `dora.yml`）。部品はコミットハッシュで固定し、トークンは読み取りだけ。静的解析は CodeQL の default setup（Settings → Code security。JS/TS・Actions・Python） |

Next.js 16 は学習データと API が違う。コードを書く前に `node_modules/next/dist/docs/` の該当ページを読む（[AGENTS.md](../AGENTS.md)）。

## ディレクトリ

```
app/          画面と API
components/   画面の部品（地図、入力、一覧、ボトムシート）
lib/search/   到達可能駅の探索
lib/fare/     運賃の計算
lib/graph/    駅・路線グラフと距離
lib/server/   API の中身（グラフの読み込み、レート制限、結果キャッシュ）
data/         コミット済みのデータと補正表
scripts/      データの取得・生成・検証（pipeline/、fare/、analysis/）
e2e/          Playwright
docs/         このメモ、設計判断、テストの記録
```

## 進め方

- **TDD**: `lib/`・`app/`・`components/`・`hooks/` は赤のテストを先に書く。Probity（`probity.config.ts`）が PreToolUse で強制する。Probity は Edit・Write しか見ないので、シェルからの書き換えは `scripts/hooks/guard-shell-writes.ts`（`.claude/settings.json`）が止める。
- **設計判断**: 選択肢が2つ以上あった決定は `docs/decisions/` に1件1ファイル。データの出典・デプロイ・公開範囲に関わるものはユーザーが選ぶ。
- **テストの検出力**: テストは書いた直後は通るので、わざと壊して落ちることを確かめてからコミットする。
  ミューテーションテスト（Stryker）で `lib/` を週1回壊して測る（[0004](decisions/0004-mutation-testing.md)）。全国の路線網を読むテストや1件が数秒かかるテストは `*.slow.test.ts` の名前にする（計測から外す目印）。
- **デプロイ前**: main は CI が通った変更だけ（[0001](decisions/0001-protect-main.md)）、デプロイ前にも E2E（[0002](decisions/0002-e2e-before-deploy.md)）、新しい版は確かめてから本番に流す（[0003](decisions/0003-verify-before-traffic.md)）。
- **供給網**: `uses:` はハッシュとバージョンのコメントで書き、Dependabot の更新 PR で両方を一緒に上げる。脆弱性の報告は `SECURITY.md` の窓口から（[0006](decisions/0006-supply-chain-hardening.md)）。
- **データの正しさ**: 運賃は運賃表との一致ではなく実額で確かめる。表の読み取りを変えたら新旧を比較する。
- **使いやすさと速さ**: アクセシビリティは E2E の中で axe が検査し、serious・critical で CI を止める。表示速度は PR ごとに
  Lighthouse CI で測り、警告だけ出す。開発の流れは DORA の5指標を月1回集計する（[0008](decisions/0008-quality-measurements.md)）。
  本番の障害を revert でなく修正で直したら、コミットのメッセージに `[incident]` を付ける。

## コマンド

| やること | コマンド |
|----------|----------|
| 起動 | `npm i && npm run dev`（http://localhost:3000） |
| データの作り直し | `npm run pipeline:fetch` → `pipeline:build` → `pipeline:validate`（手順は `scripts/pipeline/README.md`） |

テスト・型検査・lint・整形・E2E など、変更を終える前に流す確認は [CLAUDE.md の「コマンド」](../CLAUDE.md) にまとめてある（CI と同じ並び）。
ここに写すと片方だけ直されてずれるので、一覧はそちらだけに置く。

## 環境変数と秘密情報

値はどれもリポジトリに入れない。手元では `.env`（`.gitignore` 済み）、本番では Container App の環境変数、CI では GitHub の Secrets に置く。

| 名前 | 置き場所 | 用途 |
|------|----------|------|
| `EKISPERT_API_KEY` | `.env` / Container App | 駅すぱあと API。無ければ経路リンクが Google Maps になる（任意） |
| `RATE_LIMIT_CAPACITY`、`REACHABLE_CACHE_ENTRIES` | `.env` / Container App | レート制限と結果キャッシュ。既定値は `.env.example` |
| `DOCKERHUB_USERNAME`、`DOCKERHUB_TOKEN`、`AZURE_CREDENTIALS` | GitHub Secrets | デプロイ |

## 参照資料

| 何を | どこを見るか |
|------|--------------|
| Next.js 16 の API | `node_modules/next/dist/docs/`（入っている版に合ったもの） |
| データの出典とライセンス | [README の出典・ライセンス](../README.md#出典ライセンス) |
| 運賃表の読み取り方 | `scripts/fare/extract/README.md` |
| テストの観点 | [docs/testing/](testing/) |
