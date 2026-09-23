# fare-map

指定した予算で出発駅からどこまで行けるかを地図に表示する Web アプリ。
在来線・私鉄対応（普通運賃の距離ベース概算）。

## 開発

```
npm i && npm run dev
```

http://localhost:3000 で起動する。

データ（`data/graph.json`）はコミット済みなのでそのまま動く。
更新・再生成する場合は `scripts/pipeline/README.md` の手順に従う。

### テスト

```
npm run test    # ロジック（374件・約3秒）
npm run e2e     # ブラウザ実機のスモーク3本
```

`npm run e2e` は本番ビルドを作ってから Chromium で触る。`next dev` ではなく
本番ビルドなのは、maplibre のワーカー解決が dev と本番で挙動が違い、
検出したいのが本番側の 404 だから。初回は
`npx playwright install chromium` が必要。

繰り返し回すときはサーバーを立てたままにすると速い（18秒 → 5秒）。
`reuseExistingServer` が効いてビルドを飛ばす。

```
npx next start -p 3100     # 別ターミナルで起動しっぱなしにする
npm run e2e
```

ただしこの方法ではコードを変えても再ビルドされない。UI を触ったら
サーバーを立て直すこと。

デバッグ用:

```
npm run e2e:ui                    # タイムライン付きの GUI
npx playwright test --headed      # ブラウザを表示して実行
npx playwright test --debug       # ステップ実行
npx playwright show-report        # 失敗後にレポートを開く
```

### TypeScript 6 / 7 の併用

`package.json` の依存が2本のエイリアスに分かれているのは、型検査を TS 7（Go 実装）で
行いつつ、TS 7 未対応の typescript-eslint には TS 6 の API を渡すため。

| 依存                 | 実体                      | 使う側                                           |
| -------------------- | ------------------------- | ------------------------------------------------ |
| `@typescript/native` | `typescript@7`            | `tsc`（`npm run typecheck`）、Next.js のビルド   |
| `typescript`         | `@typescript/typescript6` | `import "typescript"` する側 = typescript-eslint |

typescript-eslint は TS 7 を検出すると警告ではなく throw するため、素直に TS 7 を入れると
`npm run lint` が動かない（typescript-eslint#10940 で対応を追跡中）。
`tsc6` で TS 6 側の型検査も実行できる。将来 typescript-eslint が TS 7 に対応したら、
この2本を `"typescript": "^7"` の1本に戻す。

## Docker

```
docker compose up --build
```

http://localhost:3000 で起動する。動作確認済みのコマンド:

```
curl "http://localhost:3000/api/stations?q=新宿"
curl "http://localhost:3000/api/reachable?from=<上で得た駅 id>&budget=500"
```

## デプロイ（初回の手動セットアップ）

1. GitHub リポジトリの Secrets に `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` / `AZURE_CREDENTIALS` を設定
2. Azure: `az group create -n fare-map-rg -l japaneast`
3. `az containerapp env create` / `az containerapp create --name fare-map --min-replicas 0 --memory 1Gi --target-port 3000 --ingress external`
4. 以後は `main` への push で `.github/workflows/deploy.yml` が自動デプロイする
5. （任意）駅すぱあと API フリープランのキーを取得済みなら、Container App の環境変数に `EKISPERT_API_KEY` を設定する。
   未設定の場合は経路検索リンクが Google Maps へのフォールバックになる。

CI（`.github/workflows/ci.yml`）は push / PR ごとに lint / format:check / typecheck / test を実行する。

## 出典・ライセンス

- 地図: OpenStreetMap contributors / OpenFreeMap
- 駅・路線データ: 駅データ.jp
- 運賃は概算です。正確な運賃は各社の経路検索で確認してください。
