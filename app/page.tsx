"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import BudgetInput from "@/components/BudgetInput";
import BottomSheet from "@/components/BottomSheet";
import FareLegend from "@/components/FareLegend";
import SearchPanel from "@/components/SearchPanel";
import StationList from "@/components/StationList";
import { useReachable, type ReachableStation } from "@/hooks/use-reachable";
import type { SheetState } from "@/lib/sheet";
import type { StationSuggestion } from "@/lib/server/api-service";

// maplibre は初期化時に window/document を直接触るため、サーバー側レンダリングで
// 落ちる。"use client" は「ブラウザでも動く」宣言であって SSR を止めないので、
// ssr: false を明示する必要がある。副次的に初期バンドルからも外れる。
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

export default function Home() {
  // 出発駅は駅名の入力（SearchPanel）だけで決める。地図のクリックや現在地からは決めない
  const [from, setFrom] = useState<StationSuggestion | null>(null);
  const [budget, setBudget] = useState(500);
  const [focus, setFocus] = useState<ReachableStation | null>(null);
  const [sheet, setSheet] = useState<SheetState>("half");
  const { data, loading, error, search } = useReachable();

  const runSearch = useCallback(async () => {
    // ボタンの disabled とは別の二重の防御。この行のおかげで以降 from は非 null 扱いになる
    if (!from) return;
    const ok = await search(from.id, budget);
    // 成功時だけ畳んで地図を主役にする。失敗時に畳むと、パネル内のエラー表示が
    // スマホで隠れて「何も起きなかった」ように見える。
    if (ok) setSheet("collapsed");
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
      {/* CC BY 4.0 のデータ（運行本数データ・公共交通オープンデータセンター）は
          表示が条件なので、出典から外さないこと。詳細は README の出典節 */}
      <footer className="pt-4 text-xs text-gray-400">
        出典: OpenStreetMap / OpenFreeMap / 駅データ.jp / 全国鉄道運行本数データ
        / 公共交通オープンデータセンター /
        高松琴平電気鉄道・沖縄都市モノレール・札幌市交通局の公開GTFS
        （最後の4つは CC BY 4.0）。運賃は概算です。
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
          origin={from}
          focus={focus}
          // 徒歩の印の差し替えでは meta は同じオブジェクトのまま（use-reachable の
          // loadWalkMarks）なので、新しい検索結果のときだけ変わる
          resultKey={data?.meta}
        />
      </div>
      <BottomSheet state={sheet} onStateChange={setSheet}>
        {panel}
      </BottomSheet>
    </main>
  );
}
