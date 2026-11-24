# 0006: CI と配信の守りを固める

- 日付: 2026-11-24
- 状態: 採用
- 決めた人: ユーザー（AI が出した案から選んだ。部品の固定・CodeQL・連絡先・ベースイメージの4つ）。権限の絞り込みと root 以外での実行は公式の推奨どおりで、AI の判断

## 背景

OpenSSF Scorecard の検査項目と照らし合わせたところ、次が抜けていた。

- Actions の部品を `@v4` のようなタグで指定していた。タグは作者があとから付け替えられるので、作者が乗っ取られると
  すり替わった中身が CI で動き、デプロイのジョブに渡る Docker Hub と Azure の認証情報が盗まれうる
- GITHUB_TOKEN の権限を指定しておらず、リポジトリの既定の権限で動いていた
- 静的解析が無かった。脆弱性の連絡先（SECURITY.md）が無かった
- コンテナが root で動いていた

## 選択肢

- 部品の固定: 案A コミットハッシュ＋バージョンのコメント（GitHub が推奨。Dependabot がハッシュとコメントを一緒に更新する）/
  案B ロックファイル（`.github/workflows/actions.lock`。間接的に使う部品まで固定できるが、`gh` の拡張が要り、
  正式版かどうかと Scorecard が認めるかを確認できなかった）
- CodeQL: 案A ワークフローを置く（設定がレビューと履歴に残る）/ 案B GitHub の画面で default setup を有効にする
- 連絡先: 案A GitHub の private vulnerability reporting / 案B メールアドレスを書く（公開される）/ 案C 置かない
- ベースイメージ: 案A タグのまま＋Dependabot / 案B ダイジェストで固定（同じ中身が保証されるが、修正は PR を merge するまで入らない）

## 決定

- 部品はコミットハッシュで固定する（案A）。今の major のまま、その時点の最新の patch に合わせた
- CodeQL はワークフローを置く（案A）。対象は JavaScript/TypeScript と Actions のワークフロー
- 連絡先は private vulnerability reporting（案A）。リポジトリの Settings → Advanced Security で有効にする（ユーザーの操作）
- ベースイメージはタグのまま（案A）。Dependabot は月1回なので、ダイジェストで固定すると修正が最大1か月遅れるため。
  当初は Dependabot に docker を加えて Node の大きい版の更新を知らせる予定だったが、レビューで2つの問題が見つかり外した（AI の判断）:
  CI はイメージを作らないので壊れる更新でも merge でき、merge がそのままデプロイになる。また Dependabot はワークフローの
  `node-version: 24` を上げられないので、本番の Node と CI で試す Node がずれる（奇数の非 LTS 版も提案される）。
  Node の大きい版は、Dockerfile とワークフローの `node-version` を同じ PR で手で上げる
- GITHUB_TOKEN はワークフローの既定を `contents: read` にし、CodeQL のジョブにだけ `security-events: write` を足す
- コンテナは `node` ユーザーで動かす（Next.js の with-docker の見本と同じ）。standalone の出力に `data/` も含まれるため、
  `data/` 以下のフォルダは node の持ち物、あとから COPY する JSON のファイルは root の持ち物と混在する。
  アプリは実行中にファイルを書かないので、それ以上は絞らない

## 結果

- Dependabot の actions の PR は、ハッシュとコメントの両方を書き換える。コメントだけ、ハッシュだけを手で直さない
- 新しく `uses:` を足すときも、ハッシュとバージョンのコメントで書く
- ベースイメージの中身はビルドした日によって違いうる（引き受けた欠点）。デプロイ前のスモークテストと E2E で起動を確かめる
- CodeQL の指摘は Security タブに出る。必須のチェックにはしていない
