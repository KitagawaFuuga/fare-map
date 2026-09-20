"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import BudgetInput from "@/components/BudgetInput";
import BottomSheet from "@/components/BottomSheet";
import FareLegend from "@/components/FareLegend";
import LocateButton from "@/components/LocateButton";
import SearchPanel from "@/components/SearchPanel";
import StationList from "@/components/StationList";
import { useReachable } from "@/hooks/use-reachable";
import type { SheetState } from "@/lib/sheet";
import type { StationSuggestion } from "@/lib/server/api-service";

// maplibre は初期化時に window/document を直接触るため、サーバー側レンダリングで
// 落ちる。"use client" は「ブラウザでも動く」宣言であって SSR を止めないので、
// ssr: false を明示する必要がある。副次的に初期バンドルからも外れる。
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

export default function Home() {
  const [from, setFrom] = useState<{ id: string; name: string } | null>(null);
  const [budget, setBudget] = useState(1500);
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null);
  const [sheet, setSheet] = useState<SheetState>("half");
  const { data, loading, error, search } = useReachable();

  // 座標 → 出発駅の変換。地図タップと現在地ボタンはどちらも「緯度経度が得られる」
  // 点で同じなので同一ハンドラを共有する。範囲外の座標は API が 400 を返し、
  // ここで何もせず戻るので既存の選択状態は壊れない。
  const setFromByCoords = useCallback(async (lat: number, lng: number) => {
    const res = await fetch(`/api/stations/nearest?lat=${lat}&lng=${lng}`);
    if (!res.ok) return;
    const body = (await res.json()) as {
      station: StationSuggestion & { lat: number; lng: number };
    };
    setFrom({ id: body.station.id, name: body.station.name });
    // 地図を寄せるのはタップ座標ではなく「見つかった駅」の座標。
    // そうしないと表示中の駅名と地図の中心がずれる。
    setFocus({ lat: body.station.lat, lng: body.station.lng });
  }, []);

  const runSearch = useCallback(async () => {
    // ボタンの disabled とは別の二重の防御。この行のおかげで以降 from は非 null 扱いになる
    if (!from) return;
    await search(from.id, budget);
    setSheet("collapsed"); // 検索後は地図を主役に
  }, [from, budget, search]);

  // 同じ操作パネルを、デスクトップでは左サイドバー、モバイルではボトムシートに
  // 差し込む。JSX を変数に持つことで2箇所に同じマークアップを書かずに済む。
  const panel = (
    <div className="space-y-4">
      <SearchPanel selected={from} onSelect={setFrom} />
      <BudgetInput value={budget} onChange={setBudget} />
      <button
        type="button"
        disabled={!from || loading}
        onClick={runSearch}
        className="w-full rounded bg-blue-600 py-2 font-medium text-white disabled:opacity-40"
      >
        {loading ? "検索中…" : "検索"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <FareLegend />
      <StationList stations={data?.stations ?? []} onPick={setFocus} />
      <footer className="pt-4 text-xs text-gray-400">
        出典: OpenStreetMap / OpenFreeMap /
        駅データ.jp。運賃は距離ベースの概算です。
      </footer>
    </div>
  );

  return (
    <main className="flex h-dvh">
      <aside className="hidden w-96 shrink-0 overflow-y-auto border-r border-gray-200 p-4 md:block">
        <h1 className="mb-4 text-lg font-bold">fare-map</h1>
        {panel}
      </aside>
      <div className="relative flex-1">
        <MapView
          stations={data?.stations ?? []}
          fromName={from?.name ?? null}
          focus={focus}
          onMapClick={setFromByCoords}
        />
        <LocateButton onLocate={setFromByCoords} />
      </div>
      <BottomSheet state={sheet} onStateChange={setSheet}>
        {panel}
      </BottomSheet>
    </main>
  );
}
