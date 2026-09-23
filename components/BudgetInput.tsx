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
      <label className="block text-sm font-medium">予算: {value}円</label>
      <input
        type="range"
        min={MIN_BUDGET}
        max={MAX_BUDGET}
        step={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
      />
      <input
        type="number"
        min={MIN_BUDGET}
        max={MAX_BUDGET}
        step={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-28 rounded border border-gray-300 px-2 py-1"
      />
    </div>
  );
}
