# fare-map 設計書

作成日: 2026-08-23

## 概要

指定した金額（予算）で出発駅からどこまで行けるかを地図上に表示する Web アプリ。
対象は日本全国の鉄道（在来線・私鉄、普通運賃のみ）。運賃は距離ベースの概算モデルで自前計算する。

### 背景と制約

- 運賃の数値を返す無料 API は存在しない（駅すぱあと/NAVITIME/mixway は有料、フリープランは運賃数値の取得不可）
- 到達圏計算は 1 検索で数千駅分の運賃が必要なため、従量課金 API を都度叩く設計は有料でも成立しない
- よって自前グラフ + 概算運賃モデルが構造的に必須
- 使用するデータ・ライブラリはすべて商用利用可能なものに限定する

## 技術スタック

参考リポジトリ: KitagawaFuuga/newIdolProject（構成を踏襲）

| 要素 | 採用 |
|------|------|
| フレームワーク | Next.js 16 (App Router) + React 19 + TypeScript strict |
| CSS | Tailwind CSS v4 |
| 地図 | MapLibre GL JS (BSD-3) + OpenFreeMap タイル（無料・無制限・API キー不要・商用可） |
| 検索 | fuse.js（駅名あいまい検索・かな対応） |
| 入力検証 | zod |
| テスト | vitest |
| CI/CD | GitHub Actions → Docker Hub → Azure Container Apps |
| DB | なし（v1 では不採用。グラフ JSON をイメージに同梱） |

DB を外す理由: 駅グラフは探索のため全量メモリロードが必要で読み取り専用。
Postgres を省くことで Azure の DB コストをゼロにする。
ユーザーデータ機能（お気に入り等）を追加する際に Prisma/Postgres を導入する。

## データパイプライン

`scripts/pipeline/` の TS スクリプト群。手動実行し、生成物をコミットしてイメージに同梱。

1. `fetch-stations.ts` — 駅データ.jp（無料・商用可・10万hit/日）から駅・路線・隣接関係を取得 → `data/raw/`（gitignore）
2. `build-graph.ts` — グラフ構築 → `data/graph.json`（コミット対象、数MB想定）
   - 駅ノード: id, 名前, 読み仮名, 緯度経度, 路線, 事業者
   - 隣接エッジ: 駅間距離（緯度経度から算出。営業キロの代用）
   - 乗換エッジ: 同一駅グループ + 半径300m以内の近接駅
3. `validate-graph.ts` — 孤立ノード・重複エッジ・距離異常値のチェック

運賃パラメータは `data/fare-rules/` に事業者別 JSON
（JR本州3社 / JR三島会社 / 大手私鉄16社 / 汎用フォールバック）。
事業者対応の拡張はコード変更なしでファイル追加のみ。

データ更新は年数回、パイプライン再実行 + コミットで追従（自動化しない）。

## API 設計

`app/api/` 配下に 3 本。

- `GET /api/stations?q=<駅名>` — 駅名サジェスト（前方一致 + かな）
- `GET /api/stations/nearest?lat=&lng=` — 地図クリック時の最寄り駅
- `GET /api/reachable?from=<駅id>&budget=<円>` — コア。予算内の全到達駅

reachable レスポンス:

```json
{
  "stations": [{ "id": "", "name": "", "lat": 0, "lng": 0, "fare": 0,
                 "line": "", "operator": "", "bracket": 0, "ekispertUrl": "" }],
  "meta": { "from": "", "budget": 0, "count": 0 }
}
```

- `bracket` は色分け用の金額段階（〜500 / 〜1000 / …）
- `ekispertUrl` は駅すぱあと API フリープランで取得する経路検索結果ページ URL
  （概算の粗さを公式リンクで補う導線。フリープランは個人・商用問わず無料）

## 探索アルゴリズム

`lib/search/` に純粋関数として実装。

1. 出発駅から運賃コスト Dijkstra（コストは円ではなくキロで累積）
2. 各駅への「事業者ごとの乗車距離の内訳」を保持し、駅ごとに運賃モデルで円換算。
   同一事業者の連続乗車は距離合算後に運賃表を引く（初乗り二重取り防止。概算精度の肝）
3. 運賃合計 ≤ budget の駅のみ返す

- 全国約1万ノード。1リクエスト数十ms想定。キャッシュ不要
- 運賃計算は `FareCalculator` インターフェース `estimate(operator, km): number`。
  将来有料 API 実装に差し替え・照合可能

## フロントエンド

1画面構成。`components/` 分割は newIdolProject のスタイルに合わせる。

- `MapView` — maplibre-gl を client component で直接使用（React ラッパー不使用、useEffect + ref）。
  WebGL 描画のため数千マーカーでも軽い。マーカーは金額段階で色分け、タップでポップアップ
  （駅名 / 概算運賃 / 駅すぱあとリンク）
- `SearchPanel` — 出発駅検索（サジェスト）+ 予算入力（スライダー + 直接入力）+ 検索ボタン
- `StationList` — 到達駅リスト（金額順、クリックで地図移動）
- `FareLegend` — 金額段階の凡例
- 現在地 FAB — Geolocation API で最寄り駅を出発駅にセット
- 状態管理は React state のみ

### レスポンシブ（md ブレークポイントで切替）

- PC: 左サイドパネル + 右地図
- モバイル: 地図全画面 + ボトムシート3段階（折りたたみ/半開/全開）。
  CSS transform + touch で自前実装。検索実行後は自動折りたたみ

## Docker / CI/CD / Azure

- Dockerfile: マルチステージ（builder: npm ci + next build standalone / runner: node:20-alpine、
  standalone 成果物 + data/graph.json を COPY）。Prisma 層なし
- docker-compose.yml: web サービスのみ。ホットリロード設定は newIdolProject 流用
- ci.yml（全 push/PR）: eslint + prettier --check → tsc --noEmit → vitest run
- deploy.yml（main のみ、ci 成功が条件): Docker Hub push (latest + SHA) → az containerapp update。
  paths-ignore (md/docs/.claude) と concurrency 設定を流用
- Azure Container Apps: 消費プラン、min replicas 0（コールドスタート許容）、メモリ 1GB
- リソースグループ: fare-map-rg
- Secrets: DOCKERHUB_USERNAME / DOCKERHUB_TOKEN / AZURE_CREDENTIALS

## テスト方針

- 運賃モデル: 実運賃との照合テーブルテスト（例: 新宿→東京 実運賃±20%以内）
- 探索: Dijkstra の到達性・予算境界・事業者跨ぎの運賃合算
- API: 入出力検証（zod スキーマ・異常系）
- CI で全テスト成功をデプロイの前提条件にする

## ライセンス・出典表記

| 対象 | ライセンス/条件 |
|------|---------------|
| OpenFreeMap タイル | 無料・商用可。OSM 出典表記は MapLibre が自動付与 |
| 駅データ.jp | 無料・商用可（10万hit/日超は要問い合わせ） |
| maplibre-gl | BSD-3 |
| fuse.js | Apache-2.0 |
| zod / clsx / tailwind-merge | MIT |

フッターに OSM / 駅データ.jp の出典を明記する。

## 将来拡張（v1 スコープ外）

- 新幹線・特急（特急料金の概算モデル追加）
- 有料 API による運賃精度向上（FareCalculator 差し替え）
- お気に入り保存等のユーザーデータ機能（Prisma/Postgres 導入）
- IC運賃・乗継割引
