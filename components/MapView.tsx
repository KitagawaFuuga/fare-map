"use client";

import { useEffect, useRef } from "react";
import {
  Map as MapLibreMap,
  Popup,
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

function toGeoJson(stations: MapViewProps["stations"]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stations.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
      properties: { name: s.name, line: s.line, fare: s.fare, bracket: s.bracket },
    })),
  };
}

// bracket(0..6) を BRACKET_COLORS の色に対応させる match 式。最後の色は既定値（該当なし）。
function buildCircleColorExpression(): ExpressionSpecification {
  const colorEntries = BRACKET_COLORS.slice(0, -1).map((color, i): [number, string] => [i, color]);
  const fallback = BRACKET_COLORS[BRACKET_COLORS.length - 1] ?? "#888";
  const [first, ...rest] = colorEntries;
  if (!first) return ["match", ["get", "bracket"], 0, fallback, fallback];
  const restFlat: (number | string)[] = rest.flatMap(([label, color]) => [label, color]);
  return ["match", ["get", "bracket"], first[0], first[1], ...restFlat, fallback];
}

export default function MapView({ stations, fromName, focus, onMapClick }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
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
        const p = f.properties as { name: string; line: string; fare: number };
        const el = document.createElement("div");
        el.innerHTML = `<strong>${p.name}</strong><br/>${p.line}<br/>概算 ${p.fare}円<br/>`;
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

      map.on("click", (e: MapMouseEvent) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });
        if (hits.length === 0) onMapClickRef.current(e.lngLat.lat, e.lngLat.lng);
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const src = mapRef.current?.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    src?.setData(toGeoJson(stations));
  }, [stations]);

  useEffect(() => {
    if (focus) mapRef.current?.flyTo({ center: [focus.lng, focus.lat], zoom: 12 });
  }, [focus]);

  return <div ref={containerRef} className="h-full w-full" />;
}
