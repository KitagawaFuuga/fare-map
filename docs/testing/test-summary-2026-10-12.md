# テスト結果の要約（2026-10-12）

qa-manual-istqb でテストを設計し（`test-conditions.md`・`test-cases.csv`）、実行したうえで、e2e-reviewer で E2E テスト自体を点検した。

## 実行結果

| 区分 | 件数 | 合格 | 不合格 |
|---|:-:|:-:|:-:|
| 運賃・探索（TC-F） | 10 | 10 | 0 |
| 画面（TC-U） | 9 | 8 | 1 |
| 非機能（TC-NF） | 4 | 4 | 0 |
| 入力検証（TC-A） | 6 | 6 | 0 |
| 合計 | 29 | 28 | 1 |

- 自動テスト: 単体 902件・E2E 20件がすべて合格。
- 運賃は ekitan の照合（名古屋↔赤羽6,380円）と、規則から導いた性質で確かめた。性質は3つ：往復30組が同額、予算を上げても運賃が変わらない、全事業者 ≦ JR だけ。

## 見つかった不具合

| ID | 内容 | 重大度 | 状態 |
|---|---|:-:|---|
| DEF-001 | 駅名の候補が、遅れて届いた古い入力の応答で上書きされる（「新宿」と入力しても「新」の候補が出る）。`components/SearchPanel.tsx` に、古い応答を捨てる処理が無い | 中 | 1352128 で修正（TC-U09 を E2E 化） |
| DEF-002 | 検索 API が HTML を返したとき（502 など）、「Unexpected token '<' … is not valid JSON」がそのまま表示される | 低 | 94a10a5 で修正 |
| DEF-003 | 駅名の候補を矢印キーで選べない（Tab と Enter では選べる） | 低 | 4b1d90e で修正 |
| （修正済み） | モバイルの E2E「畳まれた状態からでもつまみで開き直せる」が、10回中2回落ちる。高さをアニメーションの途中で測っていた | — | f53477a で修正 |
| （修正済み） | 地図の読み込み前に検索結果が届くと、駅の点が描かれない | — | 3c0874a で修正 |

## リスク

- 性能（d59ed16 で対応）: 大阪発・予算1万円の検索が9.1〜9.2秒で、目安の10秒に余裕が無かった。「徒歩あり」の判定を別 API に分け、運賃は4.6〜5.2秒で先に返し、印は約4.2秒後に付く形にした。以前の記述:1回の検索で、徒歩ありの判定用にもう1回探索している。本番の前段にタイムアウトがあると、DEF-002 の表示につながる。
- TC-F03（200km の境界）のうち泉の組は、規則の有無で運賃が変わらず、判別力が弱い。

## E2E テストの点検（e2e-reviewer）

下の P1 4件は、いずれも修正済み（コミット「test: E2E の弱い検証4件と制限時間の矛盾を直す」）。修正後の書き方は、応答が遅く候補を返してしまう状況を作って、旧い書き方が素通りし、新しい書き方が落ちることを確かめた。あわせて、予算1万円のテストの制限時間の矛盾（結果を60秒待つのに制限は30秒）も直した。

## Review Scope and Evidence
- **Mode:** full mode
- **Behavior under review:** `e2e/` の Playwright スイート（smoke・boundary・mobile）
- **Diff base/range:** N/A
- **Changed E2E artifacts:** none（full mode）
- **Context-only files consulted:** `playwright.config.ts`, `components/SearchPanel.tsx`, `components/BottomSheet.tsx`, `hooks/use-reachable.ts`
- **Static evidence:** Tier coverage: none。同梱のスキャナーは POSIX 前提で、Windows では一時ディレクトリの検証（`os.geteuid`）が通らず動かない。意味的なレビュー（Phase 2）と、規定の照合パターンの洗い出しは rg で全件実施した
- **Runtime evidence:** `npx playwright test`（20件合格）、`--repeat-each=10` で mobile.spec.ts を確認
- **Independent verification:** recommended/unexecuted
- **Limitations/exclusions:** Tier 1〜3 の機械スキャン未実行

## [P1] e2e/boundary.spec.ts — #4i #9 候補が無いことを、固定の待ち時間のあとに確かめている

