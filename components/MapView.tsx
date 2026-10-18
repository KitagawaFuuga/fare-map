"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { FeatureCollection, Point } from "geojson";
import {
  Map as MapLibreMap,
  Marker,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BRACKET_COLORS } from "@/lib/brackets";
import { boundsOf } from "@/lib/geo";
import type { ReachableStation } from "@/hooks/use-reachable";

export interface MapViewProps {
  stations: ReachableStation[];
  // 出発駅。到達駅の一覧には含まれないので、別の印で常に描く
  origin: { name: string; lat: number; lng: number } | null;
  // 一覧で選ばれた駅。地図をその駅へ寄せ、円を押したときと同じ吹き出しを開く
  focus: ReachableStation | null;
  // 新しい検索結果ごとに変わる値。変わったら到達駅が全部入るように地図を寄せる。
  // 徒歩の印が後から届いて stations が差し替わるだけでは寄せ直さない
  // （利用者が動かした地図が勝手に戻らないように）
  resultKey: unknown;
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

// 円の半径（px）をズームに合わせる。広域（関東一円など）では重なりを抑えて小さく、
// 寄るほど押しやすく大きくする。初期表示（zoom 9）で 7px
const CIRCLE_RADIUS: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  5,
  4,
  9,
  7,
  13,
  10,
];

interface PopupStation {
  name: string;
  line: string;
  fare: number;
  viaWalk?: boolean;
}

// 吹き出しの中身。地図の円を押したときと、一覧の駅を押したときで共通。
// innerHTML ではなく createElement + textContent で組む。駅名は外部データ由来なので、
// HTML として解釈させない。
function buildPopupContent(
  p: PopupStation,
  fromNameRef: RefObject<string | null>,
): HTMLElement {
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
  return el;
}

// 出発駅の印: 黒い丸に白い縁と、駅名のラベル。到達駅の円（色つき）と見分けられるように
// 色を使わない。クリックは下の地図（駅の円）へ通す
function buildOriginElement(name: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `出発駅: ${name}`);
  el.className = "pointer-events-none flex items-center gap-1";
  const dot = document.createElement("span");
  dot.className =
    "block h-4 w-4 shrink-0 rounded-full border-[3px] border-white bg-gray-900 shadow";
  const label = document.createElement("span");
  label.className =
    "whitespace-nowrap rounded bg-gray-900/85 px-1.5 py-0.5 text-xs font-bold text-white";
  label.textContent = name;
  el.append(dot, label);
  return el;
}

// 選択中の駅の印: 円の外側に重ねる太い縁取り。吹き出しを閉じても位置が分かるように残す
function buildSelectedElement(name: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `選択中の駅: ${name}`);
  el.className =
    "pointer-events-none h-7 w-7 rounded-full border-4 border-gray-900 ring-2 ring-white";
  return el;
}

// 出発駅は駅名の入力だけで決める。地図のクリックで出発駅を変えると、駅の円を
// 少し外して押しただけで意図せず変わってしまうため、地図は表示と駅の情報だけを担う
export default function MapView({
  stations,
  origin,
  focus,
  resultKey,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  // 開いている吹き出しと選択中の印は1つだけにする（選び直したら前のを消す）
  const popupRef = useRef<Popup | null>(null);
  const selectedRef = useRef<Marker | null>(null);
  const originMarkerRef = useRef<Marker | null>(null);
  // 地図の初期化 useEffect は [] で1度きり。その中で登録するイベントハンドラは
  // 最初の props を閉じ込めてしまうため、最新値を ref 経由で参照する。
  // 依存配列に入れて作り直すと、地図ごと再生成されて表示が飛ぶ。
  const fromNameRef = useRef(origin?.name ?? null);
  fromNameRef.current = origin?.name ?? null;
  // 地図の load より先に検索結果が届くと、下の setData はソースが無くて空振りする。
  // load でソースを作るときに最新の結果を入れられるよう、ref にも持っておく
  const stationsRef = useRef(stations);
  stationsRef.current = stations;

  // 駅を選んだ状態にする: 吹き出しを開き、円に選択中の印を重ねる
  const select = (
    map: MapLibreMap,
    lngLat: [number, number],
    p: PopupStation,
  ) => {
    popupRef.current?.remove();
    popupRef.current = new Popup()
      .setLngLat(lngLat)
      .setDOMContent(buildPopupContent(p, fromNameRef))
      .addTo(map);
    selectedRef.current?.remove();
    selectedRef.current = new Marker({ element: buildSelectedElement(p.name) })
      .setLngLat(lngLat)
      .addTo(map);
  };
  const selectRef = useRef(select);
  selectRef.current = select;

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
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: toGeoJson(stationsRef.current),
      });
      map.addLayer({
        id: LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": CIRCLE_RADIUS,
          "circle-color": buildCircleColorExpression(),
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.on("click", LAYER_ID, (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        // 印と吹き出しは押した点ではなく駅の位置に置く
        const [lng, lat] = (f.geometry as Point).coordinates as [
          number,
          number,
        ];
        selectRef.current(map, [lng, lat], f.properties as PopupStation);
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

  // 出発駅の印。選び直したら置き換え、選んだ時点で地図をその駅へ寄せる
  // （遠くの駅を選んでも印が画面の外にならないように）
  useEffect(() => {
    const map = mapRef.current;
    originMarkerRef.current?.remove();
    originMarkerRef.current = null;
    if (!origin || !map) return;
    originMarkerRef.current = new Marker({
      element: buildOriginElement(origin.name),
      // 要素の左端（丸の左端）を基準にするので、丸の中心が駅の位置に来るよう半径ぶん戻す
      anchor: "left",
      offset: [-8, 0],
    })
      .setLngLat([origin.lng, origin.lat])
      .addTo(map);
    map.flyTo({
      center: [origin.lng, origin.lat],
      zoom: Math.max(map.getZoom(), 11),
    });
  }, [origin]);

  useEffect(() => {
    const map = mapRef.current;
    if (!focus || !map) return;
    map.flyTo({ center: [focus.lng, focus.lat], zoom: 12 });
    selectRef.current(map, [focus.lng, focus.lat], focus);
  }, [focus]);

  // 新しい検索結果が届いたら、前の結果で選んでいた駅の印と吹き出しを消し、
  // 到達駅が全部入るように寄せる。stations は ref から読む（依存に入れると、
  // 徒歩の印の差し替えでも寄せ直してしまう）
  useEffect(() => {
    popupRef.current?.remove();
    selectedRef.current?.remove();
    const bounds = boundsOf(stationsRef.current);
    if (bounds) mapRef.current?.fitBounds(bounds, { padding: 60, maxZoom: 13 });
  }, [resultKey]);

  return <div ref={containerRef} className="h-full w-full" />;
}
