"use client";

import { useRef } from "react";
import { sheetNext, type SheetState } from "@/lib/sheet";

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
        if (Math.abs(delta) > 40) onStateChange(sheetNext(state, delta > 0 ? "up" : "down"));
        touchStartY.current = null;
      }}
    >
      <button
        type="button"
        aria-label="シートを開閉"
        className="mx-auto mt-2 block h-1.5 w-10 rounded-full bg-gray-300"
        onClick={() => onStateChange(sheetNext(state, state === "full" ? "down" : "up"))}
      />
      <div className="h-[calc(100%-1.5rem)] overflow-y-auto px-4 pb-4 pt-2">{children}</div>
    </div>
  );
}
