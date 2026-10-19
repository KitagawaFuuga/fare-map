/**
 * 予算の下限・上限。スライダー・数値入力(components/BudgetInput.tsx)と
 * API の受付範囲(app/api/reachable/route.ts)で同じ値を使う。
 * 探索コストは予算に応じて跳ね上がるので、実用域を超える値は入口で閉じる。
 *
 * サーバー専用の設定(app/api/reachable/config.ts)と分けているのは、
 * あちらが process.env を読むためクライアントバンドルに入れられないため。
 */
export const MIN_BUDGET = 100;
export const MAX_BUDGET = 10_000;
