"use client";

import { useEffect, useRef, useState } from "react";
import type { StationSuggestion } from "@/lib/server/api-service";

export interface SearchPanelProps {
  selected: { id: string; name: string } | null;
  // 候補をそのまま渡す（座標も含むので、選んだ時点で出発駅を地図に描ける）
  onSelect(station: StationSuggestion): void;
}

export default function SearchPanel({ selected, onSelect }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<StationSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // デバウンスだけでは、先の入力の応答が後から届いたときに古い候補で上書きされる
  // （「新宿」と入力しても「新」の候補が出た）。hooks/use-reachable.ts と同じく
  // 世代カウンタで最新の問い合わせの応答だけを反映する
  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 候補のボタン間を矢印キーで移動する。選ぶのは Enter（フォーカスしたボタンの
  // 既定の動作）。先頭で上を押すと入力欄に戻り、Escape で候補を閉じる
  const focusSuggestion = (index: number) => {
    const buttons = listRef.current?.querySelectorAll("button");
    if (!buttons || buttons.length === 0) return;
    if (index < 0) {
      inputRef.current?.focus();
      return;
    }
    buttons[Math.min(index, buttons.length - 1)]?.focus();
  };
  const onListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const buttons = [...(listRef.current?.querySelectorAll("button") ?? [])];
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusSuggestion(current + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusSuggestion(current - 1);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.focus();
    }
  };

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const requestId = ++requestIdRef.current;
    if (query.trim() === "") {
      setSuggestions([]);
      return;
    }
    // 入力中の連打を 200ms デバウンス
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/stations?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const body = (await res.json()) as { stations: StationSuggestion[] };
        if (requestId !== requestIdRef.current) return;
        setSuggestions(body.stations);
        setOpen(true);
      }
    }, 200);
  }, [query]);

  return (
    <div className="relative">
      <label className="block text-sm font-medium">出発駅</label>
      <input
        type="text"
        value={query}
        placeholder={selected?.name ?? "駅名を入力"}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        ref={inputRef}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && open && suggestions.length > 0) {
            e.preventDefault();
            focusSuggestion(0);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
      />
      {open && suggestions.length > 0 && (
        <ul
          ref={listRef}
          onKeyDown={onListKeyDown}
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-gray-200 bg-white shadow"
        >
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-gray-100"
                onClick={() => {
                  onSelect(s);
                  setQuery("");
                  setOpen(false);
                }}
              >
                {s.name}
                <span className="ml-2 text-xs text-gray-500">
                  {s.lineName} / {s.operator}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <p className="mt-1 text-sm text-gray-600">選択中: {selected.name}</p>
      )}
    </div>
  );
}
