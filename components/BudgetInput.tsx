"use client";

import { MAX_BUDGET, MIN_BUDGET } from "@/lib/budget";

export interface BudgetInputProps {
  value: number;
  onChange(v: number): void;
}

// スライダーと数値入力は同じ値を編集する。上限は API の受付上限(MAX_BUDGET)と
// 同じ値で、探索コストが跳ね上がる領域を入口で閉じている。
export default function BudgetInput({ value, onChange }: BudgetInputProps) {
  return (
    <div>
      {/* 文の後半。数値入力と「円で行ける駅」を1行に並べる */}
      <div className="flex items-baseline gap-2">
        <input
          type="number"
          aria-label="予算（円）"
          min={MIN_BUDGET}
          max={MAX_BUDGET}
          step={100}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="mt-1 w-28 rounded border border-gray-300 px-2 py-1 text-lg font-bold"
        />
        <span className="text-lg">円で行ける駅</span>
      </div>
      {/* 文を切らないよう、ざっと動かすためのスライダーは文の下に置く */}
      <input
        type="range"
        aria-label="予算（円）"
        min={MIN_BUDGET}
        max={MAX_BUDGET}
        step={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full"
      />
    </div>
  );
}
