"use client";

import { useRef } from "react";
import { sheetNext, type SheetState } from "@/lib/sheet";

// スマホ専用のパネル（md:hidden）。デスクトップでは左サイドバーが同じ内容を出す。
// 高さ3段階を state で切り替え、上下スワイプかつまみのタップで遷移する。
const HEIGHT: Record<SheetState, string> = {
  collapsed: "h-14",
  half: "h-72",
  full: "h-[80dvh]",
};

export default function BottomSheet({
  state,
  onStateChange,
  children,
}: {
  state: SheetState;
  onStateChange(s: SheetState): void;
  children: React.ReactNode;
}) {
  const touchStartY = useRef<number | null>(null);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-10 rounded-t-2xl bg-white shadow-2xl transition-all md:hidden ${HEIGHT[state]}`}
      onTouchStart={(e) => {
        touchStartY.current = e.touches[0]?.clientY ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchStartY.current;
        const end = e.changedTouches[0]?.clientY;
        if (start === null || end === undefined) return;
        const delta = start - end;
        // 40px 未満はスワイプではなくタップ時の指ブレとみなして無視する
        if (Math.abs(delta) > 40)
          onStateChange(sheetNext(state, delta > 0 ? "up" : "down"));
        touchStartY.current = null;
      }}
    >
      {/* 見た目の棒（高さ 6px）より押せる範囲を広く取る。棒だけだと指では押しにくい */}
      <button
        type="button"
        aria-label="シートを開閉"
        aria-expanded={state !== "collapsed"}
        className="mx-auto mt-1 flex h-6 w-16 items-center justify-center"
        onClick={() =>
          onStateChange(sheetNext(state, state === "full" ? "down" : "up"))
        }
      >
        <span className="block h-1.5 w-10 rounded-full bg-gray-300" />
      </button>
      <div className="h-[calc(100%-1.75rem)] overflow-y-auto px-4 pb-4 pt-2">
        {children}
      </div>
    </div>
  );
}
