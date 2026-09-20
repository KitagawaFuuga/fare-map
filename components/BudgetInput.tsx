"use client";

export interface BudgetInputProps {
  value: number;
  onChange(v: number): void;
}

// スライダーと数値入力は同じ値を編集する。スライダーの上限(10000)は実用域に寄せ、
// 数値入力は API の受付上限(100000)まで許す（詳細は app/api/reachable/route.ts）。
export default function BudgetInput({ value, onChange }: BudgetInputProps) {
  return (
    <div>
      <label className="block text-sm font-medium">予算: {value}円</label>
      <input
        type="range"
        min={100}
        max={10000}
        step={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
      />
      <input
        type="number"
        min={100}
        max={100000}
        step={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-28 rounded border border-gray-300 px-2 py-1"
      />
    </div>
  );
}
