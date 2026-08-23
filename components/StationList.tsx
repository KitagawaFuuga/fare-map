"use client";

import { BRACKET_COLORS } from "@/lib/brackets";
import type { ReachableResult } from "@/lib/server/api-service";

export interface StationListProps {
  stations: ReachableResult["stations"];
  onPick(s: { lat: number; lng: number }): void;
}

export default function StationList({ stations, onPick }: StationListProps) {
  if (stations.length === 0) return null;
  return (
    <div>
      <p className="text-sm text-gray-600">{stations.length} 駅に到達可能</p>
      <ul className="mt-1 divide-y divide-gray-100">
        {stations.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-1 py-2 text-left hover:bg-gray-50"
              onClick={() => onPick({ lat: s.lat, lng: s.lng })}
            >
              <span
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: BRACKET_COLORS[s.bracket] }}
              />
              <span className="flex-1">
                {s.name}
                <span className="ml-1 text-xs text-gray-500">{s.line}</span>
              </span>
              <span className="tabular-nums">{s.fare}円</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
