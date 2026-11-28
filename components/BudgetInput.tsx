"use client";

import { useEffect, useRef } from "react";
import { MAX_BUDGET, MIN_BUDGET } from "@/lib/budget";

export interface BudgetInputProps {
  value: number;
  onChange(v: number): void;
  // 数値の欄で Enter を押したとき。検索してよいか（出発駅・検索中）は呼ぶ側が決める
  onSubmit?(): void;
}

// スライダーと数値入力は同じ値を編集する。上限は API の受付上限(MAX_BUDGET)と
// 同じ値で、探索コストが跳ね上がる領域を入口で閉じている。
//
// どちらの値も React に持たせない（uncontrolled）。持たせると、JS が届く前に打った予算が、
// 動き出したとき（ハイドレーション）に初期値で上書きされて戻る（e2e/hydration.spec.ts）。
// 2つの欄は、値が変わったら DOM を直接そろえる
export default function BudgetInput({
  value,
  onChange,
  onSubmit,
}: BudgetInputProps) {
  const numberRef = useRef<HTMLInputElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);

  // 動き出した時点で、どちらかの欄が初期値と違えば、打たれた値として親に渡す。
  // 下の「そろえる」effect より先に置く（先に読まないと、初期値で上書きしてしまう）
  const initialRef = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    for (const el of [numberRef.current, rangeRef.current]) {
      if (!el || el.value === "") continue;
      const typed = Number(el.value);
      if (typed !== initialRef.current) {
        onChangeRef.current(typed);
        return;
      }
    }
  }, []);

  // 値が変わったら、もう一方の欄をそろえる。打っている途中の欄（同じ数値を表している欄）は
  // 触らない。空にした欄（Number("") は 0）を "0" で埋め直さないため
  useEffect(() => {
    for (const el of [numberRef.current, rangeRef.current]) {
      if (el && Number(el.value) !== value) el.value = String(value);
    }
  }, [value]);

  return (
    <div>
      {/* 文の後半。数値入力と「円で行ける駅」を1行に並べる */}
      <div className="flex items-baseline gap-2">
        <input
          ref={numberRef}
          type="number"
          aria-label="予算（円）"
          min={MIN_BUDGET}
          max={MAX_BUDGET}
          step={100}
          defaultValue={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onKeyDown={(e) => {
            // 変換の確定の Enter では検索しない
            if (e.key === "Enter" && !e.nativeEvent.isComposing) onSubmit?.();
          }}
          className="mt-1 w-28 rounded border border-gray-300 px-2 py-1 text-lg font-bold"
        />
        <span className="text-lg">円で行ける駅</span>
      </div>
      {/* 文を切らないよう、ざっと動かすためのスライダーは文の下に置く */}
      <input
        ref={rangeRef}
        type="range"
        aria-label="予算（円）"
        min={MIN_BUDGET}
        max={MAX_BUDGET}
        step={100}
        defaultValue={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full"
      />
    </div>
  );
}
