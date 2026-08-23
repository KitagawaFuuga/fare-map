# データパイプライン

## 手順（年数回・データ更新時）

1. `npm run pipeline:fetch` — 駅データ.jp の再配布ミラー（ny-a/ekidata）から
   `company.csv` / `line.csv` / `station.csv` / `join.csv` を `data/raw/` に取得する。
   会員登録不要。`data/raw/` は gitignore 対象。
2. `npm run pipeline:build` — `data/graph.json` を生成
3. `npm run pipeline:validate` — 検証（孤立ノード等は警告として内容を確認）
4. `data/graph.json` をコミット

## データの性質（把握済み）

- 駅は約 10,478 件（`e_status=0` の運用中のみ。`parseCsv` が自動で絞る）
- 接続データは約 10,190 行
- 新幹線の路線定義（10 路線）は存在するが、対応する駅が元データに含まれない。
  新幹線を参照する接続 144 行は `buildGraph` が「ノード不在」として自動的にスキップするため、
  結果は在来線・私鉄のみになる（本アプリの対象範囲と一致するので追加のフィルタは不要）

出典: 駅データ.jp（商用利用可）。再配布ミラー: https://github.com/ny-a/ekidata
