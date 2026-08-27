# データパイプライン

## 手順（年数回・データ更新時）

1. `npm run pipeline:fetch` — 駅データ.jp の再配布ミラー（ny-a/ekidata）から
   `company.csv` / `line.csv` / `station.csv` / `join.csv` を `data/raw/` に取得し、
   続けて全国鉄道運行本数データから `kilometrage.csv` を取得する（`pipeline:fetch-km` を内部で呼ぶ）。
   会員登録不要。`data/raw/` は gitignore 対象。
   - `npm run pipeline:fetch-km` — `kilometrage.csv` のみ取得したい場合
2. `npm run pipeline:build` — `data/graph.json` と `data/calibration.json` を生成。
   `buildGraph` の後、`kilometrage.csv` の実営業キロを使って rail エッジの `km` を
   路線ごとの補正係数で補正する（`lib/graph/calibrate.ts`）
3. `npm run pipeline:validate` — 検証（孤立ノード等は警告として内容を確認）
4. `data/graph.json` と `data/calibration.json` をコミット

## データの性質（把握済み）

- 駅は約 10,478 件（`e_status=0` の運用中のみ。`parseCsv` が自動で絞る）
- 接続データは約 10,190 行
- 新幹線の路線定義（10 路線）は存在するが、対応する駅が元データに含まれない。
  新幹線を参照する接続 144 行は `buildGraph` が「ノード不在」として自動的にスキップするため、
  結果は在来線・私鉄のみになる（本アプリの対象範囲と一致するので追加のフィルタは不要）

出典: 駅データ.jp（商用利用可）。再配布ミラー: https://github.com/ny-a/ekidata

## 距離補正（実営業キロキャリブレーション）

- 出典: [全国鉄道運行本数データ](https://gtfs-gis.jp/railway_honsu/)
  （`unkohonsu2026_kukan_sjis.csv`、Shift_JIS、2,152 行、160 事業者）
- 直線距離（haversine）の積み上げは線路の曲がりや駅間の粗さぶん実距離より短く出るため、
  同じ会社・路線の区間データにある実営業キロとの比を路線単位（無ければ事業者単位、
  それも無ければ全国中央値）で集約し、rail エッジの `km` に掛けて補正する
- 区間の駅名は「事業者名 + 駅名」で我々のグラフに解決するが、同名駅が複数路線に
  またがる場合は、区間データの路線名（例:「中央線」）を正規化（`JR` 接頭辞とカッコ書きを除去）
  して一致する路線を優先する。一致が無ければ直線距離合計が最小の路線を採用する
  （例: JR中央線には駅並びの粗い「中央本線」と細かい「中央線(快速)」が別 line_cd で
  重複定義されており、名前で絞らないと粗い方の距離が短く出て誤ったペアを選んでしまう）
- 解決できない区間（駅名不一致・事業者名の表記ゆれ等）はスキップし、件数を
  `pipeline:build` 実行時に `console.warn` で報告する（2026-08 時点で 2,152 件中 364 件）