### `51 文字入れても候補欄が出ずエラーにならない`・`存在しない駅名では候補が出ない`
- **Issue:** e2e/boundary.spec.ts:120 と e2e/boundary.spec.ts:129 で1秒待ってから `ul li` が0件かを見ている。候補の問い合わせは200msの遅延のあとに出るので、応答が約0.8秒より遅いと、候補が出る不具合があっても通る。セレクタが変わって何も一致しなくなっても、常に通る。
- **Attribution (diff mode):** N/A in full mode
- **Fix:** 駅名検索の応答を待ってから0件を確かめる（51文字は API が 400 を返すことも確かめる）。
- **Verification:** recommended
- **§4.1 row:** no row (judgement call)
- **Code:**
  ```typescript
  const response = page.waitForResponse((r) => r.url().includes("/api/stations"));
  await panel.getByPlaceholder("駅名を入力").fill("ZZZZ存在しない駅ZZZZ");
  expect((await response).status()).toBe(200);
  await expect(panel.locator("ul li")).toHaveCount(0);
  ```

## [P1] e2e/boundary.spec.ts — #1 題名の「エラーにならない」を確かめていない

### `51 文字入れても候補欄が出ずエラーにならない`
- **Issue:** e2e/boundary.spec.ts:115 の題名は「エラーにならない」を約束しているが、エラー表示やページのエラーを確かめる行が無い。
- **Attribution (diff mode):** N/A in full mode
- **Fix:** `pageerror` を集めて空であることを確かめる。
- **Verification:** recommended
- **§4.1 row:** no row (judgement call)
- **Code:**
  ```typescript
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // ...入力と応答待ちのあと
  expect(errors).toEqual([]);
  ```

## [P1] e2e/mobile.spec.ts — #4i 高さが変わらないことだけを確かめている

### `40px 未満の指ブレでは高さが変わらない`
- **Issue:** e2e/mobile.spec.ts:123 のテストは、スワイプのあと高さが同じことだけを見ている。タッチの処理が登録される前にスワイプした場合や、タッチの処理が壊れた場合でも通る。
- **Attribution (diff mode):** N/A in full mode
- **Fix:** 同じテストの中で、閾値を超えるスワイプなら高さが変わることも確かめる（対照）。
- **Verification:** recommended
- **§4.1 row:** no row (judgement call)
- **Code:**
  ```typescript
  expect(await heightOf(target)).toBe(before);
  await swipe(target, -100); // 対照: 閾値を超えれば変わる
  await expect.poll(() => heightOf(target), { timeout: 5_000 }).toBeGreaterThan(before);
  ```

## [P1] e2e/boundary.spec.ts — #10a #10c 先頭の候補を選び、選択を部分一致で確かめている

### `selectShinjuku`（e2e/boundary.spec.ts:26。smoke.spec.ts と mobile.spec.ts にも同じ形）
- **Issue:** `/^新宿/` は新宿御苑前・新宿三丁目・新宿西口にも一致し、`.first()` は API の並び順に頼っている。確認の `getByText("選択中: 新宿")` は部分一致なので、新宿三丁目が選ばれても通る。並び順が変わると、テストが黙って別の駅で動く。
- **Attribution (diff mode):** N/A in full mode
- **Fix:** 選ばれた駅を完全一致で確かめ、別の駅を選んだときは落ちるようにする。
- **Verification:** recommended
- **§4.1 row:** no row (judgement call)
- **Code:**
  ```typescript
  await expect(panel.getByText("選択中: 新宿", { exact: true })).toBeVisible();
  ```

## Review Summary

| Sev | Count | Top Issue | Affected Files |
|-----|-------|-----------|----------------|
| P0  | 0     | — | — |
| P1  | 4     | 不在だけを確かめる弱い検証 | boundary.spec.ts, mobile.spec.ts（#10 は smoke.spec.ts にも） |
| P2  | 0     | — | — |

**Total: 4 issues across 3 files.**

### Top 3 Priorities
1. **boundary.spec.ts の候補0件の2件**：応答を待ってから確かめる。今は遅いと素通りする。
2. **mobile.spec.ts の指ブレのテスト**：対照のスワイプを足す。今はタッチ処理が壊れても通る。
3. **選択の確認を完全一致にする**：3ファイル共通の `selectShinjuku`。
