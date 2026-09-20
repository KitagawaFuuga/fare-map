export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6371; // 地球の平均半径(km)
const rad = (d: number): number => (d * Math.PI) / 180;

// 2点間の大圏距離。駅間の実距離（営業キロ）ではなく直線距離なので、
// 運賃計算にはこの値をそのまま使わず lib/graph/calibrate.ts の補正係数を掛ける。
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
