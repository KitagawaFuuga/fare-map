"use client";

import { useEffect, useRef } from "react";
import type { FeatureCollection } from "geojson";
import {
  Map as MapLibreMap,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BRACKET_COLORS } from "@/lib/brackets";
import type { ReachableResult } from "@/lib/server/api-service";

export interface MapViewProps {
  stations: ReachableResult["stations"];
  fromName: string | null;
  focus: { lat: number; lng: number } | null;
  onMapClick(lat: number, lng: number): void;
}

const SOURCE_ID = "reachable";
const LAYER_ID = "reachable-circles";

// maplibre-gl はワーカースクリプトを import.meta.url からの相対パスで解決するが、
// Turbopack がバンドルしたチャンク URL は node_modules 上の相対位置と一致せず 404 になり、
// タイルが永久に読み込み中のまま止まる。public/ に配置した実体を明示的に指定して回避する
// (scripts/copy-maplibre-worker.mjs が npm install / dev / build 前にコピーする)。
setWorkerUrl("/maplibre-gl-worker.mjs");

function toGeoJson(stations: MapViewProps["stations"]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stations.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: {
        name: s.name,
        line: s.line,
        fare: s.fare,
        bracket: s.bracket,
        viaWalk: s.viaWalk,
      },
    })),
  };
}

// bracket(0..6) を BRACKET_COLORS の色に対応させる match 式。最後の色は既定値（該当なし）。
function buildCircleColorExpression(): ExpressionSpecification {
  const colorEntries = BRACKET_COLORS.slice(0, -1).map(
    (color, i): [number, string] => [i, color],
  );
  const fallback = BRACKET_COLORS[BRACKET_COLORS.length - 1] ?? "#888";
  const [first, ...rest] = colorEntries;
  if (!first) return ["match", ["get", "bracket"], 0, fallback, fallback];
  const restFlat: (number | string)[] = rest.flatMap(([label, color]) => [
    label,
    color,
  ]);
  return [
    "match",
    ["get", "bracket"],
    first[0],
    first[1],
    ...restFlat,
    fallback,
  ];
}

export default function MapView({
  stations,
  fromName,
  focus,
  onMapClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // 地図の初期化 useEffect は [] で1度きり。その中で登録するイベントハンドラは
  // 最初の props を閉じ込めてしまうため、最新値を ref 経由で参照する。
  // 依存配列に入れて作り直すと、地図ごと再生成されて表示が飛ぶ。
  const onMapClickRef = useRef(onMapClick);
  const fromNameRef = useRef(fromName);
  onMapClickRef.current = onMapClick;
  fromNameRef.current = fromName;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [139.767, 35.681],
      zoom: 9,
      attributionControl: { customAttribution: "駅データ.jp" },
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource(SOURCE_ID, { type: "geojson", data: toGeoJson([]) });
      map.addLayer({
        id: LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": 5,
          "circle-color": buildCircleColorExpression(),
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("click", LAYER_ID, (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as {
          name: string;
          line: string;
          fare: number;
          viaWalk: boolean;
        };
        // ポップアップは innerHTML ではなく createElement + textContent で組む。
        // 駅名は外部データ由来なので、HTML として解釈させない。
        const el = document.createElement("div");
        const nameEl = document.createElement("strong");
        nameEl.textContent = p.name;
        el.appendChild(nameEl);
        el.appendChild(document.createElement("br"));
        el.appendChild(document.createTextNode(p.line));
        el.appendChild(document.createElement("br"));
        el.appendChild(document.createTextNode(`概算 ${p.fare}円`));
        el.appendChild(document.createElement("br"));
        // 別駅への徒歩連絡を含む経路の運賃であることを明示する。
        // 乗り通しではこの額にならない
        if (p.viaWalk) {
          const note = document.createElement("span");
          note.textContent = "別の駅まで歩く経路です";
          note.className = "text-amber-700";
          el.appendChild(note);
          el.appendChild(document.createElement("br"));
        }
        const a = document.createElement("a");
        a.textContent = "経路を見る";
        a.className = "underline text-blue-600 cursor-pointer";
        a.onclick = async () => {
          const from = fromNameRef.current;
          if (!from) return;
          const res = await fetch(
            `/api/route-url?from=${encodeURIComponent(from)}&to=${encodeURIComponent(p.name)}`,
          );
          const body = (await res.json()) as { url: string };
          window.open(body.url, "_blank", "noopener");
        };
        el.appendChild(a);
        new Popup().setLngLat(e.lngLat).setDOMContent(el).addTo(map);
      });

      // 地図の空白クリック = 出発駅の変更。ただし上の駅クリックと同時に発火するので、
      // その場所に駅の円があるかを調べ、無いときだけ出発駅を差し替える。
      map.on("click", (e: MapMouseEvent) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });
        if (hits.length === 0)
          onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 駅は DOM マーカーではなく GeoJSON ソース + circle レイヤで描く。
  // 数千件になるため、更新はソースのデータ差し替えだけで済ませる。
  useEffect(() => {
    const src = mapRef.current?.getSource(SOURCE_ID) as
      GeoJSONSource | undefined;
    src?.setData(toGeoJson(stations));
  }, [stations]);

  useEffect(() => {
    if (focus)
      mapRef.current?.flyTo({ center: [focus.lng, focus.lat], zoom: 12 });
  }, [focus]);

  return <div ref={containerRef} className="h-full w-full" />;
}
