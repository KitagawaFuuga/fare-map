"use client";

import { useEffect, useRef, useState } from "react";
import type { StationSuggestion } from "@/lib/server/api-service";

export interface SearchPanelProps {
  selected: { id: string; name: string } | null;
  onSelect(station: { id: string; name: string }): void;
}

export default function SearchPanel({ selected, onSelect }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<StationSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim() === "") {
      setSuggestions([]);
      return;
    }
    // 入力中の連打を 200ms デバウンス
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/stations?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const body = (await res.json()) as { stations: StationSuggestion[] };
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
        className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded border border-gray-200 bg-white shadow">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-gray-100"
                onClick={() => {
                  onSelect({ id: s.id, name: s.name });
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
